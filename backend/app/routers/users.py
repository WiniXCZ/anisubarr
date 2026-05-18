from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel
from ..database import get_db
from ..models.user import User
from ..services.auth import hash_password
from ..deps import require_admin

router = APIRouter(prefix="/api/users", tags=["users"])


# ── Schemas ───────────────────────────────

class CreateUserRequest(BaseModel):
    username: str
    password: str
    email:    str | None = None
    is_admin: bool = False


class UpdateUserRequest(BaseModel):
    password:  str | None = None
    is_admin:  bool | None = None
    is_active: bool | None = None


# ── Endpoints ─────────────────────────────

@router.get("/")
def list_users(
    db:    Session = Depends(get_db),
    _:     User    = Depends(require_admin),
):
    """Seznam všech uživatelů — pouze pro admina."""
    users = db.query(User).order_by(User.id).all()
    return [
        {
            "id":         u.id,
            "username":   u.username,
            "email":      u.email,
            "is_admin":   u.is_admin,
            "is_active":  u.is_active,
            "created_at": u.created_at,
        }
        for u in users
    ]


@router.post("/", status_code=201)
def create_user(
    req: CreateUserRequest,
    db:  Session = Depends(get_db),
    _:   User    = Depends(require_admin),
):
    """Vytvoření nového uživatele — pouze pro admina."""
    if db.query(User).filter(User.username == req.username).first():
        raise HTTPException(status_code=400, detail="Username already taken")
    if req.email and db.query(User).filter(User.email == req.email).first():
        raise HTTPException(status_code=400, detail="Email already in use")

    user = User(
        username=req.username,
        email=req.email,
        hashed_pw=hash_password(req.password),
        is_admin=req.is_admin,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return {
        "id":         user.id,
        "username":   user.username,
        "email":      user.email,
        "is_admin":   user.is_admin,
        "is_active":  user.is_active,
        "created_at": user.created_at,
    }


@router.patch("/{user_id}")
def update_user(
    user_id: int,
    req:     UpdateUserRequest,
    db:      Session = Depends(get_db),
    _:       User    = Depends(require_admin),
):
    """Změna hesla, is_admin nebo is_active — pouze pro admina."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if req.password is not None:
        user.hashed_pw = hash_password(req.password)
    if req.is_admin is not None:
        user.is_admin = req.is_admin
    if req.is_active is not None:
        user.is_active = req.is_active

    db.commit()
    db.refresh(user)
    return {
        "id":        user.id,
        "username":  user.username,
        "email":     user.email,
        "is_admin":  user.is_admin,
        "is_active": user.is_active,
    }


@router.delete("/{user_id}", status_code=204)
def delete_user(
    user_id:      int,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(require_admin),
):
    """Smazání uživatele — pouze pro admina, nelze smazat sám sebe."""
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    db.delete(user)
    db.commit()
