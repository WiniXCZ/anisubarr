"""dashboard.py – Unified Dashboard endpoints."""
from __future__ import annotations

import random
from datetime import date, timedelta
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user
from ..models.series import Episode, Series
from ..models.movie import Movie
from ..models.library import Library
from ..models.seerr_cache import SeerrRequestCache
from ..models.user import User
from ..utils.settings_helper import read_setting

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


# ── helpers ──────────────────────────────────────────────────────────────────

def _service_health(url: str, path: str = "/api/health", timeout: float = 2.0) -> bool:
    """Return True if the service responds with HTTP 2xx."""
    if not url:
        return False
    base = url.rstrip("/")
    if not base.startswith("http"):
        base = f"http://{base}"
    try:
        r = httpx.get(f"{base}{path}", timeout=timeout, follow_redirects=True)
        return r.status_code < 400
    except Exception:
        return False


def _sonarr_url(db: Session) -> str:
    host = read_setting("sonarr_host", db) or ""
    if host and not host.startswith("http"):
        host = f"http://{host}"
    return host


def _emby_url(db: Session) -> str:
    return (
        read_setting("emby_external_url", db)
        or read_setting("emby_host", db)
        or ""
    )


def _seerr_url(db: Session) -> str:
    return (
        read_setting("seerr_external_url", db)
        or read_setting("seerr_host", db)
        or ""
    )


# ── endpoints ─────────────────────────────────────────────────────────────────

