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

    # ── recently added ────────────────────────────────────────────────────
    recent_rows = (
        db.query(Series)
        .order_by(Series.created_at.desc())
        .limit(5)
        .all()
    )
    recently_added = [
        {
            "id": s.id,
            "title": s.title_romaji or s.title,
            "title_english": s.title_english,
            "added_at": s.sonarr_added or (s.created_at.isoformat() if s.created_at else None),
            "promoted": s.promoted,
            "poster_url": s.cover_url or s.poster_url,
        }
        for s in recent_rows
    ]

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

    return {
        "hero": hero,
        "recently_added": recently_added,
        "service_health": service_health,
        "pending_requests": pending_requests,
        "stats": {
            "total_series": total_series,
            "promoted": promoted_count,
            "missing_cs": missing_cs,
        },
    }


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
