"""
audit.py – Subtitle audit / state-management system.

Parallel to promotion.py's _should_demote / _qualifies_for_promotion — this
module computes a richer per-series "audit state" used purely for
information / UI purposes (does NOT move files, does NOT promote/demote).

Hard constraints (see spec):
  - Specials / OVA (season_number == 0) are completely ignored everywhere —
    not counted in episode numbering, subtitle logic, or damage logic.
  - "Damaged" status comes ONLY from Seerr reports (never guessed).
  - Episode numbering is normalized (gaps from specials removed) before any
    "starts from episode 1" / "continuous" / "tail" reasoning.

Three logics:
  Logic 1 – evaluate_subtitle_confidence(): "do we believe missing
            subtitles will arrive?" (publish / wait decision)
  Logic 2 – evaluate_damage_ratio(): "is the damage level acceptable?"
            (degrade decision, sourced from Seerr issue reports)
  Logic 3 – determine_audit_status(): 6-state machine combining 1 + 2 + a
            hiyori.cz "planned/revived" check (Logic 4)

Top level:
  audit_series(db, series, ...) – evaluate + persist for one series
  audit_all(db)                 – evaluate + persist for all series
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from sqlalchemy.orm import Session, subqueryload

from ..models.series import Series, Episode
from ..models.audit_log import SeriesAuditLog
from ..utils import has_cs_sub
from ..utils.settings_helper import read_setting as _rs

log = logging.getLogger(__name__)

# ── State machine ───────────────────────────────────────────────────────────

STATES = (
    "CLEAN",
    "PENDING",
    "ABANDONED",
    "DAMAGED",
    "PARTIAL",
    "PENDING_TRANSLATION",
)

# Conflict priority — lower number wins.  Kept for reference / potential
# multi-signal merges; determine_audit_status() returns a single state
# directly but follows this same ordering.
STATE_PRIORITY = {
    "DAMAGED":             1,
    "PENDING_TRANSLATION": 2,
    "PARTIAL":             3,
    "PENDING":             4,
    "ABANDONED":           5,
    "CLEAN":               6,
}


# ── Generic helpers ────────────────────────────────────────────────────────

def _now() -> datetime:
    return datetime.now(timezone.utc)


def _to_aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _parse_date(s: str | None) -> datetime | None:
    """Parse an episode air_date / air_date_utc string into an aware datetime."""
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        try:
            return datetime.strptime(s[:10], "%Y-%m-%d").replace(tzinfo=timezone.utc)
        except Exception:
            return None


def _days_since(dt: datetime | None) -> float | None:
    dt = _to_aware(dt)
    if dt is None:
        return None
    return (_now() - dt).total_seconds() / 86400.0


def _normalized_episodes(series: Series) -> list[Episode]:
    """Main-series episodes (season_number > 0), sorted — specials/OVA excluded.

    This sorted order IS the normalized numbering: gaps caused by specials
    are removed simply by never including them.
    """
    return sorted(
        (ep for ep in series.episodes if ep.season_number and ep.season_number > 0),
        key=lambda e: (e.season_number, e.episode_number),
    )


def _log_event(db: Session, series_id: int, event_type: str, message: str, detail: str | None = None) -> None:
    entry = SeriesAuditLog(series_id=series_id, event_type=event_type, message=message, detail=detail)
    db.add(entry)
    db.commit()


# ── Logic 1: subtitle_confidence ──────────────────────────────────────────

def evaluate_subtitle_confidence(series: Series, db: Session, dir_cache: dict | None = None) -> dict:
    """
    "Do we believe missing CZ subtitles will arrive?"

    Returns a dict describing the subtitle-coverage situation:
      verdict: one of
        NO_FILES        – series has no main-series episodes with files yet
        COMPLETE        – every episode with a file has a CZ subtitle
        WAIT_TAIL       – only the newest ("tail") episodes lack subs, and
                          we're still within the freshness tolerance
        TAIL_STALE      – only tail episodes lack subs, but tolerance is
                          exhausted (>30d, or >low-tolerance episode count
                          within 7-30d)
        GAP_FROM_START  – episode 1 (normalized) itself is missing a sub
        GAP_MIDDLE      – subtitles start from ep.1 but there's a gap before
                          the tail
      missing_episodes: [(season, episode), ...]
      starts_from_ep1, continuous, tail_only_missing: bool | None
      newest_missing_age_days, oldest_missing_age_days: float | None
      tolerance: "high" | "low" | "none" | "unknown" | None
      stale: bool – whether tolerance has been exhausted (drives Logic 4)
      reason: short machine-readable summary (used in logs / audit_status_reason)
    """
    if dir_cache is None:
        dir_cache = {}

    eps = _normalized_episodes(series)
    eps_with_file = [ep for ep in eps if ep.has_file]

    if not eps_with_file:
        return {
            "verdict": "NO_FILES",
            "reason": "no_episodes_with_files",
            "missing_episodes": [],
            "starts_from_ep1": None,
            "continuous": None,
            "tail_only_missing": None,
            "newest_missing_age_days": None,
            "oldest_missing_age_days": None,
            "tolerance": None,
            "stale": False,
        }

    missing = [ep for ep in eps_with_file if not has_cs_sub(ep, dir_cache)]
    n = len(eps_with_file)

    if not missing:
        return {
            "verdict": "COMPLETE",
            "reason": "all_subbed",
            "missing_episodes": [],
            "starts_from_ep1": True,
            "continuous": True,
            "tail_only_missing": True,
            "newest_missing_age_days": None,
            "oldest_missing_age_days": None,
            "tolerance": None,
            "stale": False,
        }

    # 1-based normalized index within eps_with_file
    idx_of = {(ep.season_number, ep.episode_number): i + 1 for i, ep in enumerate(eps_with_file)}
    missing_idx = sorted(idx_of[(ep.season_number, ep.episode_number)] for ep in missing)

    starts_from_ep1 = missing_idx[0] != 1
    tail_start = n - len(missing_idx) + 1
    tail_only = missing_idx == list(range(tail_start, n + 1))

    def _air_age(ep: Episode) -> float | None:
        return _days_since(_parse_date(ep.air_date_utc or ep.air_date))

    newest_missing = max(missing, key=lambda ep: idx_of[(ep.season_number, ep.episode_number)])
    oldest_missing = min(missing, key=lambda ep: idx_of[(ep.season_number, ep.episode_number)])
    newest_age = _air_age(newest_missing)
    oldest_age = _air_age(oldest_missing)

    missing_pairs = [(ep.season_number, ep.episode_number) for ep in missing]

    tail_days_high   = float(_rs("audit_tail_high_tolerance_days", db) or "7")
    tail_days_low    = float(_rs("audit_tail_low_tolerance_days", db) or "30")
    tail_low_max_eps = int(_rs("audit_tail_low_max_episodes", db) or "2")

    if not starts_from_ep1:
        stale = oldest_age is not None and oldest_age >= tail_days_low
        return {
            "verdict": "GAP_FROM_START",
            "reason": f"missing_from_ep1:{len(missing)}/{n}",
            "missing_episodes": missing_pairs,
            "starts_from_ep1": False,
            "continuous": tail_only,
            "tail_only_missing": tail_only,
            "newest_missing_age_days": newest_age,
            "oldest_missing_age_days": oldest_age,
            "tolerance": None,
            "stale": stale,
        }

    if not tail_only:
        stale = oldest_age is not None and oldest_age >= tail_days_low
        return {
            "verdict": "GAP_MIDDLE",
            "reason": f"middle_gap:{len(missing)}/{n}",
            "missing_episodes": missing_pairs,
            "starts_from_ep1": True,
            "continuous": False,
            "tail_only_missing": False,
            "newest_missing_age_days": newest_age,
            "oldest_missing_age_days": oldest_age,
            "tolerance": None,
            "stale": stale,
        }

    # Tail-only missing — decide based on freshness of the newest missing episode
    if newest_age is None:
        tolerance, verdict, stale = "unknown", "WAIT_TAIL", False
        reason = f"tail_missing_unknown_age:{len(missing)}/{n}"
    elif newest_age < tail_days_high:
        tolerance, verdict, stale = "high", "WAIT_TAIL", False
        reason = f"tail_missing_fresh_{newest_age:.1f}d:{len(missing)}/{n}"
    elif newest_age < tail_days_low:
        if len(missing) <= tail_low_max_eps:
            tolerance, verdict, stale = "low", "WAIT_TAIL", False
            reason = f"tail_missing_aging_{newest_age:.1f}d_within_tolerance:{len(missing)}/{n}"
        else:
            tolerance, verdict, stale = "low", "TAIL_STALE", True
            reason = f"tail_missing_aging_{newest_age:.1f}d_over_tolerance:{len(missing)}/{n}"
    else:
        tolerance, verdict, stale = "none", "TAIL_STALE", True
        reason = f"tail_missing_stale_{newest_age:.1f}d:{len(missing)}/{n}"

    return {
        "verdict": verdict,
        "reason": reason,
        "missing_episodes": missing_pairs,
        "starts_from_ep1": True,
        "continuous": True,
        "tail_only_missing": True,
        "newest_missing_age_days": newest_age,
        "oldest_missing_age_days": oldest_age,
        "tolerance": tolerance,
        "stale": stale,
    }


# ── Logic 2: damage_ratio ─────────────────────────────────────────────────

def _fetch_seerr_damage_map(db: Session) -> dict[int, dict]:
    """Fetch open Seerr issues and bucket them by tvdbId.

    Returns: { tvdb_id: {"whole": bool, "episodes": set[(season, episode)]} }
      "whole"=True means an open issue exists with no season/episode set —
      treated as a whole-series report (>50% damaged, per spec).
    """
    from .promotion import _seerr_config

    base_url, api_key = _seerr_config(db)
    if not base_url:
        return {}

    try:
        import httpx
        r = httpx.get(
            f"{base_url}/issue",
            headers={"X-Api-Key": api_key},
            params={"take": 100, "sort": "modified"},
            timeout=10,
        )
        r.raise_for_status()
        all_issues = r.json().get("results") or []
    except Exception as exc:
        log.warning("audit: failed to fetch Seerr issues: %s", exc)
        return {}

    out: dict[int, dict] = {}
    for issue in all_issues:
        if issue.get("status") != 1:  # 1 = open
            continue
        media = issue.get("media") or {}
        tvdb_id = media.get("tvdbId")
        if not tvdb_id:
            continue
        try:
            tvdb_id = int(tvdb_id)
        except (TypeError, ValueError):
            continue

        entry = out.setdefault(tvdb_id, {"whole": False, "episodes": set()})

        season  = issue.get("problemSeason")
        episode = issue.get("problemEpisode")
        if season is None or episode is None:
            entry["whole"] = True
        else:
            try:
                entry["episodes"].add((int(season), int(episode)))
            except (TypeError, ValueError):
                entry["whole"] = True

    return out


def evaluate_damage_ratio(series: Series, damage_info: dict | None) -> dict:
    """
    "Is the damage level acceptable?"

    damage_info: {"whole": bool, "episodes": set[(season, episode)]} | None
                 — from _fetch_seerr_damage_map(), for this series' tvdb_id.

    Rules:
      - 0 damaged                → OK
      - 1-2 damaged, <=50%       → WARN (don't degrade)
      - 1-2 damaged, >50%        → DEGRADE (tiebreaker: % wins)
      - 3+  damaged, <25%        → WARN (don't degrade)
      - 3+  damaged, 25-50%      → DEGRADE
      - any damaged, >50%        → DEGRADE (always)
      - whole-series report      → treated as 100% damaged → DEGRADE
    """
    eps = _normalized_episodes(series)
    total = len(eps)

    if total == 0:
        return {
            "verdict": "OK",
            "reason": "no_episodes",
            "damaged_episodes": [],
            "whole_series_damaged": False,
            "damaged_count": 0,
            "total_count": 0,
            "damaged_pct": 0.0,
        }

    info  = damage_info or {}
    whole = bool(info.get("whole"))
    damaged_pairs = {(s, e) for (s, e) in info.get("episodes", set()) if s and s > 0}

    if whole:
        damaged_count = total
        damaged_pct = 1.0
    else:
        damaged_count = sum(
            1 for ep in eps if (ep.season_number, ep.episode_number) in damaged_pairs
        )
        damaged_pct = damaged_count / total if total else 0.0

    if damaged_count == 0:
        verdict, reason = "OK", "no_damage_reports"
    elif damaged_pct > 0.5:
        verdict, reason = "DEGRADE", f"over_50pct:{damaged_count}/{total}"
    elif damaged_count <= 2:
        verdict, reason = "WARN", f"minor_damage:{damaged_count}/{total}"
    elif damaged_pct >= 0.25:
        verdict, reason = "DEGRADE", f"25_50pct:{damaged_count}/{total}"
    else:
        verdict, reason = "WARN", f"under_25pct:{damaged_count}/{total}"

    return {
        "verdict": verdict,
        "reason": reason,
        "damaged_episodes": sorted(damaged_pairs),
        "whole_series_damaged": whole,
        "damaged_count": damaged_count,
        "total_count": total,
        "damaged_pct": damaged_pct,
    }


# ── Logic 4: hiyori "planned / revived" check ──────────────────────────────

def _hiyori_check_due(series: Series, db: Session) -> bool:
    interval_hours = float(_rs("audit_hiyori_check_interval_hours", db) or "24")
    last = _to_aware(series.last_hiyori_check_at)
    if last is None:
        return True
    return (_now() - last).total_seconds() / 3600.0 >= interval_hours


def _run_hiyori_check(db: Session, series: Series) -> dict | None:
    """Logic 4: ask hiyori.cz whether the series is planned / in-progress /
    revived. Returns the scraper's result dict, or None if not configured /
    on error (in which case audit_status falls back to ABANDONED)."""
    result = None
    try:
        from . import hiyori as hiyori_svc

        username = _rs("hiyori_username", db)
        password = _rs("hiyori_password", db)
        if username and password:
            scraper = hiyori_svc.HiyoriScraper(username, password)
            title = series.title_romaji or series.title_japanese or series.title
            result = scraper.check_planned_or_revived(title)
    except Exception as exc:
        log.warning("audit: hiyori planned-check failed for %r: %s", series.title, exc)
        result = None

    series.last_hiyori_check_at = _now()

    if result is not None:
        planned = result.get("planned")
        extra = f" (anime_id={result['anime_id']})" if result.get("anime_id") else ""
        msg = (
            "Hiyori: titul je naplánovaný / rozjetý" + extra
            if planned else
            "Hiyori: titul nenalezen v plánu / probíhajících překladech" + extra
        )
        try:
            _log_event(db, series.id, "hiyori_check", msg, detail=json.dumps(result))
        except Exception:
            pass

    return result


# ── Logic 3: state machine ─────────────────────────────────────────────────

def determine_audit_status(
    subtitle_eval: dict,
    damage_eval: dict,
    hiyori_eval: dict | None,
    current_status: str | None,
) -> tuple[str, str]:
    """
    Combine Logic 1 + Logic 2 (+ Logic 4) results into one of the 6 states.

    Conflict priority (highest first): DAMAGED > PENDING_TRANSLATION >
    PARTIAL > PENDING > ABANDONED > CLEAN.
    """
    # 1. DAMAGED always wins
    if damage_eval["verdict"] == "DEGRADE":
        return "DAMAGED", f"damage_ratio:{damage_eval['reason']}"

    sv = subtitle_eval["verdict"]

    if sv == "NO_FILES":
        return "PENDING", subtitle_eval["reason"]

    if sv == "COMPLETE":
        return "CLEAN", subtitle_eval["reason"]

    if sv == "WAIT_TAIL":
        return "PENDING", subtitle_eval["reason"]

    # sv in (TAIL_STALE, GAP_FROM_START, GAP_MIDDLE)
    if subtitle_eval.get("stale"):
        if hiyori_eval and hiyori_eval.get("planned"):
            return "PENDING_TRANSLATION", f"hiyori_planned:{subtitle_eval['reason']}"
        return "ABANDONED", subtitle_eval["reason"]

    # Gap exists but tolerance not yet exhausted — partial coverage, still hopeful
    return "PARTIAL", subtitle_eval["reason"]


# ── Top level ────────────────────────────────────────────────────────────────

def _maybe_log_damage(db: Session, series: Series, damage_eval: dict) -> None:
    """Log a damage_eval entry only when the situation actually changed."""
    sig = f"{damage_eval['verdict']}:{damage_eval['damaged_count']}/{damage_eval['total_count']}"
    last = (
        db.query(SeriesAuditLog)
        .filter(SeriesAuditLog.series_id == series.id, SeriesAuditLog.event_type == "damage_eval")
        .order_by(SeriesAuditLog.created_at.desc())
        .first()
    )
    if last and last.detail == sig:
        return

    verdict_cz = {"WARN": "Varování", "DEGRADE": "Degradace"}.get(damage_eval["verdict"], damage_eval["verdict"])
    _log_event(
        db, series.id, "damage_eval",
        f"{verdict_cz}: poškozeno {damage_eval['damaged_count']}/{damage_eval['total_count']} epizod "
        f"({damage_eval['damaged_pct'] * 100:.0f} %) — {damage_eval['reason']}",
        detail=sig,
    )


def audit_series(
    db: Session,
    series: Series,
    seerr_map: dict[int, dict] | None = None,
    dir_cache: dict | None = None,
) -> dict:
    """Run the full audit pipeline for one series and persist the result.

    Updates series.audit_status / audit_status_reason / audit_status_since /
    last_hiyori_check_at, and writes audit_log entries for state transitions,
    damage re-evaluations and hiyori checks.
    """
    if dir_cache is None:
        dir_cache = {}

    subtitle_eval = evaluate_subtitle_confidence(series, db, dir_cache)

    if seerr_map is None:
        seerr_map = _fetch_seerr_damage_map(db)
    damage_info = seerr_map.get(int(series.tvdb_id)) if series.tvdb_id else None
    damage_eval = evaluate_damage_ratio(series, damage_info)

    if damage_eval["verdict"] in ("WARN", "DEGRADE"):
        try:
            _maybe_log_damage(db, series, damage_eval)
        except Exception as exc:
            log.warning("audit: _maybe_log_damage failed for %r: %s", series.title, exc)

    hiyori_eval = None
    needs_hiyori = subtitle_eval["verdict"] in ("TAIL_STALE", "GAP_FROM_START", "GAP_MIDDLE") and subtitle_eval.get("stale")
    if needs_hiyori and damage_eval["verdict"] != "DEGRADE" and _hiyori_check_due(series, db):
        hiyori_eval = _run_hiyori_check(db, series)

    new_status, reason = determine_audit_status(subtitle_eval, damage_eval, hiyori_eval, series.audit_status)

    changed = new_status != series.audit_status
    if changed:
        old = series.audit_status or "—"
        _log_event(
            db, series.id, "state_change",
            f"Stav změněn: {old} → {new_status} ({reason})",
            detail=json.dumps({"old": old, "new": new_status, "reason": reason}),
        )
        series.audit_status = new_status
        series.audit_status_since = _now()

    series.audit_status_reason = reason
    db.commit()

    return {
        "series_id": series.id,
        "audit_status": new_status,
        "audit_status_reason": reason,
        "changed": changed,
        "subtitle_eval": subtitle_eval,
        "damage_eval": damage_eval,
        "hiyori_eval": hiyori_eval,
    }


def audit_all(db: Session) -> list[dict]:
    """Audit every series. Returns a list of result dicts (one per series)."""
    seerr_map: dict[int, dict] = {}
    try:
        seerr_map = _fetch_seerr_damage_map(db)
    except Exception as exc:
        log.warning("audit_all: _fetch_seerr_damage_map failed: %s", exc)

    dir_cache: dict = {}
    results: list[dict] = []

    series_list = (
        db.query(Series)
        .options(subqueryload(Series.episodes).subqueryload(Episode.subtitles))
        .all()
    )
    for s in series_list:
        try:
            results.append(audit_series(db, s, seerr_map=seerr_map, dir_cache=dir_cache))
        except Exception as exc:
            log.warning("audit_all: audit_series(%d) failed: %s", s.id, exc)

    return results
