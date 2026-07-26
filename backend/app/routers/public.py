from __future__ import annotations

"""
public.py – Read-only, unauthenticated API for the public visitor site.

Served both from the main app (for local testing) and from the separate
public_main.py app that runs on its own port (see run.py). No admin/internal
data is exposed here: no API keys, no internal file paths, no user info.

Endpoints:
  GET  /api/public/upcoming    → tracked series not yet fully subtitled (in progress)
  GET  /api/public/requested   → open Seerr requests (from local cache)
  GET  /api/public/issues      → series currently flagged with a subtitle issue
  GET  /api/public/published   → fully subtitled / promoted series (the actual library)
  POST /api/public/subscribe   → { email } → subscribe to the newsletter
  GET  /api/public/unsubscribe → ?token=... → unsubscribe
"""

import json
import logging
import time
from collections import defaultdict
from threading import Lock

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from ..database import get_db

log = logging.getLogger("anisubarr.public")

router = APIRouter(prefix="/api/public", tags=["public"])

# ── Rate limiting for the unauthenticated subscribe endpoint ──────────────────
# This endpoint is reachable by anyone on the public port; without a limit it
# can be used to flood the subscribers table. Simple in-memory per-IP window.
_sub_rate_lock = Lock()
_sub_attempts: dict[str, list[float]] = defaultdict(list)
_SUB_RATE_WINDOW = 3600   # seconds
_SUB_RATE_LIMIT = 5       # subscribe calls per IP per window
_SUB_MAX_TRACKED_IPS = 10_000


def _client_ip(request: Request) -> str:
    return (
        request.headers.get("X-Real-IP")
        or request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
        or (request.client.host if request.client else "unknown")
    )


def _check_subscribe_rate(ip: str) -> None:
    now = time.monotonic()
    with _sub_rate_lock:
        recent = [t for t in _sub_attempts[ip] if now - t < _SUB_RATE_WINDOW]
        if len(recent) >= _SUB_RATE_LIMIT:
            _sub_attempts[ip] = recent
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Příliš mnoho pokusů o přihlášení k odběru. Zkuste to později.",
            )
        recent.append(now)
        _sub_attempts[ip] = recent
        if len(_sub_attempts) > _SUB_MAX_TRACKED_IPS:
            for k in [k for k, v in _sub_attempts.items() if not v]:
                del _sub_attempts[k]


def _display_title(s) -> str:
    return s.title_english or s.title_romaji or s.title or ""


def _genres(s) -> list[str]:
    try:
        return json.loads(s.genres) if s.genres else []
    except Exception:
        return []


def _series_card(s) -> dict:
    return {
        "id":          s.id,
        "title":       _display_title(s),
        "overview":    s.overview_cs or s.overview_anilist or s.overview or "",
        "poster_url":  s.cover_url or s.poster_url or None,
        "year":        s.year,
        "status":      s.status,
        "genres":      _genres(s),
        "episode_count":      s.episode_count,
        "episode_file_count": s.episode_file_count,
        "cs_sub_count":       s.cached_cs_sub_count,
        "percent_complete":   s.percent_complete,
        "average_score":      s.average_score,
    }


@router.get("/upcoming")
def public_upcoming(db: Session = Depends(get_db)):
    """Series being tracked but not yet promoted (i.e. still work in progress)."""
    from ..models.series import Series
    rows = (
        db.query(Series)
        .filter(Series.promoted == False, Series.has_issue == False)  # noqa: E712
        .order_by(Series.sonarr_added.desc().nullslast())
        .limit(100)
        .all()
    )
    return {"results": [_series_card(s) for s in rows]}


@router.get("/requested")
def public_requested(db: Session = Depends(get_db)):
    """Open media requests, from the local Seerr cache (no live Seerr call needed)."""
    from ..models.seerr_cache import SeerrRequestCache
    # status: Seerr request statuses — 1=pending, 2=approved, 3=declined, 4=failed
    rows = (
        db.query(SeerrRequestCache)
        .filter(SeerrRequestCache.status.in_([1, 2]))
        .order_by(SeerrRequestCache.updated_at.desc())
        .limit(100)
        .all()
    )
    results = []
    for r in rows:
        results.append({
            "id":          r.seerr_id,
            "title":       r.media_title or "—",
            "poster_url":  f"https://image.tmdb.org/t/p/w342{r.poster_path}" if r.poster_path else None,
            "status":      "Schváleno" if r.status == 2 else "Čeká na schválení",
            "requested_by": r.requested_by or None,
        })
    return {"results": results}


