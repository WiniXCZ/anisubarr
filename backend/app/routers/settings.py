from __future__ import annotations

"""
settings.py – Runtime-editable application settings.

Endpoints:
  GET  /api/settings              → vrátí nastavitelná pole (DB override .env, hesla maskovaná)
  PUT  /api/settings              → uloží změny do DB (vyžaduje admin)
  POST /api/settings/test/{svc}  → otestuje připojení ke službě
"""

import os

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import get_db
from ..deps import get_current_user, require_admin
from ..models.app_settings import AppSetting
from ..models.user import User

router = APIRouter(prefix="/api/settings", tags=["settings"])

# ── Whitelist editovatelných klíčů ────────────────────────────────────────────

EDITABLE_KEYS: set[str] = {
    "sonarr_host", "sonarr_api_key",
    "overseerr_host", "overseerr_api_key",
    "emby_host", "emby_api_key", "emby_external_url",
    "smb_host", "smb_username", "smb_password",
    "ollama_host",
    "anthropic_api_key",        # Claude API key for AI subtitle translation
    "qbittorrent_host", "qbittorrent_username", "qbittorrent_password",
    "hiyori_username", "hiyori_password",
    "hns_username", "hns_password",
    "kamui_username", "kamui_password", "kamui_rar_password",
    "webhook_secret",
    "discord_webhook_url",   # Discord Webhook URL for promotion/demotion notifications
    "media_root",
    # Rate limits (seconds between subtitle download requests)
    "subtitle_download_delay",
    # ── Subtitle processing (Sub-Zero style) ──────────────────────────
    "subtitle_encode_utf8",            # bool — re-encode to UTF-8 after download
    "subtitle_treat_embedded_as_dl",   # bool — skip download if embedded CS track exists
    "subtitle_ignore_embedded_pgs",    # bool — ignore PGS (image) embedded tracks
    "subtitle_ignore_embedded_vobsub", # bool — ignore VobSub (image) embedded tracks
    "subtitle_ignore_embedded_ass",    # bool — ignore ASS embedded tracks
    "subtitle_remove_tags",            # bool — strip HTML/ASS style tags
    "subtitle_remove_emoji",           # bool — remove emoji & music symbols
    "subtitle_ocr_fixes",              # bool — fix OCR artefacts (smart quotes, dashes…)
    "subtitle_common_fixes",           # bool — collapse whitespace, trailing spaces
    # ── alass sync settings ───────────────────────────────────────────
    "subtitle_auto_sync",              # bool — run alass automatically after every download
    "alass_use_audio_reference",       # bool — use audio track as sync reference
    "alass_no_fix_framerate",          # bool — skip framerate mismatch correction
    "alass_golden_section_search",     # bool — use golden-section search
    "alass_max_offset_seconds",        # int  — max allowed timing offset (default 60)
    # ── Provider priority & behaviour ────────────────────────────────────
    "subtitle_provider_priority",      # str  — comma-separated provider order, e.g. "hiyori,hns,kamui,gensubs"
    "subtitle_skip_external_links",    # bool — skip "direct" source results in bulk download
}

# Klíče jejichž hodnoty se maskují (zobrazí jen posledních 4 znaků)
_SECRET_KEYS: set[str] = {
    "sonarr_api_key", "overseerr_api_key", "emby_api_key",
    "smb_password", "hiyori_password", "hns_password", "webhook_secret",
    "discord_webhook_url",
    "kamui_password", "kamui_rar_password",
}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_setting(db: Session, key: str) -> str | None:
    """Vrátí hodnotu z DB, nebo fallback z config/.env."""
    row = db.query(AppSetting).filter(AppSetting.key == key).first()
    if row is not None and row.value is not None:
        return row.value
    return getattr(get_settings(), key, None)


def _mask(value: str | None) -> str:
    """Maskuje citlivou hodnotu — vrátí jen poslední 4 znaky."""
    if not value:
        return ""
    if len(value) <= 4:
        return "••••"
    return "••••••••" + value[-4:]


# ── Subtitle post-processing config helper ────────────────────────────────────

def get_subtitle_postprocess_cfg(db: Session) -> dict:
    """Return dict of subtitle post-processing flags, read from DB settings."""
    bool_keys = [
        "subtitle_encode_utf8",
        "subtitle_remove_tags",
        "subtitle_remove_emoji",
        "subtitle_ocr_fixes",
        "subtitle_common_fixes",
    ]
    cfg = {}
    for key in bool_keys:
        raw = _get_setting(db, key)
        cfg[key.replace("subtitle_", "")] = raw == "true"
    return cfg


def get_subtitle_behavior_cfg(db: Session) -> dict:
    """Return dict controlling subtitle detection/download behaviour."""
    return {
        "treat_embedded_as_dl":   _get_setting(db, "subtitle_treat_embedded_as_dl")   == "true",
        "ignore_embedded_pgs":    _get_setting(db, "subtitle_ignore_embedded_pgs")    == "true",
        "ignore_embedded_vobsub": _get_setting(db, "subtitle_ignore_embedded_vobsub") == "true",
        "ignore_embedded_ass":    _get_setting(db, "subtitle_ignore_embedded_ass")    == "true",
    }


# ── GET /api/settings ─────────────────────────────────────────────────────────

