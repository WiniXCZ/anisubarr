"""
requests.py – Anime request management.

GET    /api/requests           → list requests (filter by status)
POST   /api/requests           → create new request
PATCH  /api/requests/{id}      → approve / reject / update
DELETE /api/requests/{id}      → delete request
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user, require_admin
from ..models.request import AnimeRequest
from ..models.user import User

router = APIRouter(prefix="/api/requests", tags=["requests"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class RequestCreate(BaseModel):
    series_id:    Optional[int]  = None
    custom_title: Optional[str]  = None
    custom_jp:    Optional[str]  = None
    anilist_id:   Optional[int]  = None
    source:       str            = "manual"
    note:         Optional[str]  = None


class RequestUpdate(BaseModel):
    status:  Optional[str]  = None   # pending / approved / rejected
    note:    Optional[str]  = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _out(req: AnimeRequest, db: Session) -> dict:
    series_data = None
    if req.series_id:
        try:
            from ..models.series import Series
            s = db.query(Series).filter(Series.id == req.series_id).first()
            if s:
                series_data = {
                    "id":    s.id,
                    "title": s.title,
                    "jp":    s.title_japanese or s.title_romaji,
                    "cover": s.cover_url or s.poster_url,
                }
        except Exception:
            pass

    return {
        "id":           req.id,
        "series_id":    req.series_id,
        "series":       series_data,
        "custom_title": req.custom_title,
        "custom_jp":    req.custom_jp,
        "anilist_id":   req.anilist_id,
        "username":     req.username,
        "status":       req.status,
        "source":       req.source,
        "note":         req.note,
        "created_at":   req.created_at.isoformat() if req.created_at else None,
        "updated_at":   req.updated_at.isoformat() if req.updated_at else None,
    }


_VALID_STATUSES = {"pending", "approved", "rejected"}


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("")
def list_requests(
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = db.query(AnimeRequest).order_by(AnimeRequest.created_at.desc())
    if status and status in _VALID_STATUSES:
        q = q.filter(AnimeRequest.status == status)
    return [_out(r, db) for r in q.all()]


@router.post("", status_code=201)
def create_request(
    body: RequestCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not body.series_id and not body.custom_title:
        raise HTTPException(400, "Provide either series_id or custom_title")
    req = AnimeRequest(
        series_id    = body.series_id,
        custom_title = body.custom_title,
        custom_jp    = body.custom_jp,
        anilist_id   = body.anilist_id,
        source       = body.source,
        note         = body.note,
        user_id      = current_user.id,
        username     = current_user.username,
        status       = "pending",
    )
    db.add(req)
    db.commit()
    db.refresh(req)
    return _out(req, db)


@router.patch("/{req_id}")
def update_request(
    req_id: int,
    body: RequestUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    req = db.query(AnimeRequest).filter(AnimeRequest.id == req_id).first()
    if not req:
        raise HTTPException(404, "Request not found")

    is_owner = req.user_id == current_user.id
    is_admin = bool(current_user.is_admin) or (current_user.role == "admin")

    if body.status is not None:
        if body.status not in _VALID_STATUSES:
            raise HTTPException(400, f"Invalid status. Use: {_VALID_STATUSES}")
        if body.status in ("approved", "rejected") and not is_admin:
            raise HTTPException(403, "Only admins can approve or reject requests")
        if not is_admin and not is_owner:
            raise HTTPException(403, "Not allowed to modify this request")
        req.status = body.status
    if body.note is not None:
        if not is_admin and not is_owner:
            raise HTTPException(403, "Not allowed to modify this request")
        req.note = body.note
    db.commit()
    db.refresh(req)
    return _out(req, db)


@router.delete("/{req_id}", status_code=204)
def delete_request(
    req_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    req = db.query(AnimeRequest).filter(AnimeRequest.id == req_id).first()
    if not req:
        raise HTTPException(404, "Request not found")
    db.delete(req)
    db.commit()
