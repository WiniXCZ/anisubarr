"""TMDb API service — poster art + metadata."""
import logging
import time
import requests
from ..database import SessionLocal
from ..models.app_settings import AppSetting

log = logging.getLogger("anisubarr.tmdb")

_CACHE: dict = {}
_TTL = 86400  # 24h


def _get_api_key() -> str | None:
    db = SessionLocal()
    try:
        row = db.query(AppSetting).filter_by(key="tmdb_api_key").first()
        return row.value if row else None
    finally:
        db.close()


def fetch_anime_info(title: str, year: int = None) -> dict | None:
    """Search TMDb for a TV show.

    Returns dict with keys:
        tmdb_id, poster_url, backdrop_url, overview_en, year, genres
    or None if not found / API key missing.
    """
    key = _get_api_key()
    if not key:
        return None

    cache_key = f"{title}:{year}"
    cached = _CACHE.get(cache_key)
    if cached and time.time() - cached["_ts"] < _TTL:
        return {k: v for k, v in cached.items() if k != "_ts"}

    try:
        params = {"api_key": key, "query": title, "language": "en-US"}
        if year:
            params["first_air_date_year"] = year
        r = requests.get(
            "https://api.themoviedb.org/3/search/tv",
            params=params,
            timeout=5,
        )
        r.raise_for_status()
        results = r.json().get("results", [])
        if not results:
            return None
        best = results[0]
        info = {
            "tmdb_id": best["id"],
            "poster_url": (
                f"https://image.tmdb.org/t/p/w500{best['poster_path']}"
                if best.get("poster_path")
                else None
            ),
            "backdrop_url": (
                f"https://image.tmdb.org/t/p/w1280{best['backdrop_path']}"
                if best.get("backdrop_path")
                else None
            ),
            "overview_en": best.get("overview", ""),
            "year": (
                int(best.get("first_air_date", "")[:4])
                if best.get("first_air_date")
                else year
            ),
            "genres": [],
        }
        _CACHE[cache_key] = {**info, "_ts": time.time()}
        return info
    except Exception as e:
        log.warning("TMDb error: %s", e)
        return None
