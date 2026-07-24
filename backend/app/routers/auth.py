from __future__ import annotations

import time
from collections import defaultdict
from threading import Lock

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import _get_role, get_current_user, oauth2_scheme
from ..models.user import User
from ..services.auth import create_access_token, decode_token, hash_password, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])

# ── Rate limiting (in-memory) ─────────────────────────────────────────────────
_rate_lock = Lock()
_attempts: dict[str, list[float]] = defaultdict(list)

_RATE_WINDOW = 60   # sekund
_RATE_LIMIT  = 10   # pokusů za okno
_MAX_TRACKED_IPS = 5_000  # ochrana proti neomezenému růstu slovníku


def _check_rate_limit(ip: str) -> None:
    now = time.monotonic()
    with _rate_lock:
        # Čistíme záznamy starší než okno pro aktuální IP
        timestamps = _attempts[ip]
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

        # Odstraní IP adresy, které nemají žádné záznamy v aktuálním okně,
        # pokud slovník přesáhne limit — předchází memory leaku při provozu.
        if len(_attempts) > _MAX_TRACKED_IPS:
            stale = [k for k, v in _attempts.items() if not v]
            for k in stale:
                del _attempts[k]


# ── Schemas ───────────────────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    username: str
    password: str
    email: str | None = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/setup-status")
def setup_status(db: Session = Depends(get_db)) -> dict:
    """
    Public, unauthenticated check the frontend uses to decide whether to show
    the first-run setup wizard (account + core service config) instead of the
    plain login screen. True exactly when /register would let someone in
    without a token — i.e. the users table is empty.
    """
    return {"needs_setup": db.query(User).count() == 0}


@router.post("/register", status_code=201)
def register(
    req: RegisterRequest,
    request: Request,
    db: Session = Depends(get_db),
    token: str | None = Depends(oauth2_scheme),
):
    """
    Create a new user.

    The very first user (empty DB) may always self-register and becomes admin —
    this is how the app is bootstrapped on a fresh install. Every registration
    after that requires an authenticated admin token, otherwise anyone who can
    reach the API could create their own account.
    """
    is_first = db.query(User).count() == 0

    if not is_first:
        if not token:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Přihlaste se jako administrátor pro vytvoření dalšího účtu",
                headers={"WWW-Authenticate": "Bearer"},
            )
        payload = decode_token(token)
        requester = db.query(User).filter(User.id == payload.get("sub")).first() if payload else None
        if not requester or not requester.is_active or not requester.is_admin:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Vyžadována oprávnění administrátora pro vytvoření účtu",
            )

    # Same IP-based rate limiting as login — even an admin session shouldn't be
    # able to mass-create accounts if a token leaks.
    ip = (
        request.headers.get("X-Real-IP")
        or request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
        or (request.client.host if request.client else "unknown")
    )
    _check_rate_limit(ip)

    if db.query(User).filter(User.username == req.username).first():
        raise HTTPException(status_code=400, detail="Uživatelské jméno je již obsazeno")
    user = User(
        username  = req.username,
        email     = req.email,
        hashed_pw = hash_password(req.password),
        is_admin  = is_first,
        role      = "admin" if is_first else "viewer",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return {"id": user.id, "username": user.username, "is_admin": user.is_admin, "role": user.role}


@router.post("/token", response_model=TokenResponse)
def login(
    request: Request,
    form: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    ip = (
        request.headers.get("X-Real-IP")
        or request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
        or (request.client.host if request.client else "unknown")
    )
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
    import json
    role = _get_role(current_user)
    perms: dict = {}
    if role == "custom":
        try:
            perms = json.loads(current_user.permissions or "{}")
        except Exception:
            pass
    return {
        "id":          current_user.id,
        "username":    current_user.username,
        "email":       current_user.email,
        "is_admin":    current_user.is_admin,
        "role":        role,
        "permissions": perms,
    }
