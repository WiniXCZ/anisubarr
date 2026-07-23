from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user
from ..models.series import Series
from ..models.user import User

router = APIRouter(prefix="/api/search", tags=["search"])


@router.get("")
def search_series(
    q: str = Query("", min_length=0),
    limit: int = Query(10, ge=1, le=50),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Full-text search across series titles. Minimum 2 characters."""
    q = q.strip()
    if len(q) < 2:
        return []

    pattern = f"%{q}%"
    rows = (
        db.query(Series)
        .filter(
            or_(
                Series.title.ilike(pattern),
                Series.title_english.ilike(pattern),
                Series.title_romaji.ilike(pattern),
                Series.title_japanese.ilike(pattern),
            )
        )
        .order_by(Series.title)
        .limit(limit)
        .all()
    )

    return [
        {
            "id": s.id,
            "title": s.title,
            "title_english": s.title_english,
            "poster_url": s.cover_url or s.poster_url,
            "is_promoted": bool(s.promoted),
            "episode_count": s.episode_count or 0,
            "cs_subtitle_pct": _cs_pct(s),
        }
        for s in rows
    ]


def _cs_pct(s: Series) -> int:
    """Percentage of monitored episodes with CS subtitles (0–100)."""
    monitored = s.cached_ep_monitored or 0
    cs = s.cached_cs_sub_count or 0
    if monitored == 0:
        return 0
    return round(cs / monitored * 100)
