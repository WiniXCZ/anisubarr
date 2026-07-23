from __future__ import annotations

"""
qbittorrent.py – qBittorrent WebUI API integration.

Endpoints:
  GET /api/qbittorrent/status   → přihlásí se a vrátí { connected, version }
  GET /api/qbittorrent/torrents → vrátí seznam torrentů
"""

import logging

import httpx
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

log = logging.getLogger("anisubarr.qbittorrent")

from ..database import get_db
from ..deps import get_current_user
from ..models.user import User
from .settings import _get_setting

router = APIRouter(prefix="/api/qbittorrent", tags=["qbittorrent"])

COMPLETED_STATES = {"seeding", "stalledUP", "uploading", "complete", "forcedUP", "checkingUP"}


async def _qbt_login(url: str, username: str, password: str) -> tuple[str | None, str | None]:
    """Přihlásí se do qBittorrent WebUI.

    Returns (sid, None) on success — sid is "" in bypass-auth mode.
    Returns (None, reason_string) on failure.
    """
    base = url.rstrip("/")
    login_url = base + "/api/v2/auth/login"
    # qBittorrent 4.1+ validates Origin/Referer (CSRF), 5.x also checks Sec-Fetch-Site.
    headers = {
        "Origin": base,
        "Referer": base + "/",
        "Content-Type": "application/x-www-form-urlencoded",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-Mode": "cors",
        "User-Agent": "Mozilla/5.0",
    }
    try:
        async with httpx.AsyncClient(timeout=6.0, follow_redirects=True) as client:
            resp = await client.post(login_url, data={"username": username, "password": password},
                                     headers=headers)
        login_text = resp.text.strip()
        log.debug("qbt login HTTP %d body=%r cookies=%s", resp.status_code, login_text[:80], dict(resp.cookies))
        if resp.status_code == 403:
            return None, f"HTTP 403 – CSRF ochrana blokuje požadavek. Přidej IP serveru do povolených hostů v qBittorrent WebUI → Bezpečnost."
        if resp.status_code == 200 and login_text in ("Ok.", ""):
            return resp.cookies.get("SID") or "", None
        if resp.status_code == 200 and login_text == "Fails.":
            return None, "Nesprávné přihlašovací údaje"
        log.warning("qbt login failed: HTTP %d body=%r url=%s", resp.status_code, login_text[:200], login_url)
        return None, f"HTTP {resp.status_code}: {login_text[:120]}"
    except Exception as exc:
        log.warning("qbt login exception: %s", exc)
        return None, str(exc)


def _get_qbt_config(db: Session) -> tuple[str, str, str]:
    """Vrátí (url, username, password) z DB nastavení."""
    url = _get_setting(db, "qbittorrent_url") or _get_setting(db, "qbittorrent_host") or ""
    username = _get_setting(db, "qbittorrent_username") or ""
    password = _get_setting(db, "qbittorrent_password") or ""
    if url and not url.startswith("http"):
        url = "http://" + url
    return url, username, password


@router.get("/status")
async def get_status(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> dict:
    """Otestuje připojení k qBittorrent WebUI."""
    url, username, password = _get_qbt_config(db)

    if not url:
        return {"connected": False, "reason": "not_configured"}

    try:
        sid, err = await _qbt_login(url, username, password)
        if sid is None:
            return {"connected": False, "reason": err or "Přihlášení selhalo"}

        cookies = {"SID": sid} if sid else {}
        async with httpx.AsyncClient(timeout=6.0, cookies=cookies) as client:
            resp = await client.get(url.rstrip("/") + "/api/v2/app/version")

        version = resp.text.strip() if resp.status_code == 200 else "?"
        return {"connected": True, "version": version}

    except httpx.ConnectError:
        return {"connected": False, "reason": "Nelze se připojit k hostu"}
    except httpx.TimeoutException:
        return {"connected": False, "reason": "Timeout"}
    except Exception as exc:
        return {"connected": False, "reason": str(exc)}


@router.get("/torrents")
async def get_torrents(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> list:
    """Vrátí seznam torrentů z qBittorrent."""
    url, username, password = _get_qbt_config(db)

    if not url:
        return []

    try:
        sid, _ = await _qbt_login(url, username, password)
        if sid is None:
            return []

        cookies = {"SID": sid} if sid else {}
        async with httpx.AsyncClient(timeout=10.0, cookies=cookies) as client:
            resp = await client.get(url.rstrip("/") + "/api/v2/torrents/info")

        if resp.status_code != 200:
            return []

        result = []
        for t in resp.json():
            dlspeed = t.get("dlspeed", 0)
            eta = t.get("eta")
            result.append({
                "name": t.get("name", ""),
                "state": t.get("state", ""),
                "progress": round(t.get("progress", 0) * 100, 1),
                "size": t.get("size", 0),
                "save_path": t.get("save_path", ""),
                "added_on": t.get("added_on"),
                "completed_on": t.get("completion_on"),
                "dlspeed": dlspeed,
                "dlspeed_h": f"{dlspeed / 1024 / 1024:.1f} MB/s" if dlspeed > 0 else None,
                "eta": eta if eta and eta < 8640000 else None,
            })
        return result

    except Exception:
        return []
