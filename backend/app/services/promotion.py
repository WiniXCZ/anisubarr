"""
promotion.py – Auto-promotion / demotion service.

Promotion rule:
  All monitored (non-special) episodes have files AND every one of those
  episodes has at least one CZ subtitle in the DB
  → Move series to the root folder whose name contains "anime_series"
  → Add Sonarr tag "tit" to the series

Demotion rule:
  Series has an open Seerr issue (status == 1)
  → Set has_issue = True  (shows orange badge in UI)
  → Reset promoted = False
  → Move series back to the root folder whose name contains "incomplete"
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from sqlalchemy.orm import Session, subqueryload

from ..models.series import Series, Episode, Subtitle  # noqa: F401 – needed for relationship loads
from ..services import sonarr as sonarr_svc
from ..utils import has_cs_sub

log = logging.getLogger(__name__)

TIT_TAG  = "tit"


# ── Root-folder helpers ───────────────────────────────────────────────────────

def _find_root_folder(fragment: str) -> str | None:
    """Return the path of the first Sonarr root folder whose last path
    segment contains *fragment* (case-insensitive).  Returns None on error."""
    try:
        folders = sonarr_svc.get_root_folders()
        for f in folders:
            # normalise separators, strip trailing slash
            parts = f["path"].replace("\\", "/").rstrip("/").split("/")
            folder_name = parts[-1] if parts else ""
            if fragment.lower() in folder_name.lower():
                return f["path"]
    except Exception as e:
        log.warning("Could not fetch Sonarr root folders: %s", e)
    return None


def _in_folder(series_path: str, root_folder: str) -> bool:
    """Return True if series_path already lives inside root_folder."""
    norm_series = (series_path or "").replace("\\", "/").lower()
    norm_root   = root_folder.replace("\\", "/").rstrip("/").lower()
    # Add trailing slash to avoid false-positives like /anime_series_backup
    return norm_series.startswith(norm_root + "/") or norm_series == norm_root


# ── Promotion eligibility ─────────────────────────────────────────────────────

def _qualifies_for_promotion(db: Session, series: Series) -> dict:
    """
    Return {"ok": True} or {"ok": False, "reason": str}.

    Specials (season_number == 0) are always ignored.

    Ended / Completed series:
      Every episode with has_file must have a CS subtitle.

    Continuing (or any other active) series:
      Episodes are sorted by (season_number, episode_number).
      - The first episode must have a CS subtitle.
      - All episodes except the last must have CS subtitles
        (unless promo_allow_last_episode_missing is true, which is the default).
      - The last downloaded episode may be missing subtitles (just aired).
    """
    from ..utils.settings_helper import read_setting as _rs
    allow_last_missing = _rs("promo_allow_last_episode_missing", db) != "false"

    eps_with_file = sorted(
        [ep for ep in series.episodes if ep.season_number > 0 and ep.has_file],
        key=lambda ep: (ep.season_number, ep.episode_number),
    )

    if not eps_with_file:
        return {"ok": False, "reason": "no_episodes_with_files"}

    status = (series.status or "").strip().lower()
    is_ended = status in {"ended", "completed"}

    if is_ended:
        missing = [ep for ep in eps_with_file if not has_cs_sub(ep)]
        if missing:
            nums = [f"S{ep.season_number:02d}E{ep.episode_number:02d}" for ep in missing[:5]]
            return {"ok": False, "reason": f"missing_cs:{','.join(nums)}"}
    else:
        # First episode must always have CS subtitles
        if not has_cs_sub(eps_with_file[0]):
            ep = eps_with_file[0]
            return {
                "ok":     False,
                "reason": f"missing_cs_first:S{ep.season_number:02d}E{ep.episode_number:02d}",
            }

        # Check remaining episodes; last one may be exempt when allow_last_missing=True
        must_have_subs = eps_with_file[:-1] if allow_last_missing else eps_with_file
        missing = [ep for ep in must_have_subs if not has_cs_sub(ep)]
        if missing:
            nums = [f"S{ep.season_number:02d}E{ep.episode_number:02d}" for ep in missing[:5]]
            return {"ok": False, "reason": f"missing_cs_middle:{','.join(nums)}"}

    return {"ok": True, "reason": "qualifies"}


# ── Single-series promotion ───────────────────────────────────────────────────

def check_and_promote(db: Session, series: Series) -> dict:
    """
    Check whether *series* qualifies for promotion and, if so, move it to the
    anime_series root folder and add the "tit" Sonarr tag.

    Returns a dict describing the outcome (action, series_id, …).
    """
    # Already promoted and no open issue → nothing to do
    if series.promoted and not series.has_issue:
        return {"action": "already_promoted", "series_id": series.id}

    # Never promote a series that currently has an open Seerr issue —
    # this prevents the double-Discord notification (promoted then immediately demoted).
    if series.has_issue:
        return {"action": "skipped_has_issue", "series_id": series.id}

    # Find the target root folder first — needed for both "already there" and move paths
    target_folder = (
        _find_root_folder("anime_series")
        or _find_root_folder("anime series")
        or _find_root_folder("animeseries")
    )
    if not target_folder:
        log.warning(
            "No anime_series root folder found in Sonarr — cannot promote series %d (%s)",
            series.id, series.title,
        )
        return {"action": "no_target_folder", "series_id": series.id}

    # Already living in the target folder? Mark as promoted regardless of subtitle status.
    # (User may have manually moved it, or it's a series with ongoing subtitle downloads.)
    if series.path and _in_folder(series.path, target_folder):
        changed = False
        if not series.promoted:
            series.promoted = True
            changed = True
        if series.promoted_at is None:
            series.promoted_at = datetime.now(timezone.utc)
            changed = True
        # Do NOT clear has_issue here — that flag is managed by check_and_demote_issues
        # (Seerr issues, subtitle coverage). Clearing it here causes an infinite notification
        # loop: issue flagged → already_in_folder resets flag → issue flagged again next run.
        if changed:
            db.commit()
        return {"action": "already_in_folder", "series_id": series.id}

    # Not in target folder yet — check subtitle eligibility before moving
    eligibility = _qualifies_for_promotion(db, series)
    if not eligibility["ok"]:
        return {"action": "not_ready", "series_id": series.id, "reason": eligibility["reason"]}

    try:
        # Ensure the "tit" tag exists in Sonarr
        tag_id = sonarr_svc.get_or_create_tag(TIT_TAG)

        # Fetch current series data (for the current tag list)
        sonarr_data = sonarr_svc.get_series_by_id(series.sonarr_id)
        if sonarr_data is None:
            return {"action": "sonarr_series_not_found", "series_id": series.id}

        current_tags = sonarr_data.get("tags") or []
        new_tags     = list(set(current_tags + [tag_id]))

        # PUT the updated series back to Sonarr (move files + new root + tag)
        sonarr_svc.update_series(
            series.sonarr_id,
            move_files=True,
            rootFolderPath=target_folder,
            tags=new_tags,
        )

        series.promoted    = True
        series.promoted_at = datetime.now(timezone.utc)
        series.has_issue   = False
        db.commit()

        log.info("Promoted %r (id=%d) → %s", series.title, series.id, target_folder)

        from ..utils.settings_helper import read_setting as _read_setting

        # Auto task: NFO refresh (auto_nfo_on_promote takes precedence, falls back to legacy key)
        nfo_enabled = (
            _read_setting("auto_nfo_on_promote", db) != "false"
            and _read_setting("nfo_auto_refresh_after_promo", db) != "false"
        )
        if nfo_enabled:
            try:
                from . import nfo as nfo_svc
                from . import ai_description as desc_svc
                desc_svc.ensure_czech_description(series, db)
                nfo_svc.write_series_nfo(series)
            except Exception as e:
                log.warning("NFO refresh failed after auto-promotion of '%s': %s", series.title, e)

        # Auto task: Discord notification after promotion
        if _read_setting("auto_discord_on_promote", db) != "false":
            try:
                from . import discord as discord_svc
                discord_svc.notify_promoted(
                    title=series.title,
                    series_id=series.id,
                    poster_url=getattr(series, "poster_url", None),
                    overview=getattr(series, "overview_cs", None) or getattr(series, "overview", None),
                    has_cs=True,
                    emby_id=getattr(series, "emby_id", None),
                    db=db,
                )
            except Exception:
                pass

        # Auto task: Emby library scan after auto-promotion
        if _read_setting("auto_emby_scan_on_promote", db) != "false":
            try:
                from . import emby as emby_svc
                emby_svc.trigger_library_scan(series_title=series.title)
            except Exception as e:
                log.debug("Emby scan skipped after auto-promotion of '%s': %s", series.title, e)

        return {
            "action":    "promoted",
            "series_id": series.id,
            "title":     series.title,
            "folder":    target_folder,
        }

    except Exception as exc:
        log.error("Failed to promote series %d: %s", series.id, exc)
        return {"action": "error", "series_id": series.id, "error": str(exc)}


# ── Manual publish / demote ───────────────────────────────────────────────────

def force_publish(db: Session, series: Series) -> dict:
    """
    Manually publish a series: move to anime_series root folder + add "tit" tag.
    Skips series that have an open Seerr issue (has_issue=True).
    Always marks promoted=True in DB.  Sends Discord notification + triggers
    Emby library scan on success.
    """
    from ..services import job_log
    from ..services import emby as emby_svc

    run = job_log.start_run("publish", f"Publikuji: {series.title}")

    # Do not publish series with an open Seerr issue
    if series.has_issue:
        log.info(
            "force_publish skipped %r (id=%d) — has_issue=True",
            series.title, series.id,
        )
        job_log.finish_run(run, "skipped", "Přeskočeno — série má otevřenou issue v Seerr")
        return {"action": "skipped_has_issue", "series_id": series.id, "title": series.title}

    sonarr_action = "skipped"
    sonarr_error: str | None = None
    target_folder: str | None = None

    try:
        job_log.update_message(run.run_id, "Hledám cílovou složku v Sonarru…")
        target_folder = (
            _find_root_folder("anime_series")
            or _find_root_folder("anime series")
            or _find_root_folder("animeseries")
        )

        if not target_folder:
            # Log all available root folders to help debug naming issues
            try:
                all_folders = sonarr_svc.get_root_folders()
                names = [f["path"] for f in all_folders]
                log.warning(
                    "force_publish: no anime_series root folder found. Available: %s",
                    names,
                )
            except Exception:
                pass
            sonarr_action = "no_target_folder"
        else:
            job_log.update_message(run.run_id, f"Přesouvám do {target_folder}…")
            tag_id = sonarr_svc.get_or_create_tag(TIT_TAG)
            sonarr_data = sonarr_svc.get_series_by_id(series.sonarr_id)
            if sonarr_data is not None:
                current_tags = sonarr_data.get("tags") or []
                new_tags = list(set(current_tags + [tag_id]))

                if not (series.path and _in_folder(series.path, target_folder)):
                    sonarr_svc.update_series(
                        series.sonarr_id,
                        move_files=True,
                        rootFolderPath=target_folder,
                        tags=new_tags,
                    )
                    sonarr_action = "moved"
                else:
                    # Already in correct folder — just update tags
                    sonarr_svc.update_series(series.sonarr_id, tags=new_tags)
                    sonarr_action = "tag_only"
            else:
                sonarr_action = "series_not_in_sonarr"

    except Exception as exc:
        sonarr_error = str(exc)
        log.error("Sonarr step failed during force-publish of series %d: %s", series.id, exc)

    # Always mark as published in DB
    series.promoted    = True
    series.promoted_at = datetime.now(timezone.utc)
    series.has_issue   = False
    db.commit()

    log.info(
        "Force-published %r (id=%d) sonarr_action=%s folder=%s error=%s",
        series.title, series.id, sonarr_action, target_folder, sonarr_error,
    )

    # Discord + Emby scan — only when Sonarr actually moved or tagged
    if sonarr_action in ("moved", "tag_only"):
        try:
            from . import discord as discord_svc
            discord_svc.notify_promoted(
                title=series.title,
                series_id=series.id,
                poster_url=getattr(series, "poster_url", None),
                overview=getattr(series, "overview_cs", None) or getattr(series, "overview", None),
                has_cs=True,
                emby_id=getattr(series, "emby_id", None),
                db=db,
            )
        except Exception:
            pass

        # Regenerate NFO so Emby sees EN title + Czech description (controlled by setting, default true)
        from ..utils.settings_helper import read_setting as _read_setting
        if _read_setting("nfo_auto_refresh_after_promo", db) != "false":
            try:
                from . import nfo as nfo_svc
                from . import ai_description as desc_svc
                desc_svc.ensure_czech_description(series, db)
                nfo_svc.write_series_nfo(series)
                log.info("NFO refreshed for '%s' after promotion", series.title)
            except Exception as e:
                log.warning("NFO refresh failed after promotion of '%s': %s", series.title, e)

        # Trigger Emby library scan so the new anime appears immediately
        job_log.update_message(run.run_id, "Spouštím skenování knihovny Emby…")
        emby_result = emby_svc.trigger_library_scan(series_title=series.title)
        log.info("Emby scan result for '%s': %s", series.title, emby_result)

    # Build final job message
    sonarr_label = {
        "moved":               f"přesunuto → {target_folder}",
        "tag_only":            "tag přidán (složka OK)",
        "no_target_folder":    "⚠️ složka anime_series nenalezena v Sonarru",
        "series_not_in_sonarr": "⚠️ série nenalezena v Sonarru",
        "skipped":             "žádná akce",
    }.get(sonarr_action, sonarr_action)

    final_msg = f"Sonarr: {sonarr_label}"
    if sonarr_error:
        final_msg += f" | chyba: {sonarr_error}"

    job_log.finish_run(run, "error" if sonarr_error else "done", final_msg)

    result = {"action": "published", "series_id": series.id, "sonarr": sonarr_action}
    if target_folder:
        result["folder"] = target_folder
    if sonarr_error:
        result["sonarr_error"] = sonarr_error
    return result


def force_demote(db: Session, series: Series, bypass_protection: bool = False) -> dict:
    """
    Manually move a series back to the incomplete root folder.

    When bypass_protection=False (default), respects demote_protect_completed
    and demote_cooldown_hours.  Pass bypass_protection=True from the UI
    "force demote" action when the user explicitly wants to override guards.
    """
    from ..services import job_log

    run = job_log.start_run("demote", f"Degraduji: {series.title}")

    job_log.update_message(run.run_id, "Hledám složku incomplete v Sonarru…")
    incomplete_folder = (
        _find_root_folder("incomplete_anime")
        or _find_root_folder("incomplete")
    )
    if not incomplete_folder:
        job_log.finish_run(run, "error", "Složka incomplete nenalezena v Sonarru")
        return {"action": "no_incomplete_folder", "series_id": series.id}

    try:
        job_log.update_message(run.run_id, f"Přesouvám zpět do {incomplete_folder}…")
        if not (series.path and _in_folder(series.path, incomplete_folder)):
            sonarr_svc.update_series(
                series.sonarr_id,
                move_files=True,
                rootFolderPath=incomplete_folder,
            )

        series.promoted  = False
        series.has_issue = False
        db.commit()

        log.info("Force-demoted %r (id=%d) → %s", series.title, series.id, incomplete_folder)
        job_log.finish_run(run, "done", f"Přesunuto zpět → {incomplete_folder}")
        return {"action": "demoted", "series_id": series.id, "folder": incomplete_folder}

    except Exception as exc:
        log.error("Failed to force-demote series %d: %s", series.id, exc)
        job_log.finish_run(run, "error", f"Chyba: {exc}")
        return {"action": "error", "series_id": series.id, "error": str(exc)}


# ── Demotion helpers ─────────────────────────────────────────────────────────

def _is_demote_protected(db: Session, series: Series) -> bool:
    """
    Return True if *series* should be shielded from automatic demotion.
    Protection applies when:
      - demote_protect_completed is enabled (default True)
      - series status is "ended" / "Ended"
      - ≥50% of aired episodes already have a CS subtitle
    """
    from ..utils.settings_helper import read_setting as _rs
    if _rs("demote_protect_completed", db) == "false":
        return False
    if (series.status or "").lower() != "ended":
        return False
    from ..routers.subtitles import _already_subbed_ids
    cs_ids = _already_subbed_ids(db, "cs")
    eps_with_file = [ep for ep in series.episodes if ep.season_number > 0 and ep.has_file]
    if not eps_with_file:
        return False
    subbed = sum(1 for ep in eps_with_file if ep.id in cs_ids)
    return (subbed / len(eps_with_file)) >= 0.5


def _within_cooldown(series: Series, cooldown_hours: int) -> bool:
    """
    Return True if *series* was recently promoted and is still within the
    demotion cooldown window.  Uses promoted_at (not updated_at — Sonarr sync
    refreshes updated_at on every series and would block all demotion).
    """
    if cooldown_hours <= 0 or not series.promoted:
        return False
    import datetime
    utc = datetime.timezone.utc
    now = datetime.datetime.now(utc)
    ts = getattr(series, "promoted_at", None)
    if not ts:
        return False  # never explicitly promoted → no cooldown
    promoted = (
        ts.replace(tzinfo=utc) if ts.tzinfo is None else ts
    )
    return (now - promoted).total_seconds() < cooldown_hours * 3600


def _should_demote(
    series: Series,
    db: Session,
    dir_cache: "dict | None" = None,
) -> "tuple[str, str]":
    """
    Analyse CS subtitle coverage of *series* and decide the appropriate action.

    Rules (evaluated in priority order):
      0. No missing episodes                           → ("ok",         "all_subbed")
      1. Exactly 1 episode without CS sub              → demote_single_episode_action (default flag_only)
      2. > demote_pct_threshold % missing              → ("demote",     …)  always
      3. Ended/Completed + ≥ demote_completed_threshold missing → ("demote", …)
      3b. Ended/Completed + below threshold            → ("flag_only",  …)
      4. Continuing + ≥ demote_multi_episode_threshold middle missing → ("demote", …)
         (middle = all except last when demote_allow_last_episode_missing=True)
      5. Continuing + only recent tail episodes bad    → ("flag_only",  …)

    Specials (season_number == 0) are ignored throughout.

    dir_cache: optional shared filesystem cache reused across all episodes of the
    series (avoids redundant os.listdir calls).  A fresh empty dict is created
    per call when None.

    Returns:
        ("demote",    reason_string)
        ("flag_only", reason_string)
        ("ok",        reason_string)
    """
    from ..utils.settings_helper import read_setting as _rs

    if dir_cache is None:
        dir_cache = {}

    single_action       = _rs("demote_single_episode_action",    db) or "flag_only"
    multi_threshold     = int(_rs("demote_multi_episode_threshold", db) or "2")
    completed_threshold = int(_rs("demote_completed_threshold",   db) or "2")
    pct_threshold_int   = int(_rs("demote_pct_threshold",         db) or "10")
    pct_threshold       = pct_threshold_int / 100.0
    allow_last_missing  = _rs("demote_allow_last_episode_missing", db) != "false"

    eps_with_file = sorted(
        [ep for ep in series.episodes if ep.season_number > 0 and ep.has_file],
        key=lambda ep: (ep.season_number, ep.episode_number),
    )

    if not eps_with_file:
        log.debug("_should_demote %r (id=%d): ok — no_episodes_with_files", series.title, series.id)
        return ("ok", "no_episodes_with_files")

    missing = [ep for ep in eps_with_file if not has_cs_sub(ep, dir_cache)]
    missing_count = len(missing)
    total = len(eps_with_file)

    log.debug(
        "_should_demote %r (id=%d): %d/%d missing CS (%.0f%%), status=%s, "
        "pct_threshold=%d%%, multi_thr=%d, completed_thr=%d",
        series.title, series.id, missing_count, total,
        missing_count / total * 100, series.status,
        pct_threshold_int, multi_threshold, completed_threshold,
    )

    if missing_count == 0:
        return ("ok", "all_subbed")

    def _fmt(eps):
        return ",".join(f"S{e.season_number:02d}E{e.episode_number:02d}" for e in eps[:5])

    # Rule 1: single bad episode — configurable action (default: flag only)
    if missing_count == 1:
        log.info(
            "_should_demote %r (id=%d): %s — single missing: %s",
            series.title, series.id, single_action, _fmt(missing),
        )
        return (single_action, f"single_missing:{_fmt(missing)}")

    # Rule 2: percentage threshold (checked before status rules)
    if missing_count / total > pct_threshold:
        log.info(
            "_should_demote %r (id=%d): DEMOTE — %.0f%% > %d%% threshold, missing: %s",
            series.title, series.id, missing_count / total * 100, pct_threshold_int, _fmt(missing),
        )
        return ("demote", f"over_{pct_threshold_int}pct:{_fmt(missing)}")

    # Rules 3 / 4 / 5: status-based (2+ missing, within pct threshold)
    status = (series.status or "").strip().lower()
    is_ended = status in {"ended", "completed"}

    if is_ended:
        if missing_count >= completed_threshold:
            log.info(
                "_should_demote %r (id=%d): DEMOTE — ended, %d missing >= threshold %d, missing: %s",
                series.title, series.id, missing_count, completed_threshold, _fmt(missing),
            )
            return ("demote", f"ended_missing_{completed_threshold}plus:{_fmt(missing)}")
        log.info(
            "_should_demote %r (id=%d): flag_only — ended, %d missing < threshold %d, missing: %s",
            series.title, series.id, missing_count, completed_threshold, _fmt(missing),
        )
        return ("flag_only", f"ended_few_missing:{_fmt(missing)}")

    # Continuing: count missing "middle" episodes
    # When allow_last_missing=True the last episode is exempt (just aired)
    if allow_last_missing:
        middle_missing = [ep for ep in missing if ep != eps_with_file[-1]]
    else:
        middle_missing = missing

    if len(middle_missing) >= multi_threshold:
        log.info(
            "_should_demote %r (id=%d): DEMOTE — continuing, %d middle missing >= threshold %d, missing: %s",
            series.title, series.id, len(middle_missing), multi_threshold, _fmt(middle_missing),
        )
        return ("demote", f"middle_missing:{_fmt(middle_missing)}")

    # Only the recent tail episodes are missing → tolerate
    log.info(
        "_should_demote %r (id=%d): flag_only — continuing, only tail missing: %s",
        series.title, series.id, _fmt(missing),
    )
    return ("flag_only", f"recent_missing:{_fmt(missing)}")


# ── Seerr-driven demotion ─────────────────────────────────────────────────────

def _seerr_config(db: Session) -> tuple[str, str] | tuple[None, None]:
    """Return (base_api_url, api_key) or (None, None) if not configured."""
    try:
        from ..models.app_settings import AppSetting
        rows = (
            db.query(AppSetting)
            .filter(AppSetting.key.in_(["seerr_host", "seerr_api_key"]))
            .all()
        )
        values  = {row.key: row.value for row in rows if row.value}
        host    = values.get("seerr_host")
        api_key = values.get("seerr_api_key")
    except Exception:
        host = api_key = None

    if not host or not api_key:
        # Fall back to environment / .env config
        try:
            from ..config import get_settings
            s       = get_settings()
            host    = host    or (getattr(s, "seerr_host",    "") or "")
            api_key = api_key or (getattr(s, "seerr_api_key", "") or "")
        except Exception:
            pass

    if not host or not api_key:
        return None, None

    host = host.rstrip("/")
    if not host.startswith("http"):
        host = f"http://{host}"
    return f"{host}/api/v1", api_key


def check_and_demote_issues(db: Session) -> list[dict]:
    """
    Poll Seerr for open issues, find matching series by TVDB ID, flag /
    demote them.  Also clears has_issue for series that no longer have open
    issues.

    Returns a list of result dicts.
    """
    from ..utils.settings_helper import read_setting as _rs

    # Respect the demote_on_seerr_report toggle (default True)
    if _rs("demote_on_seerr_report", db) == "false":
        log.info("Seerr-driven demotion disabled (demote_on_seerr_report=false)")
        return []

    base_url, api_key = _seerr_config(db)
    if not base_url:
        log.info("Seerr not configured — skipping issue check")
        return []

    try:
        import httpx
        all_issues: list = []
        take = 100
        skip = 0
        max_pages = 20  # safety cap (2000 issues) against pathological responses
        for _ in range(max_pages):
            r = httpx.get(
                f"{base_url}/issue",
                headers={"X-Api-Key": api_key},
                params={"take": take, "skip": skip, "filter": "open", "sort": "modified"},
                timeout=10,
            )
            r.raise_for_status()
            data = r.json()
            page_results = data.get("results") or []
            all_issues.extend(page_results)

            page_info = data.get("pageInfo") or {}
            total_pages = page_info.get("pages") or 1
            current_page = page_info.get("page") or 1
            if not page_results or current_page >= total_pages:
                break
            skip += take
    except Exception as exc:
        log.warning("Failed to fetch Seerr issues: %s", exc)
        return []

    # Collect TVDB IDs with at least one open issue
    open_issue_tvdb: set[int] = set()
    for issue in all_issues:
        if issue.get("status") != 1:   # 1 = open
            continue
        media   = issue.get("media") or {}
        tvdb_id = media.get("tvdbId")
        if tvdb_id:
            open_issue_tvdb.add(int(tvdb_id))

    incomplete_folder = (
        _find_root_folder("incomplete_anime")
        or _find_root_folder("incomplete")
    )

    # Read demotion control settings once (shared across all series in this run)
    error_mode      = _rs("demote_on_episode_error", db) or "flag_only"
    cooldown_hours  = int(_rs("demote_cooldown_hours", db) or "24")

    results: list[dict] = []

    for s in (
        db.query(Series)
        .options(subqueryload(Series.episodes).subqueryload(Episode.subtitles))
        .all()
    ):
        in_open = bool(s.tvdb_id and int(s.tvdb_id) in open_issue_tvdb)

        if in_open:
            if not s.has_issue:
                # "never" — don't react to episode errors at all
                if error_mode == "never":
                    continue

                # Protected completed series — flag only, never move
                if _is_demote_protected(db, s):
                    s.has_issue = True
                    db.commit()
                    results.append({
                        "action":    "issue_flagged",
                        "series_id": s.id,
                        "title":     s.title,
                        "note":      "protected_completed",
                    })
                    continue

                # Cooldown — recently promoted, flag only for now
                if _within_cooldown(s, cooldown_hours):
                    s.has_issue = True
                    db.commit()
                    results.append({
                        "action":    "issue_flagged",
                        "series_id": s.id,
                        "title":     s.title,
                        "note":      "cooldown",
                    })
                    continue

                # _should_demote decides flag-only vs full demotion based on
                # actual CS subtitle coverage.  error_mode="flag_only" can still
                # suppress file movement as a global safety override.
                verdict, reason = _should_demote(s, db)

                s.has_issue = True
                if verdict == "demote":
                    s.promoted = False

                # Move files only when both the subtitle analysis AND the global
                # setting agree on a full demotion.
                do_move = (verdict == "demote") and (error_mode != "flag_only")

                if do_move and incomplete_folder and s.path and not _in_folder(s.path, incomplete_folder):
                    try:
                        sonarr_svc.update_series(
                            s.sonarr_id,
                            move_files=True,
                            rootFolderPath=incomplete_folder,
                        )
                        results.append({
                            "action":    "demoted",
                            "series_id": s.id,
                            "title":     s.title,
                            "reason":    reason,
                        })
                        try:
                            from . import discord as discord_svc
                            discord_svc.notify_demoted(
                                title=s.title,
                                series_id=s.id,
                                poster_url=getattr(s, "poster_url", None),
                                db=db,
                            )
                        except Exception:
                            pass
                    except Exception as exc:
                        log.error("Failed to move series %d to incomplete folder: %s", s.id, exc)
                        results.append({
                            "action":    "demotion_error",
                            "series_id": s.id,
                            "error":     str(exc),
                        })
                else:
                    results.append({
                        "action":    "issue_flagged",
                        "series_id": s.id,
                        "title":     s.title,
                        "reason":    reason,
                    })
                    try:
                        from . import discord as discord_svc
                        discord_svc.notify_issue_flagged(
                            title=s.title,
                            series_id=s.id,
                            poster_url=getattr(s, "poster_url", None),
                            db=db,
                        )
                    except Exception:
                        pass
                db.commit()

        else:
            # Issue resolved — clear the flag
            if s.has_issue:
                s.has_issue = False
                db.commit()
                results.append({
                    "action":    "issue_cleared",
                    "series_id": s.id,
                    "title":     s.title,
                })

    return results


# ── One-time integrity fix ────────────────────────────────────────────────────

def fix_wrongly_promoted(db: Session, notify: bool = True) -> list[dict]:
    """
    Scan all promoted series and apply _should_demote logic:
      "demote"    → set promoted=False, has_issue=True
      "flag_only" → set has_issue=True, leave promoted=True (1 bad ep or fresh tail)
      "ok"        → no change (clears a stale has_issue flag if present)

    Does NOT call Sonarr — only updates the DB.

    notify=False suppresses all Discord notifications (use at startup to avoid
    sending messages on every backend restart).
    """
    results: list[dict] = []
    promoted_series = (
        db.query(Series)
        .options(subqueryload(Series.episodes).subqueryload(Episode.subtitles))
        .filter(Series.promoted == True)  # noqa: E712
        .all()
    )

    for s in promoted_series:
        verdict, reason = _should_demote(s, db)

        if verdict == "ok":
            if s.has_issue:
                s.has_issue = False
                db.commit()
            continue

        if verdict == "demote":
            s.promoted  = False
            s.has_issue = True
            db.commit()
            log.info(
                "fix_wrongly_promoted: demoted %r (id=%d) — %s",
                s.title, s.id, reason,
            )
            results.append({
                "action":    "demoted",
                "series_id": s.id,
                "title":     s.title,
                "reason":    reason,
            })
            if notify:
                try:
                    from . import discord as discord_svc
                    discord_svc.notify_demoted(
                        title=s.title,
                        series_id=s.id,
                        poster_url=getattr(s, "poster_url", None),
                        db=db,
                    )
                except Exception:
                    pass
        else:  # flag_only
            if not s.has_issue:
                s.has_issue = True
                db.commit()
                log.info(
                    "fix_wrongly_promoted: flagged %r (id=%d) — %s",
                    s.title, s.id, reason,
                )
                results.append({
                    "action":    "issue_flagged",
                    "series_id": s.id,
                    "title":     s.title,
                    "reason":    reason,
                })
                if notify:
                    try:
                        from . import discord as discord_svc
                        discord_svc.notify_issue_flagged(
                            title=s.title,
                            series_id=s.id,
                            poster_url=getattr(s, "poster_url", None),
                            db=db,
                        )
                    except Exception:
                        pass

    if results:
        demoted = sum(1 for r in results if r["action"] == "demoted")
        flagged = sum(1 for r in results if r["action"] == "issue_flagged")
        log.info("fix_wrongly_promoted: %d demoted, %d flagged", demoted, flagged)
    else:
        log.info("fix_wrongly_promoted: all promoted series OK — nothing changed")
    return results


# ── Scheduled subtitle-coverage demotion ─────────────────────────────────────

def _demote_by_subtitle_coverage(db: Session) -> list[dict]:
    """
    Scheduled sweep: loop all promoted series and apply _should_demote logic.
    Unlike fix_wrongly_promoted (DB-only, startup-only), this also moves files
    in Sonarr when the verdict is "demote" and the global settings allow it.

    Called from run_all_promotions so it runs on every scheduler tick.
    """
    from ..utils.settings_helper import read_setting as _rs

    error_mode     = _rs("demote_on_episode_error", db) or "flag_only"
    if error_mode == "never":
        return []

    cooldown_hours = int(_rs("demote_cooldown_hours", db) or "24")

    incomplete_folder = (
        _find_root_folder("incomplete_anime")
        or _find_root_folder("incomplete")
    )

    results: list[dict] = []
    promoted_series = (
        db.query(Series)
        .options(subqueryload(Series.episodes).subqueryload(Episode.subtitles))
        .filter(Series.promoted == True)  # noqa: E712
        .all()
    )

    for s in promoted_series:
        # Already flagged — handled by check_and_demote_issues
        if s.has_issue:
            continue

        # Respect protection and cooldown guards (same as Seerr-driven path)
        if _is_demote_protected(db, s):
            continue
        if _within_cooldown(s, cooldown_hours):
            continue

        verdict, reason = _should_demote(s, db)

        if verdict == "ok":
            continue

        if verdict == "flag_only":
            s.has_issue = True
            db.commit()
            log.info(
                "_demote_by_subtitle_coverage: flagged %r (id=%d) — %s",
                s.title, s.id, reason,
            )
            results.append({
                "action":    "issue_flagged",
                "series_id": s.id,
                "title":     s.title,
                "reason":    reason,
            })
            try:
                from . import discord as discord_svc
                discord_svc.notify_issue_flagged(
                    title=s.title,
                    series_id=s.id,
                    poster_url=getattr(s, "poster_url", None),
                    db=db,
                )
            except Exception:
                pass
            continue

        # verdict == "demote"
        s.promoted  = False
        s.has_issue = True
        db.commit()

        do_move = (error_mode != "flag_only") and incomplete_folder
        if do_move and s.path and not _in_folder(s.path, incomplete_folder):
            try:
                sonarr_svc.update_series(
                    s.sonarr_id,
                    move_files=True,
                    rootFolderPath=incomplete_folder,
                )
                log.info(
                    "_demote_by_subtitle_coverage: demoted %r (id=%d) → %s — %s",
                    s.title, s.id, incomplete_folder, reason,
                )
                results.append({
                    "action":    "demoted",
                    "series_id": s.id,
                    "title":     s.title,
                    "reason":    reason,
                })
                try:
                    from . import discord as discord_svc
                    discord_svc.notify_demoted(
                        title=s.title,
                        series_id=s.id,
                        poster_url=getattr(s, "poster_url", None),
                        db=db,
                    )
                except Exception:
                    pass
            except Exception as exc:
                log.error(
                    "_demote_by_subtitle_coverage: Sonarr move failed for series %d: %s",
                    s.id, exc,
                )
                results.append({
                    "action":    "demotion_error",
                    "series_id": s.id,
                    "title":     s.title,
                    "error":     str(exc),
                })
        else:
            # DB demoted but no file move (flag_only mode or no incomplete folder)
            log.info(
                "_demote_by_subtitle_coverage: demoted DB-only %r (id=%d) — %s",
                s.title, s.id, reason,
            )
            results.append({
                "action":    "demoted",
                "series_id": s.id,
                "title":     s.title,
                "reason":    reason,
            })
            try:
                from . import discord as discord_svc
                discord_svc.notify_demoted(
                    title=s.title,
                    series_id=s.id,
                    poster_url=getattr(s, "poster_url", None),
                    db=db,
                )
            except Exception:
                pass

    return results


# ── Run everything ────────────────────────────────────────────────────────────

def _check_full_series_missing(db: Session) -> list[dict]:
    """
    Demote promoted series that have zero CS subtitles across all aired episodes.
    Controlled by the demote_on_full_series_missing setting (default True).
    """
    from ..utils.settings_helper import read_setting as _rs
    if _rs("demote_on_full_series_missing", db) == "false":
        return []

    from ..routers.subtitles import _already_subbed_ids
    cs_ids = _already_subbed_ids(db, "cs")

    results: list[dict] = []

    # Never auto-demote series that are already in the anime_series folder —
    # they were placed there intentionally and should stay promoted.
    _anime_target = (
        _find_root_folder("anime_series")
        or _find_root_folder("anime series")
        or _find_root_folder("animeseries")
    )

    promoted_series = db.query(Series).filter(Series.promoted == True).all()  # noqa: E712
    for s in promoted_series:
        if s.has_issue:
            continue  # already flagged elsewhere
        if _anime_target and s.path and _in_folder(s.path, _anime_target):
            continue  # physically in anime_series — never auto-demote
        eps_with_file = [ep for ep in s.episodes if ep.season_number > 0 and ep.has_file]
        if not eps_with_file:
            continue
        has_any_cs = any(ep.id in cs_ids for ep in eps_with_file)
        if not has_any_cs:
            s.has_issue = True
            s.promoted  = False
            db.commit()
            log.info("Series %d (%r) demoted — zero CS subtitles", s.id, s.title)
            results.append({"action": "demoted_no_subs", "series_id": s.id, "title": s.title})
            try:
                from . import discord as discord_svc
                discord_svc.notify_demoted(
                    title=s.title,
                    series_id=s.id,
                    reason="Série nemá žádné CZ titulky — vrácena do neúplné složky.",
                    poster_url=getattr(s, "poster_url", None),
                    db=db,
                )
            except Exception:
                pass
    return results


def run_all_promotions(db: Session) -> list[dict]:
    """
    1. Demote / flag series with open Seerr issues.
    2. Demote promoted series that lost all CS subtitles.
    3. Demote promoted series based on subtitle coverage analysis (scheduled sweep).
    4. Promote all series that now qualify.

    Returns a combined list of result dicts for non-trivial actions.
    """
    results: list[dict] = []

    # Step 1: flag / demote series with open Seerr issues
    try:
        results.extend(check_and_demote_issues(db))
    except Exception as _e:
        log.warning("run_all_promotions: check_and_demote_issues failed: %s", _e)

    # Step 2: demote promoted series with zero CS subtitles
    try:
        results.extend(_check_full_series_missing(db))
    except Exception as _e:
        log.warning("run_all_promotions: _check_full_series_missing failed: %s", _e)

    # Step 3: demote based on per-episode coverage analysis
    try:
        results.extend(_demote_by_subtitle_coverage(db))
    except Exception as _e:
        log.warning("run_all_promotions: _demote_by_subtitle_coverage failed: %s", _e)

    # Step 4: promote all series that now qualify (or confirm already-in-folder ones)
    all_series = (
        db.query(Series)
        .options(subqueryload(Series.episodes).subqueryload(Episode.subtitles))
        .all()
    )
    for s in all_series:
        try:
            r = check_and_promote(db, s)
            action = r.get("action", "")
            if action not in ("already_promoted", "not_ready", "no_target_folder",
                              "not_configured", "already_in_folder"):
                results.append(r)
        except Exception as _e:
            log.warning("run_all_promotions: check_and_promote(%d) failed: %s", s.id, _e)

    return results
