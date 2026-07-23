"""
glossary.py – Translation glossary CRUD.

GET    /api/glossary              → list entries (filter by lang, series_id)
POST   /api/glossary              → create entry
PATCH  /api/glossary/{id}         → update entry
DELETE /api/glossary/{id}         → delete entry
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user
from ..models.glossary import GlossaryEntry
from ..models.user import User

router = APIRouter(prefix="/api/glossary", tags=["glossary"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class GlossaryCreate(BaseModel):
    src_lang:  str           = "ja"
    tgt_lang:  str           = "cs"
    src_text:  str
    tgt_text:  str
    notes:     Optional[str] = None
    series_id: Optional[int] = None


class GlossaryUpdate(BaseModel):
    src_text:  Optional[str] = None
    tgt_text:  Optional[str] = None
    notes:     Optional[str] = None
    series_id: Optional[int] = None


def _out(e: GlossaryEntry) -> dict:
    return {
        "id":        e.id,
        "src_lang":  e.src_lang,
        "tgt_lang":  e.tgt_lang,
        "src_text":  e.src_text,
        "tgt_text":  e.tgt_text,
        "notes":     e.notes,
        "series_id": e.series_id,
        "created_at":e.created_at.isoformat() if e.created_at else None,
    }


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("")
def list_glossary(
    src_lang:  str           = "ja",
    tgt_lang:  str           = "cs",
    series_id: Optional[int] = None,
    db: Session = Depends(get_db),
    _: User     = Depends(get_current_user),
):
    q = (
        db.query(GlossaryEntry)
        .filter(GlossaryEntry.src_lang == src_lang, GlossaryEntry.tgt_lang == tgt_lang)
    )
    if series_id is not None:
        # Global entries + series-specific entries
        q = q.filter(
            (GlossaryEntry.series_id == series_id) | (GlossaryEntry.series_id == None)  # noqa: E711
        )
    return [_out(e) for e in q.order_by(GlossaryEntry.src_text).all()]


@router.post("", status_code=201)
def create_glossary_entry(
    body: GlossaryCreate,
    db: Session = Depends(get_db),
    _: User     = Depends(get_current_user),
):
    if not body.src_text.strip() or not body.tgt_text.strip():
        raise HTTPException(400, "src_text and tgt_text are required")
    entry = GlossaryEntry(**body.model_dump())
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return _out(entry)


@router.patch("/{entry_id}")
def update_glossary_entry(
    entry_id: int,
    body: GlossaryUpdate,
    db: Session = Depends(get_db),
    _: User     = Depends(get_current_user),
):
    entry = db.query(GlossaryEntry).filter(GlossaryEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(404, "Entry not found")
    for field, val in body.model_dump(exclude_unset=True).items():
        setattr(entry, field, val)
    db.commit()
    db.refresh(entry)
    return _out(entry)


@router.delete("/{entry_id}", status_code=204)
def delete_glossary_entry(
    entry_id: int,
    db: Session = Depends(get_db),
    _: User     = Depends(get_current_user),
):
    entry = db.query(GlossaryEntry).filter(GlossaryEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(404, "Entry not found")
    db.delete(entry)
    db.commit()
