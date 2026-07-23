"""
discover.py – Discovery endpoints (trending + seasonal anime from AniList).

Endpoints:
  GET /api/discover/trending           – top 20 trending anime
  GET /api/discover/seasonal?year=&season=  – seasonal anime (default: current season)
"""
from __future__ import annotations

import time
from datetime import datetime

import httpx
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user
from ..models.user import User
from ..utils.settings_helper import read_setting

router = APIRouter(prefix="/api/discover", tags=["discover"])

# TVDB ID cache: anilist_id → tvdb_id  (persists for process lifetime, avoids hammering API)
_tvdb_id_cache: dict[int, int | None] = {}

_CACHE_TTL = 3600  # 1 hour
_cache: dict[str, tuple] = {}

_ANILIST_URL = "https://graphql.anilist.co"

_TRENDING_QUERY = """
query {
  Page(page: 1, perPage: 20) {
    media(type: ANIME, sort: TRENDING_DESC, status_not: NOT_YET_RELEASED) {
      id
      title { english romaji }
      description(asHtml: false)
      coverImage { large extraLarge }
      bannerImage
      episodes
      averageScore
      genres
      status
      startDate { year }
      externalLinks { site url }
    }
  }
}
"""

_SEASONAL_QUERY = """
query ($season: MediaSeason, $year: Int) {
  Page(page: 1, perPage: 30) {
    media(type: ANIME, season: $season, seasonYear: $year, sort: POPULARITY_DESC) {
      id
      title { english romaji }
      description(asHtml: false)
      coverImage { large extraLarge }
      bannerImage
      episodes
      averageScore
      genres
      status
      startDate { year }
      externalLinks { site url }
    }
  }
}
"""

_UPCOMING_QUERY = """
query {
  Page(page: 1, perPage: 20) {
    media(type: ANIME, status: NOT_YET_RELEASED, sort: POPULARITY_DESC) {
      id
      title { english romaji }
      description(asHtml: false)
      coverImage { large extraLarge }
      bannerImage
      episodes
      averageScore
      genres
      status
      startDate { year month day }
      externalLinks { site url }
    }
  }
}
"""

_EXPLORE_QUERY = """
query ($genre: String, $year: Int, $status: MediaStatus, $page: Int) {
  Page(page: $page, perPage: 24) {
    pageInfo { hasNextPage }
    media(type: ANIME, genre: $genre, seasonYear: $year, status: $status, sort: POPULARITY_DESC) {
      id
      title { english romaji }
      description(asHtml: false)
      coverImage { large extraLarge }
      bannerImage
      episodes
      averageScore
      genres
      status
      startDate { year month day }
      externalLinks { site url }
    }
  }
}
"""

_GENRES_QUERY = """
query {
  GenreCollection
}
"""


def _gql(query: str, variables: dict | None = None) -> dict:
    with httpx.Client(timeout=15) as c:
        r = c.post(_ANILIST_URL, json={"query": query, "variables": variables or {}})
        r.raise_for_status()
        return r.json()


def _current_season() -> tuple[str, int]:
    now = datetime.utcnow()
    month = now.month
    year = now.year
    if month in (1, 2, 3):
        return "WINTER", year
    elif month in (4, 5, 6):
        return "SPRING", year
    elif month in (7, 8, 9):
        return "SUMMER", year
    else:
        return "FALL", year


def _extract_tvdb_id_from_links(links: list[dict]) -> int | None:
    """Try to parse TVDB ID from AniList externalLinks (e.g. https://thetvdb.com/series/…)."""
    for link in links:
        if "thetvdb" in (link.get("site") or "").lower() or "thetvdb" in (link.get("url") or "").lower():
            url = link.get("url") or ""
            # https://www.thetvdb.com/series/{slug} — slug is not the numeric ID, skip
            # https://thetvdb.com/?tab=series&id=12345
            import re
            m = re.search(r'[?&]id=(\d+)', url)
            if m:
                return int(m.group(1))
    return None


def _normalize(m: dict) -> dict:
    title = m.get("title") or {}
    cover = m.get("coverImage") or {}
    start = m.get("startDate") or {}
    links = m.get("externalLinks") or []
    tvdb_from_links = _extract_tvdb_id_from_links(links)
    return {
        "anilist_id": m.get("id"),
        "title_english": title.get("english") or title.get("romaji"),
        "title_romaji": title.get("romaji"),
        "poster_url": cover.get("extraLarge") or cover.get("large"),
        "banner_url": m.get("bannerImage"),
        "episodes": m.get("episodes"),
        "score": m.get("averageScore"),
        "genres": m.get("genres") or [],
        "status": m.get("status"),
        "year": start.get("year"),
        "start_date": {
            "year": start.get("year"),
            "month": start.get("month"),
            "day": start.get("day"),
        } if start else None,
        "description": (m.get("description") or "")[:600],
        "tvdb_id": tvdb_from_links,  # may be None; enriched later via TVDB API
    }


