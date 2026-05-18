from __future__ import annotations

import hashlib
import secrets
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user
from ..models.api_key import ApiKey
from ..models.user import User

router = APIRouter(prefix="/api/api-keys", tags=["api-keys"])

PREFIX = "ansk_"


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class CreateKeyRequest(BaseModel):
    name: str


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("")
def list_keys(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Vrátí seznam API klíčů přihlášeného uživatele (bez hashe)."""
    keys = (
        db.query(ApiKey)
        .filter(ApiKey.user_id == current_user.id, ApiKey.is_active == True)  # noqa: E712
        .order_by(ApiKey.created_at.desc())
        .all()
    )
    return [
        {
            "id":         k.id,
            "name":       k.name,
            "key_prefix": k.key_prefix,
            "created_at": k.created_at,
            "last_used":  k.last_used,
            "is_active":  k.is_active,
        }
        for k in keys
    ]


@router.post("", status_code=201)
def create_key(
    req: CreateKeyRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Vygeneruje nový API klíč. Plaintext je vrácen JEDNOU."""
    raw_token = secrets.token_urlsafe(32)
    full_key  = PREFIX + raw_token

    key = ApiKey(
        user_id    = current_user.id,
        name       = req.name,
        key_hash   = _hash(full_key),
        key_prefix = full_key[:8],
    )
    db.add(key)
    db.commit()
    db.refresh(key)

    return {
        "id":          key.id,
        "name":        key.name,
        "key_prefix":  key.key_prefix,
        "created_at":  key.created_at,
        "plaintext":   full_key,   # vrácen JEDNOU, pak ztracen
    }


@router.delete("/{key_id}", status_code=204)
def revoke_key(
    key_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Revokuje (deaktivuje) API klíč."""
    key = db.query(ApiKey).filter(
        ApiKey.id == key_id,
        ApiKey.user_id == current_user.id,
    ).first()
    if not key:
        raise HTTPException(status_code=404, detail="API klíč nenalezen")
    key.is_active = False
    db.commit()
