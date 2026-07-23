from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user
from ..models.episode_markers import EpisodeMarker
from ..models.series import Episode
from ..models.user import User

router = APIRouter(prefix="/api/episodes", tags=["episode-markers"])

VALID_TYPES = {"intro_start", "intro_end", "outro_start", "outro_end"}


class MarkerIn(BaseModel):
    type: str
    time_seconds: float


@router.get("/{episode_id}/markers")
def get_markers(
    episode_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    rows = db.query(EpisodeMarker).filter(EpisodeMarker.episode_id == episode_id).all()
    return [{"id": m.id, "type": m.type, "time_seconds": m.time_seconds} for m in rows]


@router.post("/{episode_id}/markers")
def set_marker(
    episode_id: int,
    body: MarkerIn,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    if body.type not in VALID_TYPES:
        raise HTTPException(400, f"Neplatný typ markeru. Musí být: {sorted(VALID_TYPES)}")

    ep = db.query(Episode).filter(Episode.id == episode_id).first()
    if not ep:
        raise HTTPException(404, "Epizoda nenalezena")

    existing = db.query(EpisodeMarker).filter(
        EpisodeMarker.episode_id == episode_id,
        EpisodeMarker.type == body.type,
    ).first()

    if existing:
        existing.time_seconds = body.time_seconds
        db.commit()
        return {"id": existing.id, "type": existing.type, "time_seconds": existing.time_seconds}

    m = EpisodeMarker(episode_id=episode_id, type=body.type, time_seconds=body.time_seconds)
    db.add(m)
    db.commit()
    db.refresh(m)
    return {"id": m.id, "type": m.type, "time_seconds": m.time_seconds}


@router.delete("/{episode_id}/markers/{marker_type}")
def delete_marker(
    episode_id: int,
    marker_type: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    m = db.query(EpisodeMarker).filter(
        EpisodeMarker.episode_id == episode_id,
        EpisodeMarker.type == marker_type,
    ).first()
    if not m:
        raise HTTPException(404, "Marker nenalezen")
    db.delete(m)
    db.commit()
    return {"ok": True}
