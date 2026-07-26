"""
emby.py - Emby / Jellyfin integration helpers for Anisubarr.

Currently exposes:
  fetch_emby_id()       -- lookup Emby item ID for a series by name
  trigger_library_scan() -- fire-and-forget library refresh after a new
                            series is moved into the anime_series folder.
"""
from __future__ import annotations

import logging

log = logging.getLogger(__name__)


def _get_config() -> tuple[str, str] | tuple[None, None]:
    """
    Return (host, api_key) for Emby/Jellyfin. Resolves through the connection
    registry (Připojení → Služby) first, then legacy DB settings / .env.
    Returns (None, None) if Emby is not configured.
    """
    host = api_key = None
    try:
        from ..database import SessionLocal
        from . import connections
        db = SessionLocal()
        try:
            host, api_key = connections.resolve_emby(db)
        finally:
            db.close()
    except Exception:
        pass

    if not host or not api_key:
        return None, None

    host = host.rstrip("/")
    if not host.startswith("http"):
        host = f"http://{host}"

    return host, api_key


def fetch_emby_id(series_name: str, year: int | None = None) -> str | None:
    """
    Lookup the Emby item ID for a series by name.

    Calls GET {emby_url}/Items?searchTerm=...&IncludeItemTypes=Series&Recursive=true
    Returns the Id of the first result whose Name matches case-insensitively,
    or None if not found / Emby not configured / any error.
    """
    host, api_key = _get_config()
    if not host:
        return None

    try:
        import httpx
        url = f"{host}/Items"
        params = {
            "searchTerm": series_name,
            "IncludeItemTypes": "Series",
            "Recursive": "true",
            "api_key": api_key,
        }
        r = httpx.get(url, params=params, timeout=15)
        r.raise_for_status()
        data = r.json()
        items = data.get("Items") or []
        name_lower = series_name.lower()
        for item in items:
            if (item.get("Name") or "").lower() == name_lower:
                return item.get("Id")
        # No exact match - return first result as fallback
        if items:
            return items[0].get("Id")
        return None
    except Exception as exc:
        log.warning("Emby fetch_emby_id('%s') failed: %s", series_name, exc)
        return None


def trigger_library_scan(*, series_title: str = "") -> str:
    """
    POST /Library/Refresh to Emby/Jellyfin to trigger a full library scan.

    Returns one of:
      "ok"             -- scan request accepted
      "not_configured" -- Emby host/key not set
      "error: <msg>"   -- HTTP or connection error

    This is best-effort -- it never raises.
    """
    host, api_key = _get_config()
    if not host:
        log.debug("Emby not configured -- skipping library scan")
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
            f" (po publikovani '{series_title}')" if series_title else "",
        )
        return "ok"
    except Exception as exc:
        log.warning("Emby library scan failed: %s", exc)
        return f"error: {exc}"
