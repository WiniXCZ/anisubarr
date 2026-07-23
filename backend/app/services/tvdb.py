"""
tvdb.py – TVDB API v4 helper.

Provides:
  - get_tvdb_token(api_key, pin) → bearer token (cached 24h)
  - lookup_tvdb_id_by_anilist(anilist_id, api_key, pin) → int | None
  - lookup_tvdb_id_by_title(title, year, api_key, pin) → int | None
"""
from __future__ import annotations

import logging
import time

import httpx

log = logging.getLogger("anisubarr.tvdb")

_TVDB_BASE = "https://api4.thetvdb.com/v4"

# Simple in-process cache: token valid for 24h
_token_cache: dict[str, tuple[str, float]] = {}  # key → (token, expires_at)


def get_tvdb_token(api_key: str, pin: str = "") -> str | None:
    """Authenticate with TVDB API v4 and return bearer token (cached 24h)."""
    cache_key = f"{api_key}:{pin}"
    if cache_key in _token_cache:
        token, expires = _token_cache[cache_key]
        if time.time() < expires:
            return token

    body: dict = {"apikey": api_key}
    if pin:
        body["pin"] = pin
    try:
        with httpx.Client(timeout=10) as c:
            r = c.post(f"{_TVDB_BASE}/login", json=body)
            r.raise_for_status()
            data = r.json()
            token = data.get("data", {}).get("token")
            if not token:
                log.warning("TVDB login returned no token: %s", data)
                return None
            _token_cache[cache_key] = (token, time.time() + 86000)
            return token
    except httpx.HTTPStatusError as e:
        log.warning("TVDB login HTTP error %d: %s", e.response.status_code, e.response.text[:200])
        return None
    except Exception as exc:
        log.warning("TVDB login exception: %s", exc)
        return None


def lookup_tvdb_id_by_anilist(anilist_id: int, api_key: str, pin: str = "") -> int | None:
    """Look up TVDB series ID using AniList remote ID mapping."""
    token = get_tvdb_token(api_key, pin)
    if not token:
        return None
    headers = {"Authorization": f"Bearer {token}"}
    try:
        with httpx.Client(timeout=10) as c:
            r = c.get(f"{_TVDB_BASE}/search", params={"remoteId": f"anilist:{anilist_id}"}, headers=headers)
            if r.status_code == 200:
                results = r.json().get("data") or []
                for item in results:
                    if item.get("type") == "series":
                        tvdb_id = item.get("tvdb_id") or item.get("id")
                        if tvdb_id:
                            return int(str(tvdb_id).lstrip("series-"))
    except Exception as exc:
        log.debug("TVDB anilist lookup failed for %s: %s", anilist_id, exc)
    return None


def lookup_tvdb_id_by_title(title: str, year: int | None, api_key: str, pin: str = "") -> int | None:
    """Look up TVDB series ID by title (+ optional year) — used as fallback."""
    token = get_tvdb_token(api_key, pin)
    if not token:
        return None
    headers = {"Authorization": f"Bearer {token}"}
    params: dict = {"query": title, "type": "series"}
    if year:
        params["year"] = year
    try:
        with httpx.Client(timeout=10) as c:
            r = c.get(f"{_TVDB_BASE}/search", params=params, headers=headers)
            if r.status_code == 200:
                results = r.json().get("data") or []
                if results:
                    item = results[0]
                    tvdb_id = item.get("tvdb_id") or item.get("id")
                    if tvdb_id:
                        return int(str(tvdb_id).lstrip("series-"))
    except Exception as exc:
        log.debug("TVDB title lookup failed for %r: %s", title, exc)
    return None
