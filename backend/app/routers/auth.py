from __future__ import annotations

import time
from collections import defaultdict
from threading import Lock

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user
from ..models.user import User
from ..services.auth import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])

# ── Rate limiting (in-memory) ─────────────────────────────────────────────────
_rate_lock = Lock()
_attempts: dict[str, list[float]] = defaultdict(list)

_RATE_WINDOW = 60   # sekund
_RATE_LIMIT  = 10   # pokusů za okno


def _check_rate_limit(ip: str) -> None:
    now = time.monotonic()
    with _rate_lock:
        timestamps = _attempts[ip]
        # Vyhoď staré záznamy mimo okno
        timestamps = [t for t in timestamps if now - t < _RATE_WINDOW]
        _attempts[ip] = timestamps

        if len(timestamps) >= _RATE_LIMIT:
            oldest = timestamps[0]
            retry_after = int(_RATE_WINDOW - (now - oldest)) + 1
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Příliš mnoho pokusů o přihlášení. Zkuste to znovu za {retry_after} sekund.",
                headers={"Retry-After": str(retry_after)},
            )

        timestamps.append(now)
        _attempts[ip] = timestamps


# ── Schemas ───────────────────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    username: str
    password: str
    email: str | None = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/register", status_code=201)
def register(req: RegisterRequest, db: Session = Depends(get_db)):
    if db.query(User).filter(User.username == req.username).first():
        raise HTTPException(status_code=400, detail="Uživatelské jméno je již obsazeno")
    is_first = db.query(User).count() == 0
    user = User(
        username  = req.username,
        email     = req.email,
        hashed_pw = hash_password(req.password),
        is_admin  = is_first,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return {"id": user.id, "username": user.username, "is_admin": user.is_admin}


@router.post("/token", response_model=TokenResponse)
def login(
    request: Request,
    form: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    ip = request.client.host if request.client else "unknown"
    _check_rate_limit(ip)

    user = db.query(User).filter(User.username == form.username).first()
    if not user or not verify_password(form.password, user.hashed_pw):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Nesprávné uživatelské jméno nebo heslo",
        )
    if not user.is_active:
        raise HTTPException(status_code=400, detail="Účet je deaktivován")
    return TokenResponse(access_token=create_access_token(user.id))


@router.get("/me")
def me(current_user: User = Depends(get_current_user)):
    return {
        "id":       current_user.id,
        "username": current_user.username,
        "email":    current_user.email,
        "is_admin": current_user.is_admin,
    }