@router.get("")
def get_all_settings(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> dict:
    """Vrátí všechna editovatelná nastavení. Tajné hodnoty jsou maskovány."""
    result: dict[str, str] = {}
    for key in sorted(EDITABLE_KEYS):
        raw = _get_setting(db, key)
        if key in _SECRET_KEYS:
            result[key] = _mask(raw)
        else:
            result[key] = raw or ""
    return result


# ── PUT /api/settings ─────────────────────────────────────────────────────────

@router.put("")
def save_settings(
    body: dict,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> dict:
    """Uloží zadané klíče do DB. Pouze whitelisted klíče jsou přijaty."""
    unknown = set(body.keys()) - EDITABLE_KEYS
    if unknown:
        raise HTTPException(400, f"Nepovolené klíče: {sorted(unknown)}")

    saved: list[str] = []
    for key, value in body.items():
        # Prázdný string = smazat DB override (fallback na .env)
        if value == "" or value is None:
            db.query(AppSetting).filter(AppSetting.key == key).delete()
        else:
            row = db.query(AppSetting).filter(AppSetting.key == key).first()
            if row:
                row.value = str(value)
            else:
                db.add(AppSetting(key=key, value=str(value)))
        saved.append(key)

    db.commit()
    return {
        "saved": saved,
        "message": "Nastavení uloženo. Změny klíčů/hostů se projeví po restartu serveru.",
    }


# ── POST /api/settings/test/{service} ─────────────────────────────────────────

@router.post("/test/{service}")
async def test_connection(
    service: str,
    body: dict | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> dict:
    """Otestuje připojení ke službě.

    Body (volitelné) — umožňuje testovat neuložené hodnoty:
      { "host": "http://...", "api_key": "..." }
    Pokud body není poskytnuto, použijí se hodnoty z DB / .env.
    """
    body = body or {}

    if service == "sonarr":
        return await _test_sonarr(body, db)
    elif service == "overseerr":
        return await _test_overseerr(body, db)
    elif service == "emby":
        return await _test_emby(body, db)
    elif service == "smb":
        return _test_smb(body, db)
    else:
        raise HTTPException(400, f"Neznámá služba: {service}. Povolené: sonarr, overseerr, emby, smb")


# ── Test helpers ──────────────────────────────────────────────────────────────

async def _test_sonarr(body: dict, db: Session) -> dict:
    host    = body.get("host") or _get_setting(db, "sonarr_host") or ""
    api_key = body.get("api_key") or _get_setting(db, "sonarr_api_key") or ""

    if not host or not api_key:
        return {"connected": False, "reason": "not_configured"}

    # Normalize host — přidej http:// pokud chybí
    if not host.startswith("http"):
        host = "http://" + host

    url = host.rstrip("/") + "/api/v3/health"
    try:
        async with httpx.AsyncClient(timeout=6.0) as client:
            resp = await client.get(url, headers={"X-Api-Key": api_key})
        if resp.status_code == 401:
            return {"connected": False, "reason": "Neplatný API klíč"}
        resp.raise_for_status()
        data = resp.json()
        issues = [i for i in (data if isinstance(data, list) else []) if i.get("type") == "error"]
        return {
            "connected": True,
            "version": resp.headers.get("X-Sonarr-Version") or "?",
            "issues": len(issues),
        }
    except httpx.ConnectError:
        return {"connected": False, "reason": "Nelze se připojit k hostu"}
    except httpx.TimeoutException:
        return {"connected": False, "reason": "Timeout"}
    except Exception as exc:
        return {"connected": False, "reason": str(exc)}


async def _test_overseerr(body: dict, db: Session) -> dict:
    host    = body.get("host") or _get_setting(db, "overseerr_host") or ""
    api_key = body.get("api_key") or _get_setting(db, "overseerr_api_key") or ""

    if not host or not api_key:
        return {"connected": False, "reason": "not_configured"}

    url = host.rstrip("/") + "/api/v1/status"
    try:
        async with httpx.AsyncClient(timeout=6.0) as client:
            resp = await client.get(url, headers={"X-Api-Key": api_key})
        if resp.status_code == 401:
            return {"connected": False, "reason": "Neplatný API klíč"}
        resp.raise_for_status()
        data = resp.json()
        return {"connected": True, "version": data.get("version", "?")}
    except httpx.ConnectError:
        return {"connected": False, "reason": "Nelze se připojit k hostu"}
    except httpx.TimeoutException:
        return {"connected": False, "reason": "Timeout"}
    except Exception as exc:
        return {"connected": False, "reason": str(exc)}


async def _test_emby(body: dict, db: Session) -> dict:
    host    = body.get("host") or _get_setting(db, "emby_host") or ""
    api_key = body.get("api_key") or _get_setting(db, "emby_api_key") or ""

    if not host:
        return {"connected": False, "reason": "not_configured"}

    url = host.rstrip("/") + "/System/Info/Public"
    try:
        async with httpx.AsyncClient(timeout=6.0) as client:
            resp = await client.get(url)
        resp.raise_for_status()
        data = resp.json()
        return {
            "connected": True,
            "version": data.get("Version"),
            "server_name": data.get("ServerName"),
        }
    except httpx.ConnectError:
        return {"connected": False, "reason": "Nelze se připojit k hostu"}
    except httpx.TimeoutException:
        return {"connected": False, "reason": "Timeout"}
    except Exception as exc:
        return {"connected": False, "reason": str(exc)}


def _test_smb(body: dict, db: Session) -> dict:
    path = body.get("host") or _get_setting(db, "media_root") or _get_setting(db, "smb_host") or ""

    if not path:
        return {"accessible": False, "error": "Není nastaven media_root ani smb_host"}

    try:
        accessible = os.path.isdir(path)
        return {
            "accessible": accessible,
            "path": path,
            "error": None if accessible else "Adresář není dostupný nebo neexistuje",
        }
    except Exception as exc:
        return {"accessible": False, "path": path, "error": str(exc)}
