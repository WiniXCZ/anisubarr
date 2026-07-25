"""libraries.py – Library management CRUD + sync endpoints."""
from __future__ import annotations

import logging
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user, require_admin
from ..models.library import Library
from ..models.movie import Movie
from ..models.series import Series
from ..models.user import User

log = logging.getLogger("anisubarr.libraries")

router = APIRouter(prefix="/api/libraries", tags=["libraries"])


# ── schemas ───────────────────────────────────────────────────────────────────

class LibraryCreate(BaseModel):
    name: str
    media_type: str = "series"   # anime / series / movies
    sort_order: int = 0
    enabled: bool = True
    sonarr_service_id: Optional[int] = None   # preferred: link to a registry Service
    sonarr_host: Optional[str] = None
    sonarr_api_key: Optional[str] = None
    radarr_host: Optional[str] = None
    radarr_api_key: Optional[str] = None
    indexer_host: Optional[str] = None
    indexer_api_key: Optional[str] = None
    indexer_type: Optional[str] = None
    torrent_host: Optional[str] = None
    torrent_username: Optional[str] = None
    torrent_password: Optional[str] = None
    nzb_host: Optional[str] = None
    nzb_api_key: Optional[str] = None
    nzb_type: Optional[str] = None
    subtitles_enabled: bool = True
    translation_enabled: bool = True
    anilist_enabled: bool = False


class LibraryUpdate(LibraryCreate):
    name: Optional[str] = None
    media_type: Optional[str] = None


# ── connection resolution ─────────────────────────────────────────────────────

def _lib_sonarr(db: Session, lib: Library) -> tuple[str, str]:
    """(host, api_key) for a library's Sonarr: registry service first
    (sonarr_service_id), then legacy embedded columns, then the global default."""
    if lib.sonarr_service_id:
        from ..models.service import Service
        svc = db.query(Service).filter(Service.id == lib.sonarr_service_id).first()
        if svc and svc.host:
            return svc.host, (svc.api_key or "")
    if lib.sonarr_host:
        return lib.sonarr_host, (lib.sonarr_api_key or "")
    from ..services import connections
    return connections.resolve_sonarr(db)


# ── serializer ────────────────────────────────────────────────────────────────

def _lib_out(lib: Library, db: Session) -> dict:
    series_count = db.query(Series).filter(Series.library_id == lib.id).count()
    movies_count = db.query(Movie).filter(Movie.library_id == lib.id).count()
    return {
        "id": lib.id,
        "name": lib.name,
        "media_type": lib.media_type,
        "sort_order": lib.sort_order,
        "enabled": lib.enabled,
        "sonarr_service_id": lib.sonarr_service_id,
        "sonarr_host": lib.sonarr_host,
        "sonarr_api_key": "••••" if lib.sonarr_api_key else None,
        "radarr_host": lib.radarr_host,
        "radarr_api_key": "••••" if lib.radarr_api_key else None,
        "indexer_host": lib.indexer_host,
        "indexer_api_key": "••••" if lib.indexer_api_key else None,
        "indexer_type": lib.indexer_type,
        "torrent_host": lib.torrent_host,
        "torrent_username": lib.torrent_username,
        "torrent_password": "••••" if lib.torrent_password else None,
        "nzb_host": lib.nzb_host,
        "nzb_api_key": "••••" if lib.nzb_api_key else None,
        "nzb_type": lib.nzb_type,
        "subtitles_enabled": lib.subtitles_enabled,
        "translation_enabled": lib.translation_enabled,
        "anilist_enabled": lib.anilist_enabled,
        "series_count": series_count,
        "movies_count": movies_count,
        "created_at": lib.created_at.isoformat() if lib.created_at else None,
    }


# ── CRUD ──────────────────────────────────────────────────────────────────────

