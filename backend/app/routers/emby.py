from __future__ import annotations

"""
emby.py – Emby / Jellyfin status endpoint.
"""

import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..config import get_settings
from ..deps import get_current_user, get_db
from ..models.series import Series as SeriesModel
from ..models.user import User
from ..services.emby import _get_config

log = logging.getLogger("anisubarr.emby")

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


@router.get("/series/{series_id}/item")
async def emby_series_item(
    series_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """
    Vrátí Emby URL pro danou sérii (hledá podle názvu v Emby API).
    Pokud série v Emby není nebo Emby není nakonfigurováno, vrátí url: null.
    """
    series = db.query(SeriesModel).filter(SeriesModel.id == series_id).first()
    if not series:
        raise HTTPException(404, "Series not found")

    host, api_key = _get_config()
    if not host:
        return {"url": None, "reason": "not_configured"}

    search_title = series.title_romaji or series.title

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            info_resp = await client.get(f"{host}/System/Info/Public")
            server_id = info_resp.json().get("Id", "")

            search_resp = await client.get(
                f"{host}/Items",
                params={
                    "SearchTerm": search_title,
                    "IncludeItemTypes": "Series",
                    "Recursive": "true",
                    "Limit": 5,
                },
                headers={"X-Emby-Token": api_key},
            )
            items = search_resp.json().get("Items", [])

        if not items:
            return {"url": None, "reason": "not_found"}

        item_id = items[0]["Id"]
        url = f"{host}/web/index.html#!/item?id={item_id}&serverId={server_id}"
        return {"url": url}

    except Exception as exc:
        log.warning("Emby series item lookup failed: %s", exc)
        return {"url": None, "reason": str(exc)}