@router.get("/summary")
def get_dashboard_summary(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    # ── hero ──────────────────────────────────────────────────────────────
    promoted_series = db.query(Series).filter(Series.promoted == True).all()  # noqa: E712
    hero = None
    if promoted_series:
        s = random.choice(promoted_series)
        ep_mon = s.cached_ep_monitored or 0
        cs_sub = s.cached_cs_sub_count or 0
        cs_pct = round(cs_sub / ep_mon * 100) if ep_mon > 0 else 0
        hero = {
            "id": s.id,
            "title": s.title_romaji or s.title,
            "title_english": s.title_english,
            "poster_url": s.cover_url or s.poster_url,
            "overview_cs": s.overview_cs or s.overview,
            "promoted": True,
            "episode_count": s.episode_count or s.cached_ep_monitored or 0,
            "cs_pct": cs_pct,
        }

    # ── recently added (series + movies merged) ───────────────────────────
    recent_series = (
        db.query(Series)
        .order_by(Series.created_at.desc())
        .limit(8)
        .all()
    )
    recent_movies = (
        db.query(Movie)
        .order_by(Movie.created_at.desc())
        .limit(8)
        .all()
    )
    recently_added_raw = (
        [{"type": "series", "ts": s.created_at, "obj": s} for s in recent_series]
        + [{"type": "movie", "ts": m.created_at, "obj": m} for m in recent_movies]
    )

    def _sort_ts(dt) -> float:
        # created_at may be None (rows predating the column) or a mix of naive
        # (SQLite) and tz-aware datetimes — both break a direct comparison. Map
        # everything to a single comparable epoch float so the sort never raises.
        if dt is None:
            return 0.0
        try:
            return dt.timestamp()
        except (TypeError, ValueError, OSError):
            return 0.0

    recently_added_raw.sort(key=lambda x: _sort_ts(x["ts"]), reverse=True)
    recently_added = []
    for item in recently_added_raw[:10]:
        if item["type"] == "series":
            s = item["obj"]
            recently_added.append({
                "type": "series",
                "id": s.id,
                "title": s.title_romaji or s.title,
                "title_english": s.title_english,
                "added_at": s.sonarr_added or (s.created_at.isoformat() if s.created_at else None),
                "promoted": s.promoted,
                "poster_url": s.cover_url or s.poster_url,
            })
        else:
            m = item["obj"]
            recently_added.append({
                "type": "movie",
                "id": m.id,
                "title": m.title,
                "title_english": m.original_title,
                "added_at": m.radarr_added or (m.created_at.isoformat() if m.created_at else None),
                "promoted": False,
                "poster_url": m.poster_url,
            })

    # ── service health ────────────────────────────────────────────────────
    sonarr_url = _sonarr_url(db)
    emby_url = _emby_url(db)
    seerr_url = _seerr_url(db)

    sonarr_ok = _service_health(sonarr_url, "/ping")
    emby_ok = _service_health(emby_url, "/System/Ping")
    seerr_ok = _service_health(seerr_url, "/api/v1/status")

    service_health = {
        "sonarr": {"ok": sonarr_ok, "url": sonarr_url},
        "emby":   {"ok": emby_ok,   "url": emby_url},
        "seerr":  {"ok": seerr_ok,  "url": seerr_url},
    }

    # ── pending requests ──────────────────────────────────────────────────
    pending_requests: list[dict] = []
    try:
        reqs = (
            db.query(SeerrRequestCache)
            .order_by(SeerrRequestCache.created_at.desc())
            .limit(5)
            .all()
        )
        _STATUS_LABELS = {1: "Čeká", 2: "Schváleno", 3: "Odmítnuto", 4: "Dostupné", 5: "Zpracovává se"}
        pending_requests = [
            {
                "title": r.media_title,
                "poster_url": (
                    f"https://image.tmdb.org/t/p/w185{r.poster_path}"
                    if r.poster_path else None
                ),
                "requested_at": r.created_at.isoformat() if r.created_at else None,
                "status": _STATUS_LABELS.get(r.status, str(r.status)),
            }
            for r in reqs
        ]
    except Exception:
        pass

    # ── stats ─────────────────────────────────────────────────────────────
    total_series = db.query(Series).count()
    promoted_count = db.query(Series).filter(Series.promoted == True).count()  # noqa: E712
    # missing CS: has monitored episodes but cs_sub_count < ep_monitored
    missing_cs = (
        db.query(Series)
        .filter(
            Series.cached_ep_monitored > 0,
            Series.cached_cs_sub_count < Series.cached_ep_monitored,
        )
        .count()
    )

    total_movies = db.query(Movie).count()

    return {
        "hero": hero,
        "recently_added": recently_added,
        "service_health": service_health,
        "pending_requests": pending_requests,
        "stats": {
            "total_series": total_series,
            "total_movies": total_movies,
            "promoted": promoted_count,
            "missing_cs": missing_cs,
        },
    }


@router.get("/indexers")
async def get_indexer_status(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Return live status of all configured indexers and download clients across libraries."""
    libs = db.query(Library).filter(Library.enabled == True).all()  # noqa: E712
    results = []

    async def _check(name: str, url: str, path: str, api_key: str = "",
                     lib_name: str = "", service_type: str = "indexer"):
        if not url:
            return
        base = url.rstrip("/")
        if not base.startswith("http"):
            base = f"http://{base}"
        headers = {"X-Api-Key": api_key} if api_key else {}
        try:
            async with httpx.AsyncClient(timeout=4.0) as client:
                r = await client.get(f"{base}{path}", headers=headers, follow_redirects=True)
            ok = r.status_code < 400
            results.append({
                "name": name,
                "library": lib_name,
                "type": service_type,
                "url": base,
                "ok": ok,
                "status_code": r.status_code,
            })
        except Exception as exc:
            results.append({
                "name": name,
                "library": lib_name,
                "type": service_type,
                "url": base,
                "ok": False,
                "error": str(exc)[:80],
            })

    import asyncio
    tasks = []
    seen_hosts: set[str] = set()

    for lib in libs:
        if lib.indexer_host and lib.indexer_host not in seen_hosts:
            seen_hosts.add(lib.indexer_host)
            itype = lib.indexer_type or "prowlarr"
            path = "/api/v1/system/status" if itype == "prowlarr" else "/api/system/status"
            tasks.append(_check(itype.capitalize(), lib.indexer_host, path,
                                lib.indexer_api_key or "", lib.name, "indexer"))
        if lib.torrent_host and lib.torrent_host not in seen_hosts:
            seen_hosts.add(lib.torrent_host)
            tasks.append(_check("qBittorrent", lib.torrent_host, "/api/v2/app/version",
                                "", lib.name, "torrent"))

    await asyncio.gather(*tasks)
    return results


@router.get("/upcoming")
def get_dashboard_upcoming(
    days: int = Query(default=7, ge=1, le=30),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Return episodes airing in the next N days from the local DB."""
    from sqlalchemy.orm import joinedload

    today = date.today()
    end = today + timedelta(days=days)
    start_str = today.isoformat()
    end_str = end.isoformat()

    try:
        rows = (
            db.query(Episode)
            .join(Series)
            .options(joinedload(Episode.series))
            .filter(
                Episode.air_date >= start_str,
                Episode.air_date <= end_str,
                Episode.season_number > 0,
                Episode.monitored == True,  # noqa: E712
            )
            .order_by(Episode.air_date, Episode.episode_number)
            .limit(30)
            .all()
        )
        return [
            {
                "series_title": ep.series.title_romaji or ep.series.title,
                "season": ep.season_number,
                "episode": ep.episode_number,
                "air_date": ep.air_date,
                "series_id_local": ep.series_id,
                "has_file": ep.has_file,
            }
            for ep in rows
        ]
    except Exception:
        return []