@router.get("")
def list_libraries(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    libs = db.query(Library).order_by(Library.sort_order, Library.id).all()
    return [_lib_out(lib, db) for lib in libs]


@router.post("", status_code=201)
def create_library(body: LibraryCreate, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    lib = Library(**body.model_dump())
    db.add(lib)
    db.commit()
    db.refresh(lib)
    log.info("Created library id=%d name=%r type=%s", lib.id, lib.name, lib.media_type)
    return _lib_out(lib, db)


@router.get("/{lib_id}")
def get_library(lib_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    lib = db.query(Library).filter(Library.id == lib_id).first()
    if not lib:
        raise HTTPException(404, "Library not found")
    return _lib_out(lib, db)


@router.patch("/{lib_id}")
def update_library(lib_id: int, body: LibraryUpdate, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    lib = db.query(Library).filter(Library.id == lib_id).first()
    if not lib:
        raise HTTPException(404, "Library not found")
    data = body.model_dump(exclude_none=True)
    # Don't overwrite masked API keys
    for key_field in ("sonarr_api_key", "radarr_api_key", "indexer_api_key", "nzb_api_key", "torrent_password"):
        if data.get(key_field) and data[key_field].startswith("••••"):
            data.pop(key_field)
    for k, v in data.items():
        setattr(lib, k, v)
    db.commit()
    db.refresh(lib)
    return _lib_out(lib, db)


@router.delete("/{lib_id}", status_code=204)
def delete_library(lib_id: int, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    lib = db.query(Library).filter(Library.id == lib_id).first()
    if not lib:
        raise HTTPException(404, "Library not found")
    # Unlink series/movies — don't delete content
    db.query(Series).filter(Series.library_id == lib_id).update({"library_id": None})
    db.query(Movie).filter(Movie.library_id == lib_id).update({"library_id": None})
    db.delete(lib)
    db.commit()


# ── test connection ───────────────────────────────────────────────────────────

@router.post("/{lib_id}/test")
async def test_library_connection(lib_id: int, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    lib = db.query(Library).filter(Library.id == lib_id).first()
    if not lib:
        raise HTTPException(404, "Library not found")

    results = {}

    async def _ping(name: str, url: str, path: str, api_key: str = ""):
        if not url:
            return
        base = url.rstrip("/")
        if not base.startswith("http"):
            base = f"http://{base}"
        headers = {}
        if api_key:
            headers["X-Api-Key"] = api_key
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                r = await client.get(f"{base}{path}", headers=headers, follow_redirects=True)
            results[name] = {"ok": r.status_code < 400, "status": r.status_code}
        except Exception as exc:
            results[name] = {"ok": False, "error": str(exc)}

    if lib.sonarr_host:
        await _ping("sonarr", lib.sonarr_host, "/api/v3/system/status", lib.sonarr_api_key or "")
    if lib.radarr_host:
        await _ping("radarr", lib.radarr_host, "/api/v3/system/status", lib.radarr_api_key or "")
    if lib.indexer_host:
        path = "/api/v1/system/status" if lib.indexer_type == "prowlarr" else "/api/system/status"
        await _ping("indexer", lib.indexer_host, path, lib.indexer_api_key or "")
    if lib.torrent_host:
        await _ping("torrent", lib.torrent_host, "/api/v2/app/version")
    if lib.nzb_host:
        path = "/api?mode=queue&output=json&limit=1" if lib.nzb_type == "sabnzbd" else "/jsonrpc"
        await _ping("nzb", lib.nzb_host, path)

    return results


# ── sync ──────────────────────────────────────────────────────────────────────

@router.post("/{lib_id}/sync")
def sync_library(lib_id: int, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    lib = db.query(Library).filter(Library.id == lib_id).first()
    if not lib:
        raise HTTPException(404, "Library not found")

    results = {}

    if lib.media_type == "movies" and lib.radarr_host:
        from ..services import radarr as radarr_svc
        results["radarr"] = radarr_svc.sync_library(db, lib)
    else:
        sonarr_host, sonarr_key = _lib_sonarr(db, lib)
        if sonarr_host:
            from ..services import sonarr as sonarr_svc
            try:
                raw = sonarr_svc.fetch_all_series(sonarr_host, sonarr_key)
                synced = sonarr_svc.upsert_series_list(
                    db, raw,
                    library_id=lib.id,
                    skip_translation=not lib.translation_enabled,
                    skip_anilist=not lib.anilist_enabled,
                )
                results["sonarr"] = synced
            except Exception as exc:
                results["sonarr"] = {"error": str(exc)}

    return results


# ── movies list ───────────────────────────────────────────────────────────────

@router.get("/{lib_id}/movies")
def list_movies(lib_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    import json as _json
    lib = db.query(Library).filter(Library.id == lib_id).first()
    if not lib:
        raise HTTPException(404, "Library not found")
    movies = db.query(Movie).filter(Movie.library_id == lib_id).order_by(Movie.sort_title).all()
    return [
        {
            "id": m.id,
            "radarr_id": m.radarr_id,
            "title": m.title,
            "original_title": m.original_title,
            "year": m.year,
            "status": m.status,
            "monitored": m.monitored,
            "has_file": m.has_file,
            "poster_url": m.poster_url,
            "backdrop_url": m.backdrop_url,
            "rating_value": m.rating_value,
            "genres": _json.loads(m.genres) if m.genres else [],
            "runtime": m.runtime,
            "watch_status": m.watch_status,
            "watched": m.watched,
            "in_cinemas": m.in_cinemas,
            "digital_release": m.digital_release,
            "quality_name": m.quality_name,
            "file_size": m.file_size,
        }
        for m in movies
    ]
