"""
emby.py – Emby / Jellyfin integration helpers for Anisubarr.

Currently exposes:
  trigger_library_scan() — fire-and-forget library refresh after a new
                           series is moved into the anime_series folder.
"""
from __future__ import annotations

import logging

log = logging.getLogger(__name__)


def _get_config() -> tuple[str, str] | tuple[None, None]:
    """
    Return (host, api_key) from DB settings (preferred) or .env fallback.
    Returns (None, None) if Emby is not configured.
    """
    host = api_key = None

    # Try DB-stored settings first
    try:
        from ..database import SessionLocal
        from ..models.app_settings import AppSetting
        db = SessionLocal()
        try:
            h = db.query(AppSetting).filter(AppSetting.key == "emby_host").first()
            k = db.query(AppSetting).filter(AppSetting.key == "emby_api_key").first()
            host    = (h.value or "").strip() if h else ""
            api_key = (k.value or "").strip() if k else ""
        finally:
            db.close()
    except Exception:
        pass

    # Fall back to .env / environment variables
    if not host or not api_key:
        try:
            from ..config import get_settings
            cfg     = get_settings()
            host    = host    or (getattr(cfg, "emby_host",    "") or "").strip()
            api_key = api_key or (getattr(cfg, "emby_api_key", "") or "").strip()
        except Exception:
            pass

    if not host or not api_key:
        return None, None

    host = host.rstrip("/")
    if not host.startswith("http"):
        host = f"http://{host}"

    return host, api_key


def trigger_library_scan(*, series_title: str = "") -> str:
    """
    POST /Library/Refresh to Emby/Jellyfin to trigger a full library scan.

    Returns one of:
      "ok"             — scan request accepted
      "not_configured" — Emby host/key not set
      "error: <msg>"   — HTTP or connection error

    This is best-effort — it never raises.
    """
    host, api_key = _get_config()
    if not host:
        log.debug("Emby not configured — skipping library scan")
        return "not_configured"

    try:
        import httpx
        url = f"{host}/Library/Refresh"
        r = httpx.post(
            url,
            headers={"X-Emby-Token": api_key},
            timeout=15,
        )
        r.raise_for_status()
        log.info(
            "Emby library scan triggered%s",
            f" (po publikování '{series_title}')" if series_title else "",
        )
        return "ok"
    except Exception as exc:
        log.warning("Emby library scan failed: %s", exc)
        return f"error: {exc}"
