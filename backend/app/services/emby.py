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


_server_kind_cache: str | None = None


def server_kind(db=None) -> str:
    """"emby" or "jellyfin" — they route their web client differently, so a
    deep link built for the wrong one just lands on the homepage.

    Asked once per process; a stored answer in settings wins so an offline
    server doesn't silently change the links.
    """
    global _server_kind_cache
    if _server_kind_cache:
        return _server_kind_cache

    try:
        from ..utils.settings_helper import read_setting
        stored = (read_setting("emby_server_kind", db) or "").strip().lower()
        if stored in ("emby", "jellyfin"):
            _server_kind_cache = stored
            return stored
    except Exception:
        pass

    kind = "emby"
    try:
        host, _ = _get_config()
        if host:
            import httpx
            r = httpx.get(f"{host}/System/Info/Public", timeout=6)
            r.raise_for_status()
            product = ((r.json() or {}).get("ProductName") or "").lower()
            if "jellyfin" in product:
                kind = "jellyfin"
    except Exception as exc:
        log.debug("Emby server kind probe failed (%s) — predpokládám Emby", exc)
    _server_kind_cache = kind
    return kind


def _norm_title(text: str) -> str:
    """Comparison form: punctuation is where library naming differs most —
    "86: Eighty Six" in Sonarr is "86 EIGHTY-SIX" in Emby."""
    import re
    return re.sub(r"[^0-9a-z]+", " ", (text or "").lower()).strip()


def _query_items(host: str, api_key: str, params: dict) -> list[dict]:
    import httpx
    r = httpx.get(f"{host}/Items", params={**params, "api_key": api_key,
                                           "IncludeItemTypes": "Series",
                                           "Recursive": "true"}, timeout=15)
    r.raise_for_status()
    return (r.json() or {}).get("Items") or []


def find_series_item(
    series_name: str,
    year: int | None = None,
    provider_ids: dict | None = None,
    alt_titles: list[str] | None = None,
) -> dict | None:
    """The library item for a series, or None. See fetch_emby_id() for the
    matching strategy; this returns the whole item so callers can also use the
    ServerId, which makes the web deep link unambiguous."""
    host, api_key = _get_config()
    if not host:
        return None

    try:
        for key in ("tvdb", "tmdb", "imdb"):
            value = (provider_ids or {}).get(key)
            if not value:
                continue
            items = _query_items(host, api_key,
                                 {"AnyProviderIdEquals": f"{key}.{value}"})
            if items:
                return items[0]

        candidates = [series_name, *(alt_titles or [])]
        seen: set[str] = set()
        first_hit = None
        for title in candidates:
            norm = _norm_title(title)
            if not norm or norm in seen:
                continue
            seen.add(norm)
            items = _query_items(host, api_key, {"searchTerm": title})
            if items and first_hit is None:
                first_hit = items[0]
            for item in items:
                if _norm_title(item.get("Name") or "") == norm:
                    return item

        return first_hit
    except Exception as exc:
        log.warning("Emby find_series_item('%s') failed: %s", series_name, exc)
        return None


def fetch_emby_id(
    series_name: str,
    year: int | None = None,
    provider_ids: dict | None = None,
    alt_titles: list[str] | None = None,
) -> str | None:
    """
    Lookup the Emby/Jellyfin item ID for a series.

    Tried in order of reliability:
      1. provider ids (tvdb/tmdb/imdb) — exact, immune to naming differences,
      2. each known title, matched ignoring punctuation and case,
      3. first search hit as a last resort.

    Searching by the Sonarr title alone was too brittle: "86: Eighty Six"
    finds nothing in a library that calls the show "86 EIGHTY-SIX", and the
    series then has no emby_id, which is what turns the "Přehrát" link in a
    Discord notification into a bare link to the Emby homepage.

    Returns None if not found / Emby not configured / any error.
    """
    item = find_series_item(series_name, year=year, provider_ids=provider_ids,
                            alt_titles=alt_titles)
    return item.get("Id") if item else None


def ensure_emby_id(series, db=None) -> str | None:
    """Emby id of a series, looked up and stored if it's still missing.

    Called right before a notification goes out: the id is filled during sync,
    but a series synced while Emby was unreachable (or renamed since) would
    otherwise keep sending links to the homepage until the next full sync.
    """
    existing = getattr(series, "emby_id", None)
    if existing:
        return existing

    import json
    alternates: list[str] = []
    for attr in ("title_romaji", "title_english", "title_japanese"):
        value = getattr(series, attr, None)
        if value:
            alternates.append(value)
    raw = getattr(series, "alternate_titles", None)
    if raw:
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                alternates.extend(
                    x.get("title") if isinstance(x, dict) else x for x in parsed
                )
        except Exception:
            pass

    item = find_series_item(
        getattr(series, "title", "") or "",
        year=getattr(series, "year", None),
        provider_ids={
            "tvdb": getattr(series, "tvdb_id", None),
            "tmdb": getattr(series, "tmdb_id", None),
            "imdb": getattr(series, "imdb_id", None),
        },
        alt_titles=[t for t in alternates if isinstance(t, str)],
    )
    if not item:
        return None

    found = item.get("Id")
    _remember_server_id(item.get("ServerId"), db)
    if found and db is not None:
        try:
            series.emby_id = found
            db.commit()
        except Exception:
            db.rollback()
    return found


def _remember_server_id(server_id: str | None, db=None) -> None:
    """The server id is the same for every item, so it's stored once and reused
    in deep links — Emby resolves them more reliably with it."""
    if not server_id:
        return
    try:
        from ..utils.settings_helper import read_setting
        if (read_setting("emby_server_id", db) or "").strip() == server_id:
            return
    except Exception:
        pass
    try:
        from ..database import SessionLocal
        from ..models.app_settings import AppSetting
        own = db is None
        session = SessionLocal() if own else db
        try:
            row = session.query(AppSetting).filter(
                AppSetting.key == "emby_server_id").first()
            if row:
                row.value = server_id
            else:
                session.add(AppSetting(key="emby_server_id", value=server_id))
            session.commit()
        finally:
            if own:
                session.close()
    except Exception as exc:
        log.debug("Emby server id se nepodařilo uložit: %s", exc)


def wait_for_series(series, db=None, timeout: float = 300.0,
                    interval: float | None = None) -> str | None:
    """Poll the library until the series shows up, then return its id.

    A freshly promoted show is moved into the library folder moments before the
    notification goes out, so at that instant it usually isn't in Emby yet.
    Waiting for the scan to pick it up is the difference between a link that
    opens the show and one that opens the homepage.

    Returns None on timeout — the caller still sends the message, just without
    a deep link. A notification is worth more than a perfect link.
    """
    import time

    host, _ = _get_config()
    if not host:
        return None

    # Derived from the timeout so a short wait still checks more than once —
    # a fixed 15 s interval would turn "wait 10 s" into a single attempt.
    if interval is None:
        interval = min(15.0, max(1.0, timeout / 6))

    deadline = time.monotonic() + max(0.0, timeout)
    while True:
        found = ensure_emby_id(series, db)
        if found:
            return found
        if time.monotonic() + interval >= deadline:
            log.info("Emby: '%s' se do %.0f s v knihovně neobjevil",
                     getattr(series, "title", "?"), timeout)
            return None
        time.sleep(interval)


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
