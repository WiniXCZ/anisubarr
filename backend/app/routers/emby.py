from __future__ import annotations

"""
emby.py – Emby / Jellyfin status endpoint.
"""

import httpx
from fastapi import APIRouter, Depends

from ..config import get_settings
from ..deps import get_current_user
from ..models.user import User

router = APIRouter(prefix="/api/emby", tags=["emby"])


@router.get("/status")
async def emby_status(_: User = Depends(get_current_user)):
    """
    Otestuje připojení k Emby / Jellyfin.
    Volá GET {emby_host}/System/Info/Public a vrátí základní info.
    """
    cfg = get_settings()

    if not cfg.emby_host:
        return {"connected": False, "reason": "not_configured"}

    url = cfg.emby_host.rstrip("/") + "/System/Info/Public"

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(url)
        resp.raise_for_status()
        data = resp.json()
        return {
            "connected":   True,
            "version":     data.get("Version"),
            "server_name": data.get("ServerName"),
        }
    except httpx.HTTPStatusError as exc:
        return {"connected": False, "reason": f"HTTP {exc.response.status_code}"}
    except Exception as exc:
        return {"connected": False, "reason": str(exc)}
