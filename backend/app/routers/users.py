from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import ALL_PERMISSIONS, _get_role, require_admin
from ..models.user import User
from ..services.auth import hash_password

router = APIRouter(prefix="/api/users", tags=["users"])

VALID_ROLES = {"viewer", "custom", "admin"}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _parse_permissions(raw: str | None) -> dict:
    try:
        return json.loads(raw or "{}")
    except Exception:
        return {}


def _user_dict(u: User) -> dict:
    return {
        "id":          u.id,
        "username":    u.username,
        "email":       u.email,
        "is_admin":    u.is_admin,
        "is_active":   u.is_active,
        "created_at":  u.created_at,
        "role":        _get_role(u),
        "permissions": _parse_permissions(u.permissions),
    }


# ── Schemas ───────────────────────────────────────────────────────────────────

class CreateUserRequest(BaseModel):
    username: str
    password: str
    email:    str | None = None
    role:     str = "viewer"

    @field_validator("role")
    @classmethod
    def validate_role(cls, v: str) -> str:
        if v not in VALID_ROLES:
            raise ValueError(f"role must be one of {VALID_ROLES}")
        return v


class UpdateUserRequest(BaseModel):
    password:  str | None = None
    role:      str | None = None
    is_active: bool | None = None

    @field_validator("role")
    @classmethod
    def validate_role(cls, v: str | None) -> str | None:
        if v is not None and v not in VALID_ROLES:
            raise ValueError(f"role must be one of {VALID_ROLES}")
        return v


class PermissionsRequest(BaseModel):
    can_download_subtitles: bool = False
    can_manage_library:     bool = False
    can_edit_subtitles:     bool = False
    can_run_sync:           bool = False
    can_manage_requests:    bool = False
    can_view_files:         bool = False
    can_access_settings:    bool = False


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/")
def list_users(
    db: Session = Depends(get_db),
    _:  User    = Depends(require_admin),
):
    users = db.query(User).order_by(User.id).all()
    return [_user_dict(u) for u in users]


@router.post("/", status_code=201)
def create_user(
    req: CreateUserRequest,
    db:  Session = Depends(get_db),
    _:   User    = Depends(require_admin),
):
    if db.query(User).filter(User.username == req.username).first():
        raise HTTPException(status_code=400, detail="Username already taken")
    if req.email and db.query(User).filter(User.email == req.email).first():
        raise HTTPException(status_code=400, detail="Email already in use")

    user = User(
        username  = req.username,
        email     = req.email,
        hashed_pw = hash_password(req.password),
        is_admin  = req.role == "admin",
        role      = req.role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return _user_dict(user)


@router.patch("/{user_id}")
def update_user(
    user_id:      int,
    req:          UpdateUserRequest,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(require_admin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if req.password is not None:
        user.hashed_pw = hash_password(req.password)

    if req.role is not None:
        if req.role != "admin" and user.id == current_user.id:
            raise HTTPException(status_code=400, detail="Nemůžeš odebrat sám sobě admin roli")
        user.role     = req.role
        user.is_admin = req.role == "admin"

    if req.is_active is not None:
        if not req.is_active and user.id == current_user.id:
            raise HTTPException(status_code=400, detail="Nemůžeš deaktivovat vlastní účet")
        user.is_active = req.is_active

    db.commit()
    db.refresh(user)
    return _user_dict(user)


@router.delete("/{user_id}", status_code=204)
def delete_user(
    user_id:      int,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(require_admin),
):
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    db.delete(user)
    db.commit()


@router.get("/{user_id}/permissions")
def get_permissions(
    user_id: int,
    db:      Session = Depends(get_db),
    _:       User    = Depends(require_admin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return _parse_permissions(user.permissions)


@router.put("/{user_id}/permissions")
def set_permissions(
    user_id: int,
    req:     PermissionsRequest,
    db:      Session = Depends(get_db),
    _:       User    = Depends(require_admin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if _get_role(user) != "custom":
        raise HTTPException(status_code=400, detail="Oprávnění lze nastavit pouze pro roli 'custom'")

    user.permissions = json.dumps(req.model_dump())
    db.commit()
    db.refresh(user)
    return _parse_permissions(user.permissions)
