"""
library.py – /api/library aliases matching the new frontend design's API contract.

The design uses /api/library instead of /api/series. These endpoints are thin
wrappers that delegate to the existing series router logic.
"""
from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session, subqueryload

from ..database import get_db
from ..deps import get_current_user
from ..models.series import Series, Episode
from ..models.user import User
from .series import _series_card, _series_detail, _episode_out

router = APIRouter(prefix="/api/library", tags=["library"])


@router.get("")
def list_library(response: Response, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    """Library list — same data as /api/series but under /api/library."""
    response.headers["Cache-Control"] = "no-cache"
    rows = db.query(Series).order_by(Series.title).all()
    return [_series_card(s) for s in rows]


@router.get("/stats")
def library_stats(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    """Aggregate stats for the library stat bar in the UI."""
    rows = db.query(Series).all()
    total = len(rows)
    airing = sum(1 for s in rows if (s.status or "").lower() in ("continuing", "airing"))
    ended  = sum(1 for s in rows if (s.status or "").lower() == "ended")
    watching = sum(1 for s in rows if s.watch_status == "watching")
    plan_to_watch = sum(1 for s in rows if s.watch_status == "plan_to_watch")
    completed_watch = sum(1 for s in rows if s.watch_status == "completed")
    total_eps = sum(s.episode_count or 0 for s in rows)
    watched_eps = sum(
        (s.cached_ep_with_file or 0) for s in rows
    )
    total_size = sum(s.size_on_disk or 0 for s in rows)

    def _human_size(b: int) -> str:
        for unit in ("B", "KB", "MB", "GB", "TB"):
            if b < 1024:
                return f"{b:.1f} {unit}"
            b /= 1024
        return f"{b:.1f} PB"

    return {
        "total_series":      total,
        "airing":            airing,
        "ended":             ended,
        "watching":          watching,
        "plan_to_watch":     plan_to_watch,
        "completed_watch":   completed_watch,
        "total_episodes":    total_eps,
        "watched_episodes":  watched_eps,
        "total_size_bytes":  total_size,
        "total_size_human":  _human_size(total_size),
    }


@router.get("/{series_id}")
def get_library_entry(series_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    s = (
        db.query(Series)
        .options(subqueryload(Series.episodes).subqueryload(Episode.subtitles))
        .filter(Series.id == series_id)
        .first()
    )
    if not s:
        from fastapi import HTTPException
        raise HTTPException(404, "Series not found")
    return _series_detail(s)


@router.get("/{series_id}/episodes")
def get_library_episodes(series_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    s = db.query(Series).filter(Series.id == series_id).first()
    if not s:
        from fastapi import HTTPException
        raise HTTPException(404, "Series not found")
    dir_cache: dict = {}
    return [
        _episode_out(ep, dir_cache)
        for ep in sorted(s.episodes, key=lambda e: (e.season_number, e.episode_number))
        if ep.season_number > 0
    ]
