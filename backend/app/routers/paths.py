from __future__ import annotations

"""
paths.py – Path mapping diagnostics and configuration endpoint.
"""
import os
import sys

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..config import get_settings
from ..deps import get_current_user, require_admin
from ..models.user import User
from ..services import path_resolver

router = APIRouter(prefix="/api/paths", tags=["paths"])


@router.get("/config")
def get_path_config(_: User = Depends(get_current_user)):
    """Vrátí aktuální konfiguraci path mappingu včetně stavu Sonarr, Overseerr a Emby."""
    cfg = get_settings()
    return {
        # Základní path info
        "platform":           sys.platform,
        "path_sonarr_prefix": cfg.path_sonarr_prefix,
        "path_local_prefix":  cfg.path_local_prefix,
        "mode":               "smb" if sys.platform == "win32" else "docker/local",

        # SMB
        "smb_host":           cfg.smb_host,
        "smb_username":       cfg.smb_username,
        "smb_configured":     bool(cfg.smb_username and cfg.smb_password),

        # Sonarr
        "sonarr_host":        cfg.sonarr_host,
        "sonarr_configured":  bool(cfg.sonarr_host and cfg.sonarr_api_key),

        # Overseerr / Jellyseerr
        "overseerr_host":        cfg.overseerr_host,
        "overseerr_configured":  bool(cfg.overseerr_host and cfg.overseerr_api_key),

        # Emby / Jellyfin
        "emby_host":         cfg.emby_host,
        "emby_external_url": cfg.emby_external_url,
        "emby_configured":   bool(cfg.emby_host and cfg.emby_api_key),
    }


@router.post("/test")
def test_path(body: dict, _: User = Depends(get_current_user)):
    """
    Test path resolution.
    Body: {"sonarr_path": "/data/media/anime/Show/Season 01/ep.mkv"}
    Vrátí resolved local path a zda je soubor dostupný.
    """
    sonarr_path = body.get("sonarr_path", "")
    if not sonarr_path:
        raise HTTPException(400, "sonarr_path required")

    try:
        local_path = path_resolver.resolve(sonarr_path)
    except Exception as e:
        return {"sonarr_path": sonarr_path, "local_path": None, "error": str(e)}

    accessible = os.path.exists(local_path)
    return {
        "sonarr_path": sonarr_path,
        "local_path":  local_path,
        "accessible":  accessible,
        "error":       None if accessible else "Soubor nenalezen na resolved path — ověř PREFIX config nebo SMB auth",
    }


@router.get("/smb-test")
def smb_test(_: User = Depends(get_current_user)):
    """
    Ověří přístupnost SMB / lokálního adresáře z PATH_LOCAL_PREFIX.
    """
    cfg = get_settings()
    path = cfg.path_local_prefix

    if not path:
        return {"accessible": False, "path": path, "error": "PATH_LOCAL_PREFIX není nastaven"}

    try:
        accessible = os.path.isdir(path)
        return {
            "accessible": accessible,
            "path":       path,
            "error":      None if accessible else "Adresář není dostupný nebo neexistuje",
        }
    except Exception as exc:
        return {"accessible": False, "path": path, "error": str(exc)}


@router.post("/smb-auth")
def smb_auth_now(_: User = Depends(require_admin)):
    """Force SMB re-autentizace (pouze Windows)."""
    if sys.platform != "win32":
        return {"status": "skipped", "reason": "Není Windows"}
    path_resolver.reset_smb_cache()
    cfg = get_settings()
    if not cfg.smb_username:
        raise HTTPException(400, "SMB_USERNAME není nakonfigurován")
    from ..services.subtitle_utils import smb_authenticate
    ok, msg = smb_authenticate(cfg.smb_host, cfg.smb_username, cfg.smb_password)
    if ok:
        return {"status": "ok", "message": msg}
    raise HTTPException(500, msg)