@router.get("/issues")
def public_issues(db: Session = Depends(get_db)):
    """Series currently flagged with an open subtitle issue."""
    from ..models.series import Series
    rows = (
        db.query(Series)
        .filter(Series.has_issue == True)  # noqa: E712
        .order_by(Series.updated_at.desc().nullslast())
        .limit(100)
        .all()
    )
    return {"results": [_series_card(s) for s in rows]}


def _norm_lang(code: str | None) -> str | None:
    """Normalize a subtitle language token to a short canonical code (cs/en/…)."""
    c = (code or "").strip().lower()
    if not c or c == "??":
        return None
    from ..utils import CS_NAMES
    if c in CS_NAMES:
        return "cs"
    from .subtitles import _LANG_ALIASES
    for canon, variants in _LANG_ALIASES.items():
        if c in variants:
            return canon
    return c[:3]


@router.get("/series/{series_id}")
def public_series_detail(series_id: int, db: Session = Depends(get_db)):
    """Public detail of one series: seasons, episodes, and which subtitle
    languages each episode has. Deliberately exposes no internal data —
    no file paths, no Sonarr/Emby ids, no user info."""
    from sqlalchemy.orm import subqueryload
    from ..models.series import Series, Episode

    s = (
        db.query(Series)
        .options(subqueryload(Series.episodes).subqueryload(Episode.subtitles))
        .filter(Series.id == series_id)
        .first()
    )
    if not s:
        raise HTTPException(404, "Série nenalezena")

    seasons: dict[int, list] = {}
    for ep in s.episodes:
        langs: set[str] = set()
        for sub in ep.subtitles:
            lang = _norm_lang(sub.detected_lang or sub.language)
            if lang:
                langs.add(lang)
        # Embedded tracks reported by Sonarr's mediaInfo (e.g. "cze / eng")
        for token in (ep.subtitles_in_file or "").replace("/", ",").split(","):
            lang = _norm_lang(token)
            if lang:
                langs.add(lang)
        seasons.setdefault(ep.season_number or 0, []).append({
            "episode":   ep.episode_number,
            "title":     ep.title,
            "air_date":  ep.air_date,
            "has_file":  bool(ep.has_file),
            "subtitles": sorted(langs),
        })

    out_seasons = [
        {"season": sn, "episodes": sorted(eps, key=lambda e: e["episode"] or 0)}
        for sn, eps in sorted(seasons.items())
    ]

    card = _series_card(s)
    card["seasons"] = out_seasons
    card["season_count"] = sum(1 for sn in seasons if sn > 0) or len(seasons)
    return card


@router.get("/published")
def public_published(db: Session = Depends(get_db)):
    """Fully subtitled series — the actual public library."""
    from ..models.series import Series
    rows = (
        db.query(Series)
        .filter(Series.promoted == True)  # noqa: E712
        .order_by(Series.promoted_at.desc().nullslast())
        .limit(300)
        .all()
    )
    return {"results": [_series_card(s) for s in rows]}


# ── Newsletter ────────────────────────────────────────────────────────────────

class SubscribeBody(BaseModel):
    email: EmailStr


@router.post("/subscribe", status_code=201)
def subscribe(body: SubscribeBody, request: Request, db: Session = Depends(get_db)):
    _check_subscribe_rate(_client_ip(request))
    from ..models.newsletter import NewsletterSubscriber
    email = str(body.email).strip().lower()
    existing = db.query(NewsletterSubscriber).filter(NewsletterSubscriber.email == email).first()
    if existing:
        if not existing.active:
            existing.active = True
            existing.unsubscribed_at = None
            db.commit()
        return {"status": "subscribed"}
    db.add(NewsletterSubscriber(email=email))
    db.commit()
    return {"status": "subscribed"}


@router.get("/unsubscribe")
def unsubscribe(token: str, db: Session = Depends(get_db)):
    from datetime import datetime, timezone
    from ..models.newsletter import NewsletterSubscriber
    row = db.query(NewsletterSubscriber).filter(NewsletterSubscriber.unsubscribe_token == token).first()
    if not row:
        raise HTTPException(404, "Neplatný odkaz pro odhlášení")
    row.active = False
    row.unsubscribed_at = datetime.now(timezone.utc)
    db.commit()
    return {"status": "unsubscribed"}
