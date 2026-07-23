import time
import httpx
from typing import Optional
from ..config import get_settings

settings = get_settings()

# In-memory TTL cache: key -> (result, expires_at)
_CACHE_TTL = 3600  # 1 hour
_cache: dict[str, tuple] = {}

_SERIES_QUERY = """
query ($search: String) {
  Media(search: $search, type: ANIME) {
    id
    title { romaji english native }
    description(asHtml: false)
    coverImage { extraLarge large }
    bannerImage
    averageScore
    status
    startDate { year }
    genres
    tags { name rank }
  }
}
"""

_ID_QUERY = """
query ($id: Int) {
  Media(id: $id, type: ANIME) {
    id
    title { romaji english native }
    description(asHtml: false)
    coverImage { extraLarge large }
    bannerImage
    averageScore
    status
    startDate { year }
    genres
    tags { name rank }
  }
}
"""


def _gql(query: str, variables: dict) -> dict:
    with httpx.Client(timeout=15) as c:
        r = c.post(settings.anilist_api, json={"query": query, "variables": variables})
        r.raise_for_status()
        return r.json()


def search_anime(title: str) -> Optional[dict]:
    key = f"search:{title}"
    if key in _cache:
        result, expires_at = _cache[key]
        if time.time() < expires_at:
            return result
    try:
        data = _gql(_SERIES_QUERY, {"search": title})
        result = data.get("data", {}).get("Media")
        _cache[key] = (result, time.time() + _CACHE_TTL)
        return result
    except Exception:
        return None


def get_anime_by_id(anilist_id: int) -> Optional[dict]:
    key = f"id:{anilist_id}"
    if key in _cache:
        result, expires_at = _cache[key]
        if time.time() < expires_at:
            return result
    try:
        data = _gql(_ID_QUERY, {"id": anilist_id})
        result = data.get("data", {}).get("Media")
        _cache[key] = (result, time.time() + _CACHE_TTL)
        return result
    except Exception:
        return None


_TITLE_QUERY = """
query ($search: String, $seasonYear: Int) {
  Media(search: $search, type: ANIME, seasonYear: $seasonYear) {
    title { english romaji }
    description(asHtml: false)
  }
}
"""


def fetch_english_title(series_name: str, year: int = None) -> dict | None:
    """Query AniList and return English title, romaji, and synopsis (max 1000 chars).

    Returns None if nothing found or request fails.
    """
    key = f"en:{series_name}:{year}"
    if key in _cache:
        result, expires_at = _cache[key]
        if time.time() < expires_at:
            return result

    try:
        variables: dict = {"search": series_name}
        if year:
            variables["seasonYear"] = year
        data = _gql(_TITLE_QUERY, variables)
        media = data.get("data", {}).get("Media")
        if not media:
            _cache[key] = (None, time.time() + _CACHE_TTL)
            return None
        title = media.get("title", {})
        desc = (media.get("description") or "")[:1000]
        result = {
            "title_english": title.get("english"),
            "title_romaji":  title.get("romaji"),
            "synopsis":      desc,
        }
        _cache[key] = (result, time.time() + _CACHE_TTL)
        return result
    except Exception:
        return None


# -- Discovery queries --------------------------------------------------------

_TRENDING_QUERY = """
query {
  Page(page: 1, perPage: 20) {
    media(type: ANIME, sort: TRENDING_DESC, status_not: NOT_YET_RELEASED) {
      id
      title { english romaji }
      coverImage { large extraLarge }
      bannerImage
      episodes
      averageScore
      genres
      description(asHtml: false)
      season
      seasonYear
    }
  }
}
"""

_SEASONAL_QUERY = """
query ($season: MediaSeason, $year: Int) {
  Page(page: 1, perPage: 20) {
    media(type: ANIME, season: $season, seasonYear: $year, sort: POPULARITY_DESC) {
      id
      title { english romaji }
      coverImage { large extraLarge }
      episodes
      averageScore
      genres
    }
  }
}
"""


def _current_season() -> tuple:
    """Return (SEASON, year) for the current calendar quarter."""
    import datetime
    now = datetime.datetime.utcnow()
    month, year = now.month, now.year
    if month in (1, 2, 3):
        return "WINTER", year
    elif month in (4, 5, 6):
        return "SPRING", year
    elif month in (7, 8, 9):
        return "SUMMER", year
    else:
        return "FALL", year


def fetch_trending() -> list:
    """Return top 20 trending anime from AniList. Cached 1h."""
    key = "trending"
    if key in _cache:
        result, expires = _cache[key]
        if time.time() < expires:
            return result
    data = _gql(_TRENDING_QUERY, {})
    items = data.get("data", {}).get("Page", {}).get("media", [])
    _cache[key] = (items, time.time() + _CACHE_TTL)
    return items


def fetch_seasonal(season: str = None, year: int = None) -> list:
    """Return anime for the given season (default: current). Cached 1h."""
    if not season or not year:
        default_season, default_year = _current_season()
        season = season or default_season
        year = year or default_year
    season = season.upper()
    key = f"seasonal:{season}:{year}"
    if key in _cache:
        result, expires = _cache[key]
        if time.time() < expires:
            return result
    data = _gql(_SEASONAL_QUERY, {"season": season, "year": year})
    items = data.get("data", {}).get("Page", {}).get("media", [])
    _cache[key] = (items, time.time() + _CACHE_TTL)
    return items


# -- Normalize ----------------------------------------------------------------

def normalize(media: dict) -> dict:
    """Flatten AniList Media into a simple dict for our DB."""
    title = media.get("title", {})
    cover = media.get("coverImage", {})
    start = media.get("startDate", {}) or {}
    return {
        "anilist_id":       media.get("id"),
        "title_romaji":     title.get("romaji"),
        "title_english":    title.get("english"),
        "title_japanese":   title.get("native"),
        "year":             start.get("year"),
        "overview":         media.get("description"),
        "overview_anilist": media.get("description"),
        "cover_url":        cover.get("extraLarge") or cover.get("large"),
        "banner_url":       media.get("bannerImage"),
        "average_score":    (media.get("averageScore") or 0) / 10,
        "status":           media.get("status"),
        "genres":           str(media.get("genres", [])),
        "tags":             str([t["name"] for t in (media.get("tags") or [])[:10]]),
    }
