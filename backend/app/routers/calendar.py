"""calendar.py – Upcoming episode air dates."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session, joinedload
from ..database import get_db
from ..deps import get_current_user
from ..models.series import Episode, Series
from ..models.user import User

router = APIRouter(prefix="/api/calendar", tags=["calendar"])


@router.get("")
def get_calendar(
    start: str = Query(..., description="YYYY-MM-DD"),
    end:   str = Query(..., description="YYYY-MM-DD"),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Return episodes with air_date in [start, end] with series metadata."""
    rows = (
        db.query(Episode)
        .join(Series)
        .options(joinedload(Episode.series))
        .filter(
            Episode.air_date >= start,
            Episode.air_date <= end,
            Episode.season_number > 0,
            Episode.monitored == True,  # noqa: E712
        )
        .order_by(Episode.air_date, Series.title, Episode.episode_number)
        .all()
    )
    return [
        {
            "id":             ep.id,
            "air_date":       ep.air_date,
            "season_number":  ep.season_number,
            "episode_number": ep.episode_number,
            "absolute_number":ep.absolute_episode_number,
            "title":          ep.title,
            "has_file":       ep.has_file,
            "series_id":      ep.series_id,
            "series_title":   ep.series.title_romaji or ep.series.title,
            "series_cover":   ep.series.cover_url or ep.series.poster_url,
            "series_status":  ep.series.status,
        }
        for ep in rows
    ]
