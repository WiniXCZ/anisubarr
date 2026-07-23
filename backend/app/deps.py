from __future__ import annotations

import json
from datetime import datetime, timezone

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from .database import get_db
from .services.auth import decode_token
from .models.user import User
from .utils.auth_utils import API_KEY_PREFIX, hash_api_key

ALL_PERMISSIONS = [
    "can_download_subtitles",
    "can_manage_library",
    "can_edit_subtitles",
    "can_run_sync",
    "can_manage_requests",
    "can_view_files",
    "can_access_settings",
]

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/token", auto_error=False)


def get_current_user(
    request: Request,
    token: str | None = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    # 1) Zkusit X-Api-Key header
    api_key_header = request.headers.get("X-Api-Key", "")
    if api_key_header.startswith(API_KEY_PREFIX):
        from .models.api_key import ApiKey  # lazy import – vyhne se cyklům

        key_hash = hash_api_key(api_key_header)
        api_key_obj = db.query(ApiKey).filter(
            ApiKey.key_hash == key_hash,
            ApiKey.is_active == True,  # noqa: E712
        ).first()

        if api_key_obj is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Neplatný API klíč",
                headers={"WWW-Authenticate": "Bearer"},
            )

        # Aktualizuj last_used
        api_key_obj.last_used = datetime.now(timezone.utc)
        db.commit()

        user = db.query(User).filter(User.id == api_key_obj.user_id).first()
        if user is None or not user.is_active:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Uživatel nenalezen")
        return user

    # 2) JWT Bearer token
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Není přihlášen",
            headers={"WWW-Authenticate": "Bearer"},
        )

    payload = decode_token(token)
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Neplatný nebo expirovaný token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user = db.query(User).filter(User.id == payload.get("sub")).first()
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Uživatel nenalezen")
    return user


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if not current_user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Vyžadována oprávnění administrátora")
    return current_user


def _get_role(user: User) -> str:
    return user.role or ("admin" if user.is_admin else "viewer")


def require_permission(perm: str):
    """Factory returning a FastAPI dependency that checks a named permission."""

    def _check(current_user: User = Depends(get_current_user)) -> User:
        role = _get_role(current_user)
        if role == "admin":
            return current_user
        if role == "viewer":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Nedostatečná oprávnění")
        # custom role — check JSON permissions blob
        try:
            perms: dict = json.loads(current_user.permissions or "{}")
        except Exception:
            perms = {}
        if not perms.get(perm, False):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Nedostatečná oprávnění")
        return current_user

    return _check
