"""radarr.py – Radarr API service."""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Optional

import httpx
from sqlalchemy.orm import Session

from ..models.library import Library
from ..models.movie import Movie

log = logging.getLogger("anisubarr.radarr")


# ── low-level API client ──────────────────────────────────────────────────────

def _radarr_get(host: str, api_key: str, path: str, timeout: float = 15.0):
    base = host.rstrip("/")
    if not base.startswith("http"):
        base = f"http://{base}"
    url = f"{base}{path}"
    headers = {"X-Api-Key": api_key}
    r = httpx.get(url, headers=headers, timeout=timeout, follow_redirects=True)
    r.raise_for_status()
    return r.json()


def ping(host: str, api_key: str) -> bool:
    try:
        _radarr_get(host, api_key, "/api/v3/system/status")
        return True
    except Exception:
        return False


def fetch_movies(host: str, api_key: str) -> list[dict]:
    """Return all movies from Radarr."""
    return _radarr_get(host, api_key, "/api/v3/movie")


# ── poster URL helper ─────────────────────────────────────────────────────────

def _image_url(host: str, images: list[dict], cover_type: str) -> Optional[str]:
    base = host.rstrip("/")
    if not base.startswith("http"):
        base = f"http://{base}"
    for img in images:
        if img.get("coverType") == cover_type:
            remote = img.get("remoteUrl") or img.get("url") or ""
            return remote if remote.startswith("http") else f"{base}{remote}"
    return None


# ── sync ──────────────────────────────────────────────────────────────────────

def sync_library(db: Session, library: Library) -> dict:
    """Sync all Radarr movies for the given library into the Movie table."""
    if not library.radarr_host or not library.radarr_api_key:
        return {"error": "Radarr not configured for this library"}

    try:
        raw_movies = fetch_movies(library.radarr_host, library.radarr_api_key)
    except Exception as exc:
        log.error("Radarr fetch failed for library %s: %s", library.name, exc)
        return {"error": str(exc)}

    created = updated = 0
    now_iso = datetime.now(timezone.utc).isoformat()

    for rm in raw_movies:
        radarr_id = rm.get("id")
        if not radarr_id:
            continue

        movie = db.query(Movie).filter(Movie.radarr_id == radarr_id).first()
        is_new = movie is None
        if is_new:
            movie = Movie(radarr_id=radarr_id)

        movie.library_id    = library.id
        movie.tmdb_id       = rm.get("tmdbId")
        movie.imdb_id       = rm.get("imdbId")
        movie.title         = rm.get("title", "")
        movie.original_title= rm.get("originalTitle")
        movie.sort_title    = rm.get("sortTitle")
        movie.year          = rm.get("year")
        movie.overview      = rm.get("overview")
        movie.status        = rm.get("status")
        movie.monitored     = rm.get("monitored", True)
        movie.runtime       = rm.get("runtime")
        movie.certification = rm.get("certification")
        movie.path          = rm.get("path")
        movie.studio        = rm.get("studio")

        # Ratings
        ratings = rm.get("ratings") or {}
        tmdb_r = ratings.get("tmdb") or ratings.get("imdb") or {}
        movie.rating_value = tmdb_r.get("value")
        movie.rating_votes = tmdb_r.get("votes")

        # Genres
        genres = rm.get("genres") or []
        movie.genres = json.dumps(genres) if genres else None

        # Images
        images = rm.get("images") or []
        movie.poster_url   = _image_url(library.radarr_host, images, "poster")
        movie.backdrop_url = _image_url(library.radarr_host, images, "fanart")

        # File info
        movie_file = rm.get("movieFile") or {}
        if movie_file:
            movie.has_file    = True
            movie.file_path   = movie_file.get("path")
            movie.file_size   = movie_file.get("size")
            movie.date_added  = movie_file.get("dateAdded")
            qi = (movie_file.get("quality") or {}).get("quality") or {}
            movie.quality_name = qi.get("name")
            mi = movie_file.get("mediaInfo") or {}
            movie.video_codec  = mi.get("videoCodec")
            audio = (mi.get("audioCodec") or "")
            movie.audio_codec  = audio
            movie.resolution   = mi.get("resolution")
        else:
            movie.has_file = bool(rm.get("hasFile", False))

        # Release dates
        movie.in_cinemas       = rm.get("inCinemas")
        movie.physical_release = rm.get("physicalRelease")
        movie.digital_release  = rm.get("digitalRelease")

        # Added date
        movie.radarr_added = rm.get("added")
        movie.synced_at    = datetime.now(timezone.utc)

        if is_new:
            db.add(movie)
            created += 1
        else:
            updated += 1

    db.commit()
    log.info("Radarr sync library=%s: %d created, %d updated", library.name, created, updated)
    return {"created": created, "updated": updated, "total": len(raw_movies)}
