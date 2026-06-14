"""
watchlist.py – Per-user anime watchlist (from AniList Discovery).

Endpoints:
  GET    /api/watchlist               – list user's watchlist
  POST   /api/watchlist               – add anime to watchlist
  DELETE /api/watchlist/{anilist_id}  – remove from watchlist
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user
from ..models.user import User
from ..models.watchlist import WatchlistItem

router = APIRouter(prefix="/api/watchlist", tags=["watchlist"])


class WatchlistAddRequest(BaseModel):
    anilist_id: int
    title: str | None = None
    poster_url: str | None = None


@router.get("")
def get_watchlist(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rows = (
        db.query(WatchlistItem)
        .filter(WatchlistItem.user_id == current_user.id)
        .order_by(WatchlistItem.added_at.desc())
        .all()
    )
    return [
        {
            "anilist_id": r.anilist_id,
            "title": r.title,
            "poster_url": r.poster_url,
            "added_at": r.added_at.isoformat() if r.added_at else None,
        }
        for r in rows
    ]


@router.post("", status_code=201)
def add_to_watchlist(
    body: WatchlistAddRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    item = WatchlistItem(
        user_id=current_user.id,
        anilist_id=body.anilist_id,
        title=body.title,
        poster_url=body.poster_url,
    )
    db.add(item)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Anime je již ve watchlistu")
    return {"ok": True}


@router.delete("/{anilist_id}")
def remove_from_watchlist(
    anilist_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    row = (
        db.query(WatchlistItem)
        .filter(
            WatchlistItem.user_id == current_user.id,
            WatchlistItem.anilist_id == anilist_id,
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Nenalezeno ve watchlistu")
    db.delete(row)
    db.commit()
    return {"ok": True}
