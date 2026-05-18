"""
promotion.py – Auto-promotion / demotion service.

Promotion rule:
  All monitored (non-special) episodes have files AND every one of those
  episodes has at least one CZ subtitle in the DB
  → Move series to the root folder whose name contains "anime_series"
  → Add Sonarr tag "tit" to the series

Demotion rule:
  Series has an open Overseerr issue (status == 1)
  → Set has_issue = True  (shows orange badge in UI)
  → Reset promoted = False
  → Move series back to the root folder whose name contains "incomplete"
"""
from __future__ import annotations

import logging
from sqlalchemy.orm import Session

from ..models.series import Series, Episode, Subtitle  # noqa: F401 – needed for relationship loads
from ..services import sonarr as sonarr_svc

log = logging.getLogger(__name__)

CZ_LANGS = {"cs", "cze", "cz", "ces"}
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
    norm_series = (series_path or "").replace("\\", "/")
    norm_root   = root_folder.replace("\\", "/").rstrip("/")
    return norm_series.startswith(norm_root)


# ── Promotion eligibility ─────────────────────────────────────────────────────

def _qualifies_for_promotion(db: Session, series: Series) -> dict:
    """
    Return a dict with:
      - "ok": True  → series qualifies for promotion
      - "ok": False + "reason": str  → why it does not qualify

    Rules:
    1. All non-special episodes must have a file (nothing missing).
    2. At least the first episode (lowest episode_number in the first season) must
       have a CZ subtitle in the DB.  Remaining episodes are allowed to be subtitle-
       free — they will be flagged as missing but do not block promotion.
    """
    all_eps = [ep for ep in series.episodes if ep.season_number > 0]
    if not all_eps:
        return {"ok": False, "reason": "no_episodes"}

    # Rule 1 — every episode must have a file
    missing_files = [ep for ep in all_eps if not ep.has_file]
    if missing_files:
        nums = sorted(f"{ep.season_number}x{ep.episode_number:02d}" for ep in missing_files)
        return {"ok": False, "reason": f"missing_files:{','.join(nums[:5])}"}

    # Rule 2 — at least the first episode has a CZ subtitle
    from ..routers.subtitles import _already_subbed_ids
    subbed_ids = _already_subbed_ids(db, "cs")

    eps_with_file = [ep for ep in all_eps if ep.has_file]
    eps_sorted    = sorted(eps_with_file, key=lambda e: (e.season_number, e.episode_number))
    if not eps_sorted:
        return {"ok": False, "reason": "no_files"}

    first_ep = eps_sorted[0]
    if first_ep.id not in subbed_ids:
        return {
            "ok":     False,
            "reason": f"first_episode_no_cs:{first_ep.season_number}x{first_ep.episode_number:02d}",
        }

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

    # Never promote a series that currently has an open Overseerr issue —
    # this prevents the double-Discord notification (promoted then immediately demoted).
    if series.has_issue:
        return {"action": "skipped_has_issue", "series_id": series.id}

    eligibility = _qualifies_for_promotion(db, series)
    if not eligibility["ok"]:
        return {"action": "not_ready", "series_id": series.id, "reason": eligibility["reason"]}

    # Find the target root folder
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

    # Already living in the target folder?
    if series.path and _in_folder(series.path, target_folder):
        series.promoted  = True
        series.has_issue = False
        db.commit()
        return {"action": "already_in_folder", "series_id": series.id}

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

        series.promoted  = True
        series.has_issue = False
        db.commit()

        log.info("Promoted %r (id=%d) → %s", series.title, series.id, target_folder)

        # Discord notification (best-effort)
        try:
            from . import discord as discord_svc
            discord_svc.notify_promoted(
                title=series.title,
                series_id=series.id,
                poster_url=getattr(series, "poster_url", None),
                overview=getattr(series, "overview_cs", None) or getattr(series, "overview", None),
                has_cs=True,
                db=db,
            )
        except Exception:
            pass

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
    Skips series that have an open Overseerr issue (has_issue=True).
    Always marks promoted=True in DB.  Sends Discord notification + triggers
    Emby library scan on success.
    """
    from ..services import job_log
    from ..services import emby as emby_svc

    run = job_log.start_run("publish", f"Publikuji: {series.title}")

    # Do not publish series with an open Overseerr issue
    if series.has_issue:
        log.info(
            "force_publish skipped %r (id=%d) — has_issue=True",
            series.title, series.id,
        )
        job_log.finish_run(run, "skipped", "Přeskočeno — série má otevřenou issue v Overseerru")
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
    series.promoted  = True
    series.has_issue = False
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
                db=db,
            )
        except Exception:
            pass

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


def force_demote(db: Session, series: Series) -> dict:
    """
    Manually move a series back to the incomplete root folder.
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


# ── Overseerr-driven demotion ─────────────────────────────────────────────────

def _overseerr_config(db: Session) -> tuple[str, str] | tuple[None, None]:
    """Return (base_api_url, api_key) or (None, None) if not configured."""
    try:
        from ..models.app_settings import AppSetting
        host_row = db.query(AppSetting).filter(AppSetting.key == "overseerr_host").first()
        key_row  = db.query(AppSetting).filter(AppSetting.key == "overseerr_api_key").first()
        host    = host_row.value if host_row and host_row.value else None
        api_key = key_row.value  if key_row  and key_row.value  else None
    except Exception:
        host = api_key = None

    if not host or not api_key:
        # Fall back to environment / .env config
        try:
            from ..config import get_settings
            s       = get_settings()
            host    = host    or (getattr(s, "overseerr_host",    "") or "")
            api_key = api_key or (getattr(s, "overseerr_api_key", "") or "")
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
    Poll Overseerr for open issues, find matching series by TVDB ID, flag /
    demote them.  Also clears has_issue for series that no longer have open
    issues.

    Returns a list of result dicts.
    """
    base_url, api_key = _overseerr_config(db)
    if not base_url:
        log.info("Overseerr not configured — skipping issue check")
        return []

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
        log.warning("Failed to fetch Overseerr issues: %s", exc)
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

    results: list[dict] = []

    for s in db.query(Series).all():
        in_open = bool(s.tvdb_id and int(s.tvdb_id) in open_issue_tvdb)

        if in_open:
            if not s.has_issue:
                s.has_issue = True
                s.promoted  = False

                # Try to move back to incomplete folder
                if incomplete_folder and s.path and not _in_folder(s.path, incomplete_folder):
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
                        })
                        # Discord notification for demotion
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
                    })
                    # Discord notification for flagged issue (no move)
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


# ── Run everything ────────────────────────────────────────────────────────────

def run_all_promotions(db: Session) -> list[dict]:
    """
    1. Demote / flag series with open Overseerr issues.
    2. Promote all series that now qualify.

    Returns a combined list of result dicts for non-trivial actions.
    """
    results: list[dict] = []

    # Demotion pass first so that a series that has an issue is not promoted
    results.extend(check_and_demote_issues(db))

    # Promotion pass — reload series so has_issue reflects the demotion pass above
    db.expire_all()
    for s in db.query(Series).all():
        res = check_and_promote(db, s)
        action = res.get("action")
        # Only include interesting results (skip boring / skipped states)
        if action not in ("not_ready", "already_promoted", "already_in_folder", "skipped_has_issue"):
            results.append(res)

    return results