def _enrich_tvdb_ids(items: list[dict], db) -> list[dict]:
    """Fill in tvdb_id for items that don't have it yet, using TVDB API if configured."""
    api_key = read_setting("tvdb_api_key", db) or ""
    if not api_key:
        return items  # TVDB not configured, return as-is

    pin = read_setting("tvdb_pin", db) or ""

    from ..services.tvdb import lookup_tvdb_id_by_anilist, lookup_tvdb_id_by_title
    for item in items:
        if item.get("tvdb_id"):
            continue  # already have it from externalLinks
        anilist_id = item.get("anilist_id")
        if anilist_id is None:
            continue
        # Check process-level cache first
        if anilist_id in _tvdb_id_cache:
            item["tvdb_id"] = _tvdb_id_cache[anilist_id]
            continue
        # Try AniList remote ID lookup
        tvdb_id = lookup_tvdb_id_by_anilist(anilist_id, api_key, pin)
        # Fallback: title+year search
        if tvdb_id is None:
            title = item.get("title_english") or item.get("title_romaji") or ""
            year = item.get("year")
            if title:
                tvdb_id = lookup_tvdb_id_by_title(title, year, api_key, pin)
        _tvdb_id_cache[anilist_id] = tvdb_id
        item["tvdb_id"] = tvdb_id
    return items


@router.get("/trending")
def get_trending(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Top 20 trending anime from AniList (cached 1h)."""
    cache_key = "trending"
    if cache_key in _cache:
        result, expires = _cache[cache_key]
        if time.time() < expires:
            return result

    data = _gql(_TRENDING_QUERY)
    media_list = data.get("data", {}).get("Page", {}).get("media", [])
    result = [_normalize(m) for m in media_list]
    _enrich_tvdb_ids(result, db)
    _cache[cache_key] = (result, time.time() + _CACHE_TTL)
    return result


@router.get("/seasonal")
def get_seasonal(
    year: int | None = Query(None),
    season: str | None = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Seasonal anime from AniList (cached 1h). Defaults to current season."""
    if not season or not year:
        default_season, default_year = _current_season()
        season = season or default_season
        year = year or default_year

    season = season.upper()
    cache_key = f"seasonal:{season}:{year}"
    if cache_key in _cache:
        result, expires = _cache[cache_key]
        if time.time() < expires:
            return result

    data = _gql(_SEASONAL_QUERY, {"season": season, "year": year})
    media_list = data.get("data", {}).get("Page", {}).get("media", [])
    result = [_normalize(m) for m in media_list]
    _enrich_tvdb_ids(result, db)
    _cache[cache_key] = (result, time.time() + _CACHE_TTL)
    return result


@router.get("/upcoming")
def get_upcoming(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Top 20 not-yet-released anime from AniList, for countdown display (cached 1h)."""
    cache_key = "upcoming"
    if cache_key in _cache:
        result, expires = _cache[cache_key]
        if time.time() < expires:
            return result

    data = _gql(_UPCOMING_QUERY)
    media_list = data.get("data", {}).get("Page", {}).get("media", [])
    result = [_normalize(m) for m in media_list]
    # Sort by soonest air date first (entries without a date go last)
    result.sort(key=lambda r: (
        (r["start_date"] or {}).get("year") or 9999,
        (r["start_date"] or {}).get("month") or 13,
        (r["start_date"] or {}).get("day") or 32,
    ))
    _enrich_tvdb_ids(result, db)
    _cache[cache_key] = (result, time.time() + _CACHE_TTL)
    return result


@router.get("/genres")
def get_genres(
    _: User = Depends(get_current_user),
):
    """List of all AniList genre names (cached 24h)."""
    cache_key = "genres"
    if cache_key in _cache:
        result, expires = _cache[cache_key]
        if time.time() < expires:
            return result

    data = _gql(_GENRES_QUERY)
    result = data.get("data", {}).get("GenreCollection", []) or []
    _cache[cache_key] = (result, time.time() + 86400)
    return result


@router.get("/explore")
def explore(
    genre: str | None = Query(None),
    year: int | None = Query(None),
    status: str | None = Query(None),
    page: int = Query(1, ge=1, le=10),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Explorer — filter anime by genre / year / status (cached 1h per combination)."""
    status_norm = status.upper() if status else None
    cache_key = f"explore:{genre}:{year}:{status_norm}:{page}"
    if cache_key in _cache:
        result, expires = _cache[cache_key]
        if time.time() < expires:
            return result

    variables: dict = {"page": page}
    if genre:
        variables["genre"] = genre
    if year:
        variables["year"] = year
    if status_norm:
        variables["status"] = status_norm

    data = _gql(_EXPLORE_QUERY, variables)
    page_data = data.get("data", {}).get("Page", {})
    media_list = page_data.get("media", [])
    result = {
        "items": [_normalize(m) for m in media_list],
        "has_next_page": (page_data.get("pageInfo") or {}).get("hasNextPage", False),
    }
    _enrich_tvdb_ids(result["items"], db)
    _cache[cache_key] = (result, time.time() + _CACHE_TTL)
    return result
