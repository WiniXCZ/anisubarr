"""
nfo.py – Endpoints for generating and writing NFO metadata files.

Emby/Jellyfin/Kodi read these to get rich metadata without needing
internet scraping (useful for anime where online databases are patchy).
"""
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
from ..database import get_db
from ..deps import get_current_user, require_admin
from ..models.series import Series, Episode
from ..models.user import User
from ..services import nfo as nfo_svc

router = APIRouter(prefix="/api/nfo", tags=["nfo"])


# ──────────────────────────────────────────
# Preview (no file write — just returns the XML)
# ──────────────────────────────────────────

@router.get("/preview/series/{series_id}")
def preview_series_nfo(
    series_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Return the tvshow.nfo XML that would be written, without touching disk."""
    s = _get_series(db, series_id)
    return {
        "path":    nfo_svc.tvshow_nfo_path(s),
        "content": nfo_svc.build_tvshow_nfo(s),
    }


@router.get("/preview/episode/{episode_id}")
def preview_episode_nfo(
    episode_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Return the episode NFO XML without touching disk."""
    ep = _get_episode(db, episode_id)
    return {
        "path":    nfo_svc.episode_nfo_path(ep),
        "content": nfo_svc.build_episode_nfo(ep, series=ep.series),
    }


# ──────────────────────────────────────────
# Write — single series
# ──────────────────────────────────────────

@router.post("/write/series/{series_id}")
def write_series_nfo(
    series_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Write tvshow.nfo for one series."""
    s = _get_series(db, series_id)
    result = nfo_svc.write_series_nfo(s)
    if not result["ok"]:
        raise HTTPException(500, result["error"])
    return result


@router.post("/write/series/{series_id}/all")
def write_all_nfo_for_series(
    series_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Write tvshow.nfo + all episode NFOs for one series (runs in background)."""
    s = _get_series(db, series_id)
    background_tasks.add_task(_bg_write_all, series_id)
    return {"status": "queued", "series": s.title}


@router.post("/write/episode/{episode_id}")
def write_episode_nfo(
    episode_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Write NFO for a single episode."""
    ep = _get_episode(db, episode_id)
    result = nfo_svc.write_episode_nfo(ep)
    if not result["ok"]:
        raise HTTPException(500, result["error"])
    return result


# ──────────────────────────────────────────
# Write — all series (admin only, background)
# ──────────────────────────────────────────

@router.post("/write/episodes", status_code=202)
def write_episodes_bulk_nfo(
    body: dict,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Write NFO for a specific list of episode IDs. Runs in background."""
    episode_ids = body.get("episode_ids", [])
    if not episode_ids:
        raise HTTPException(400, "episode_ids is empty")
    background_tasks.add_task(_bg_write_episodes, list(episode_ids))
    return {"status": "queued", "count": len(episode_ids)}


@router.post("/write/all", status_code=202)
def write_all_nfo(
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Write NFO files for every series and their episodes. Runs in background."""
    series_ids = [s.id for s in db.query(Series).all()]
    background_tasks.add_task(_bg_write_batch, series_ids)
    return {"status": "queued", "series_count": len(series_ids)}


# ──────────────────────────────────────────
# Background tasks
# ──────────────────────────────────────────

def _bg_write_all(series_id: int):
    from ..database import SessionLocal
    from ..services import job_log
    db = SessionLocal()
    try:
        s = db.query(Series).filter(Series.id == series_id).first()
        if not s:
            return
        run = job_log.start_run("nfo_write", f"NFO: {s.title}")
        try:
            result = nfo_svc.write_all_nfo(s)
            msg = f"{result['ok_count']} OK, {result['fail_count']} selhalo"
            job_log.finish_run(run, "done", msg)
            print(f"[nfo] '{s.title}': {msg}")
        except Exception as e:
            job_log.finish_run(run, "error", str(e)[:300])
            raise
    finally:
        db.close()


def _bg_write_episodes(episode_ids: list[int]):
    from ..database import SessionLocal
    from ..services import job_log
    db = SessionLocal()
    try:
        run = job_log.start_run("nfo_write_bulk", f"NFO: {len(episode_ids)} epizod")
        ok = fail = 0
        for ep_id in episode_ids:
            ep = db.query(Episode).filter(Episode.id == ep_id).first()
            if not ep:
                continue
            try:
                result = nfo_svc.write_episode_nfo(ep)
                if result["ok"]:
                    ok += 1
                else:
                    fail += 1
            except Exception:
                fail += 1
        job_log.finish_run(run, "done", f"{ok} OK, {fail} selhalo")
    except Exception as e:
        print(f"[nfo] _bg_write_episodes error: {e}")
    finally:
        db.close()


def _bg_write_batch(series_ids: list[int]):
    from ..database import SessionLocal
    from ..services import job_log
    run = job_log.start_run("nfo_write_all", f"NFO vše ({len(series_ids)} seriálů)")
    ok_total = fail_total = 0
    for sid in series_ids:
        db = SessionLocal()
        try:
            s = db.query(Series).filter(Series.id == sid).first()
            if s:
                result = nfo_svc.write_all_nfo(s)
                ok_total   += result["ok_count"]
                fail_total += result["fail_count"]
                print(f"[nfo] '{s.title}': {result['ok_count']} OK / {result['fail_count']} fail")
        except Exception as e:
            print(f"[nfo] series {sid} error: {e}")
        finally:
            db.close()
    job_log.finish_run(run, "done", f"{ok_total} OK, {fail_total} selhalo")


# ──────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────

def _get_series(db: Session, series_id: int) -> Series:
    s = db.query(Series).filter(Series.id == series_id).first()
    if not s:
        raise HTTPException(404, "Series not found")
    return s

def _get_episode(db: Session, episode_id: int) -> Episode:
    ep = db.query(Episode).filter(Episode.id == episode_id).first()
    if not ep:
        raise HTTPException(404, "Episode not found")
    return ep
