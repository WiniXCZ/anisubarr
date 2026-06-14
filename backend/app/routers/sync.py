"""
sync.py – Sonarr ↔ AniList sync router.
Pulls everything Sonarr has, enriches with AniList metadata, persists to DB.
"""
import logging
import time
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, BackgroundTasks, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..deps import require_admin, get_current_user
from ..models.series import Series, Episode
from ..models.user import User
from ..services import sonarr as sonarr_svc
from ..services import anilist as anilist_svc

log = logging.getLogger("anisubarr.sync")

router = APIRouter(prefix="/api/sync", tags=["sync"])


@router.post("/sonarr", status_code=202)
def sync_sonarr(
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    background_tasks.add_task(_full_sync_logged)
    return {"status": "sync started"}


@router.post("/sonarr/{sonarr_id}", status_code=202)
def sync_one(
    sonarr_id: int,
    background_tasks: BackgroundTasks,
    _: User = Depends(require_admin),
):
    background_tasks.add_task(_sync_series_logged, sonarr_id)
    return {"status": "sync started", "sonarr_id": sonarr_id}


@router.post("/auto-unmonitor", status_code=202)
def auto_unmonitor(
    background_tasks: BackgroundTasks,
    body: dict | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """
    Scan all series and unmonitor in Sonarr:
      \u2022 episodes that have Czech subtitles
      \u2022 whole series where every episode with a file has Czech subtitles

    body (optional): { series_ids: [int, ...] }  \u2014 limit to specific series
    """
    body = body or {}
    series_ids = body.get("series_ids") if isinstance(body, dict) else None
    background_tasks.add_task(_auto_unmonitor_task, series_ids)
    return {"status": "started"}


@router.get("/status")
def sync_status(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    total       = db.query(Series).count()
    with_al     = db.query(Series).filter(Series.anilist_id.isnot(None)).count()
    with_files  = db.query(Series).filter(Series.episode_file_count > 0).count()
    sonarr_info = sonarr_svc.test_connection()
    return {
        "total_series":   total,
        "with_anilist":   with_al,
        "with_files":     with_files,
        "sonarr":         sonarr_info,
    }


@router.get("/sonarr/health")
def sonarr_health(_: User = Depends(get_current_user)):
    return sonarr_svc.test_connection()


@router.get("/sonarr/diskspace")
def disk_space(_: User = Depends(get_current_user)):
    try:
        return sonarr_svc.get_disk_space()
    except Exception as e:
        raise HTTPException(502, f"Sonarr error: {e}")


@router.get("/sonarr/tags")
def sonarr_tags(_: User = Depends(get_current_user)):
    """Return all Sonarr tags as [{id, label}]."""
    try:
        return sonarr_svc.get_tags_full()
    except Exception as e:
        raise HTTPException(502, f"Sonarr error: {e}")


@router.get("/sonarr/root-folders")
def sonarr_root_folders(_: User = Depends(get_current_user)):
    """Return all Sonarr root folders."""
    try:
        return sonarr_svc.get_root_folders()
    except Exception as e:
        raise HTTPException(502, f"Sonarr error: {e}")


@router.patch("/sonarr/series/{series_id}/tags")
def update_series_tags(
    series_id: int,
    body: dict,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Update Sonarr tags for a series. body: {tag_ids: [int, ...]}"""
    import json
    s = db.query(Series).filter(Series.id == series_id).first()
    if not s:
        raise HTTPException(404, "Series not found")
    tag_ids = body.get("tag_ids", [])
    try:
        # Update in Sonarr
        sonarr_svc.update_series(s.sonarr_id, tags=tag_ids)
        # Resolve labels and update local DB
        tag_map = sonarr_svc.get_tags()
        tag_labels = [tag_map[tid] for tid in tag_ids if tid in tag_map]
        s.sonarr_tags = json.dumps(tag_labels, ensure_ascii=False) if tag_labels else None
        db.commit()
        return {"sonarr_tags": tag_labels}
    except Exception as e:
        raise HTTPException(502, f"Sonarr error: {e}")


@router.patch("/sonarr/series/{series_id}/root-folder")
def update_series_root_folder(
    series_id: int,
    body: dict,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Update root folder for a series in Sonarr (with file move). body: {root_folder_path: str}"""
    from ..services import job_log
    s = db.query(Series).filter(Series.id == series_id).first()
    if not s:
        raise HTTPException(404, "Series not found")
    root_folder_path = body.get("root_folder_path", "")
    if not root_folder_path:
        raise HTTPException(400, "root_folder_path required")
    old_series_path = s.path or "\u2014"
    # Derive old root folder (parent of the series folder) for consistent labelling
    import posixpath, ntpath
    _sep = "/" if "/" in old_series_path else "\\"
    _join = posixpath if _sep == "/" else ntpath
    old_root = _join.dirname(old_series_path) if old_series_path != "\u2014" else "\u2014"
    sonarr_id = s.sonarr_id
    # Label shows root folder -> root folder so both sides are comparable
    run = job_log.start_run(
        "root_folder_move",
        f"P\u0159esun ko\u0159enov\u00e9 slo\u017eky ({s.title}): {old_root} \u2192 {root_folder_path}",
    )
    try:
        # move_files=True tells Sonarr to physically relocate all media files
        # (MKV, subtitles, NFO, posters, images) to the new root folder.
        result = sonarr_svc.update_series(s.sonarr_id, rootFolderPath=root_folder_path, move_files=True)
        # Sonarr returns the actual new path (series folder, not root folder)
        new_path = result.get("path") or root_folder_path
        s.path = new_path
        db.commit()
        # Finish message shows full series paths so it is clear where files ended up
        job_log.finish_run(run, "done", f"{old_series_path} \u2192 {new_path}")
        # Queue a delayed sync so episode file_paths get updated after Sonarr moves files
        background_tasks.add_task(_delayed_sync_series, sonarr_id, delay_sec=8)
        return {"path": new_path, "move_files": True}
    except Exception as e:
        job_log.finish_run(run, "error", str(e)[:300])
        raise HTTPException(502, f"Sonarr error: {e}")


@router.post("/sonarr/bulk-root-folder", status_code=202)
def bulk_root_folder(
    body: dict,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Move multiple series to a new root folder. body: {series_ids: [int, ...], root_folder_path: str}"""
    series_ids = body.get("series_ids", [])
    root_folder_path = body.get("root_folder_path", "")
    if not series_ids or not root_folder_path:
        raise HTTPException(400, "series_ids and root_folder_path required")
    background_tasks.add_task(_bulk_root_folder_bg, series_ids, root_folder_path)
    return {"status": "started", "count": len(series_ids)}


# ──────────────────────────────────────────────
# Background workers
# ──────────────────────────────────────────────

def _bulk_root_folder_bg(series_ids: list[int], root_folder_path: str) -> None:
    """Background: move multiple series to a new root folder one by one."""
    from ..services import job_log
    from ..database import SessionLocal
    import time

    run = job_log.start_run(
        "bulk_root_folder_move",
        f"Hromadn\u00fd p\u0159esun do {root_folder_path} ({len(series_ids)} s\u00e9ri\u00ed)",
    )
    total = len(series_ids)
    errors: list[str] = []
    try:
        db = SessionLocal()
        try:
            series_list = db.query(Series).filter(Series.id.in_(series_ids)).all()
        finally:
            db.close()

        for idx, s in enumerate(series_list, 1):
            job_log.update_progress(run.run_id, idx - 1, total, f"{idx}/{total} \u2014 {s.title}")
            try:
                result = sonarr_svc.update_series(
                    s.sonarr_id, rootFolderPath=root_folder_path, move_files=True
                )
                new_path = result.get("path") or root_folder_path
                db2 = SessionLocal()
                try:
                    row = db2.query(Series).filter(Series.id == s.id).first()
                    if row:
                        row.path = new_path
                        db2.commit()
                finally:
                    db2.close()
                # Small delay to avoid hammering Sonarr
                if idx < total:
                    time.sleep(1)
            except Exception as e:
                errors.append(f"{s.title}: {str(e)[:120]}")

        if errors:
            job_log.finish_run(
                run, "error", f"Hotovo s {len(errors)} chybami: {'; '.join(errors[:2])}"
            )
        else:
            job_log.finish_run(
                run, "done", f"P\u0159esunuto {total} s\u00e9ri\u00ed \u2192 {root_folder_path}"
            )

        # Queue delayed syncs so episode paths get updated
        import threading, time as _time
        def _delayed_resync():
            _time.sleep(10)
            for s in series_list:
                try:
                    _sync_series(s.sonarr_id)
                except Exception:
                    pass
        threading.Thread(target=_delayed_resync, daemon=True).start()

    except Exception as e:
        job_log.finish_run(run, "error", str(e)[:300])


def _full_sync_logged():
    """_full_sync obaleny job_log zaznamy."""
    from ..services import job_log
    run = job_log.start_run("sonarr_sync", "Sonarr sync")
    try:
        _full_sync()
        job_log.finish_run(run, "done")
    except Exception as e:
        job_log.finish_run(run, "error", str(e)[:300])
        raise

    # Auto task: run promotion check after sync if enabled (default true)
    try:
        from ..database import SessionLocal as _SL
        from ..utils.settings_helper import read_setting as _rs
        _db = _SL()
        try:
            if _rs("auto_promote_check_on_sync", _db) != "false":
                from ..services.promotion import run_all_promotions
                run_all_promotions(_db)
                log.info("[sync] auto_promote_check_on_sync: kontrola dokoncena")
        finally:
            _db.close()
    except Exception as e:
        log.warning("[sync] auto_promote_check_on_sync failed: %s", e)


def _sync_series_logged(sonarr_id: int):
    """_sync_series obaleny job_log zaznamy."""
    from ..services import job_log
    run = job_log.start_run("sonarr_sync_one", f"Sync serie #{sonarr_id}")
    try:
        _sync_series(sonarr_id)
        job_log.finish_run(run, "done")
    except Exception as e:
        job_log.finish_run(run, "error", str(e)[:300])
        raise


def _delayed_sync_series(sonarr_id: int, delay_sec: int = 8) -> None:
    """Wait delay_sec seconds (for Sonarr to process the move), then sync the series."""
    import time
    from ..services import job_log
    time.sleep(delay_sec)
    run = job_log.start_run("sonarr_sync_one", f"Sync po presunu slozky (serie #{sonarr_id})")
    try:
        _sync_series(sonarr_id)
        job_log.finish_run(run, "done", "Cesty epizod aktualizovany")
    except Exception as e:
        job_log.finish_run(run, "error", str(e)[:300])


def _full_sync():
    """Pull every series from Sonarr, sync them all."""
    try:
        series_list = sonarr_svc.get_series()
    except Exception as e:
        log.error("[sync] Sonarr fetch failed: %s", e)
        return

    # Pre-fetch quality profiles and tags once for the whole run
    quality_map = sonarr_svc.get_quality_profiles()
    tag_map     = sonarr_svc.get_tags()

    for raw in series_list:
        try:
            _sync_series_raw(raw, quality_map, tag_map)
        except Exception as e:
            log.error("[sync] Series '%s' failed: %s", raw.get("title"), e)


def _sync_series(sonarr_id: int):
    """Sync a single series by Sonarr ID (fetches fresh from API)."""
    raw = sonarr_svc.get_series_by_id(sonarr_id)
    if not raw:
        return
    quality_map = sonarr_svc.get_quality_profiles()
    tag_map     = sonarr_svc.get_tags()
    _sync_series_raw(raw, quality_map, tag_map)


def _sync_series_raw(raw: dict, quality_map: dict, tag_map: dict):
    """Write one Sonarr series + its episodes into DB."""
    from ..database import SessionLocal

    db = SessionLocal()
    try:
        sonarr_id = raw["id"]
        fields    = sonarr_svc.extract_series_fields(raw, quality_map, tag_map)

        # Upsert series row
        row = db.query(Series).filter(Series.sonarr_id == sonarr_id).first()
        is_new = row is None
        if not row:
            row = Series(sonarr_id=sonarr_id)
            db.add(row)

        for k, v in fields.items():
            setattr(row, k, v)

        row.synced_at = datetime.now(timezone.utc)

        # Auto-detect promoted status from Sonarr path.
        # If the series is physically located in the "anime_series" root folder,
        # mark it as promoted=True so it shows correctly in the UI without
        # requiring a manual publish action.
        if not row.promoted and row.path:
            _path_lower = row.path.replace("\\", "/").lower()
            _PROMOTED_MARKERS = ("anime_series", "animeseries", "anime series")
            if any(marker in _path_lower for marker in _PROMOTED_MARKERS):
                row.promoted    = True
                row.promoted_at = datetime.now(timezone.utc)
                log.info(
                    "[sync] Auto-set promoted=True for '%s' (path in anime_series folder)",
                    row.title,
                )

        # Enrich from AniList if not yet done
        if not row.anilist_id:
            media = anilist_svc.search_anime(row.title)
            if media:
                norm = anilist_svc.normalize(media)
                for k, v in norm.items():
                    if v is not None:
                        setattr(row, k, v)
            # AniList enforces a rate limit (degraded to ~30 req/min as of
            # 2025) — pace requests so a full-library sync of many new
            # series doesn't get throttled with 429s.
            time.sleep(0.5)

        # Lookup Emby ID (best-effort, only when missing or new series)
        _title_changed = is_new or (fields.get("title") and fields.get("title") != row.title)
        if not row.emby_id or _title_changed:
            try:
                from ..services.emby import fetch_emby_id
                emby_id = fetch_emby_id(row.title, year=row.year)
                if emby_id:
                    row.emby_id = emby_id
                    log.debug("[sync] Emby ID for '%s': %s", row.title, emby_id)
            except Exception as _emby_exc:
                log.warning("[sync] Emby lookup failed for '%s': %s", row.title, _emby_exc)

        db.flush()

        # ── Auto-translate series description ────────────────────────────────────
        if not row.overview_cs:
            try:
                from ..utils.settings_helper import read_setting as _rs
                if _rs("auto_translate_description", db) == "true":
                    from ..services.ai_description import ensure_czech_description
                    ensure_czech_description(row, db)
            except Exception as _tr_exc:
                log.warning("[sync] Series description translation failed for '%s': %s", row.title, _tr_exc)

        # ── Sync episodes ────────────────────────────────────────────────────────
        try:
            episodes_raw = sonarr_svc.get_episodes(sonarr_id)
        except Exception as e:
            log.warning("[sync] get_episodes(%s) failed: %s", sonarr_id, e)
            episodes_raw = []

        # Check translation setting once for the whole episode batch
        _translate_episodes = False
        try:
            from ..utils.settings_helper import read_setting as _rs2
            _translate_episodes = _rs2("auto_translate_description", db) == "true"
        except Exception:
            pass

        for ep_raw in episodes_raw:
            _sync_episode(db, row.id, ep_raw)

        db.commit()

        # ── Auto-translate episode descriptions (only new/untranslated) ──────────
        if _translate_episodes:
            try:
                from ..services.ai_description import ensure_czech_episode_description
                untranslated = [
                    ep for ep in db.query(Episode)
                    .filter(Episode.series_id == row.id, Episode.overview_cs == None, Episode.overview != None)
                    .all()
                ]
                for ep in untranslated:
                    try:
                        ensure_czech_episode_description(ep, db)
                    except Exception as _ep_tr_exc:
                        log.warning("[sync] Episode translation failed ep %d: %s", ep.id, _ep_tr_exc)
            except Exception as _ep_batch_exc:
                log.warning("[sync] Episode batch translation failed for '%s': %s", row.title, _ep_batch_exc)
        log.info("[sync] OK '%s' \u2014 %d episodes", row.title, len(episodes_raw))

        # Refresh cached episode/subtitle counts (includes disk scan)
        try:
            from .series import refresh_series_counts
            refresh_series_counts(db, row, use_disk=True)
        except Exception as e:
            log.warning("[sync] cached counts update failed for '%s': %s", row.title, e)

        # Auto-generate NFO for newly added series (controlled by setting, default true)
        if is_new and row.path:
            from ..utils.settings_helper import read_setting as _read_setting
            if _read_setting("nfo_auto_generate_on_add", db) != "false":
                try:
                    from ..services import nfo as nfo_svc
                    nfo_svc.refresh_series_nfo(row, db)
                    log.info("[sync] NFO generated for new series '%s'", row.title)
                except Exception as e:
                    log.warning("[sync] NFO generation failed for new series '%s': %s", row.title, e)

    except Exception as e:
        db.rollback()
        log.error("[sync] sonarr_id=%s failed: %s", raw.get("id"), e)
        raise
    finally:
        db.close()


def _sync_episode(db: Session, series_db_id: int, ep_raw: dict):
    """Upsert one episode row, extracting all available Sonarr data."""
    sonarr_ep_id = ep_raw["id"]

    ep = db.query(Episode).filter(Episode.sonarr_ep_id == sonarr_ep_id).first()
    if not ep:
        ep = Episode(series_id=series_db_id, sonarr_ep_id=sonarr_ep_id)
        db.add(ep)

    # Basic fields
    ep.season_number            = ep_raw.get("seasonNumber", 0)
    ep.episode_number           = ep_raw.get("episodeNumber", 0)
    ep.absolute_episode_number  = ep_raw.get("absoluteEpisodeNumber")
    ep.scene_episode_number     = ep_raw.get("sceneEpisodeNumber")
    ep.scene_season_number      = ep_raw.get("sceneSeasonNumber")
    ep.tvdb_ep_id               = ep_raw.get("tvdbEpisodeId")
    ep.title                    = ep_raw.get("title")
    ep.overview                 = ep_raw.get("overview")
    ep.air_date                 = ep_raw.get("airDate")
    ep.air_date_utc             = ep_raw.get("airDateUtc")
    ep.has_file                 = ep_raw.get("hasFile", False)
    ep.monitored                = ep_raw.get("monitored", True)

    # Episode file + media info
    ef = ep_raw.get("episodeFile") or {}
    if ef:
        media = sonarr_svc.extract_media_info(ef)
        for k, v in media.items():
            if v is not None:
                setattr(ep, k, v)
        ep.has_file = True


def _auto_unmonitor_task(series_ids=None) -> None:
    """Background: scan episodes/series and unmonitor completed ones in Sonarr."""
    from ..services import job_log, auto_unmonitor as au
    from ..database import SessionLocal

    label = "Auto-unmonitor" if not series_ids else f"Auto-unmonitor ({len(series_ids)} serii)"
    run = job_log.start_run("auto_unmonitor", label)
    db = SessionLocal()
    try:
        stats = au.run_auto_unmonitor(db, series_ids=series_ids)
        msg = (
            f"{stats['episodes_unmonitored']} epizod, "
            f"{stats['series_unmonitored']} serii odmonitorovano"
        )
        if stats.get("errors"):
            job_log.finish_run(run, "error", msg + f" | chyby: {'; '.join(stats['errors'][:2])}")
        else:
            job_log.finish_run(run, "done", msg)
        log.info("[auto_unmonitor] %s", msg)
    except Exception as e:
        job_log.finish_run(run, "error", str(e)[:300])
        log.error("[auto_unmonitor] task failed: %s", e)
    finally:
        db.close()
