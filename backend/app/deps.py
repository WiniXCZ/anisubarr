from __future__ import annotations

import hashlib
from datetime import datetime, timezone

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from .database import get_db
from .services.auth import decode_token
from .models.user import User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/token", auto_error=False)

_API_KEY_PREFIX = "ansk_"


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def get_current_user(
    request: Request,
    token: str | None = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    # 1) Zkusit X-Api-Key header
    api_key_header = request.headers.get("X-Api-Key", "")
    if api_key_header.startswith(_API_KEY_PREFIX):
        from .models.api_key import ApiKey  # lazy import – vyhne se cyklům

        key_hash = _hash(api_key_header)
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
