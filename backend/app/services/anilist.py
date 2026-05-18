import httpx
from typing import Optional
from ..config import get_settings

settings = get_settings()

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
    try:
        data = _gql(_SERIES_QUERY, {"search": title})
        return data.get("data", {}).get("Media")
    except Exception:
        return None


def get_anime_by_id(anilist_id: int) -> Optional[dict]:
    try:
        data = _gql(_ID_QUERY, {"id": anilist_id})
        return data.get("data", {}).get("Media")
    except Exception:
        return None


def normalize(media: dict) -> dict:
    """Flatten AniList Media into a simple dict for our DB."""
    title = media.get("title", {})
    cover = media.get("coverImage", {})
    start = media.get("startDate", {}) or {}
    return {
        "anilist_id":     media.get("id"),
        "title_romaji":   title.get("romaji"),
        "title_english":  title.get("english"),
        "title_japanese": title.get("native"),
        "year":           start.get("year"),
        "overview":       media.get("description"),
        "cover_url":      cover.get("extraLarge") or cover.get("large"),
        "banner_url":     media.get("bannerImage"),
        "average_score":  (media.get("averageScore") or 0) / 10,  # 0-10 scale
        "status":         media.get("status"),
        "genres":         str(media.get("genres", [])),
        "tags":           str([t["name"] for t in (media.get("tags") or [])[:10]]),
    }
