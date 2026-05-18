"""
overseerr.py – Overseerr / Jellyseerr integration.

Endpoints:
  GET  /api/overseerr/status              → test connection + server info
  GET  /api/overseerr/requests            → list media requests
  POST /api/overseerr/request/{series_id} → request all seasons of a series
  DELETE /api/overseerr/request/{req_id}  → cancel a request
  GET  /api/overseerr/issues              → all open issues
  GET  /api/overseerr/issues/series/{id}  → subtitle issues for one series
  POST /api/overseerr/report              → create issue + (optionally) demote
"""
from __future__ import annotations

import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import get_db
from ..deps import get_current_user
from ..models.user import User

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/overseerr", tags=["overseerr"])

# Issue type constants (Overseerr API)
ISSUE_TYPE_SUBTITLES = 3

# Issue status constants
ISSUE_STATUS_OPEN     = 1
ISSUE_STATUS_RESOLVED = 2

ISSUE_TYPE_LABELS = {1: "Video", 2: "Audio", 3: "Titulky", 4: "Jiné"}
ISSUE_STATUS_LABELS = {1: "Otevřený", 2: "Vyřešený"}


# ── Settings helpers (DB override > .env) ─────────────────────────────────────

def _cfg(key: str, db: Session) -> str:
    """Read a setting: DB row first, then .env/config fallback."""
    try:
        from ..models.app_settings import AppSetting
        row = db.query(AppSetting).filter(AppSetting.key == key).first()
        if row and row.value:
            return row.value
    except Exception:
        pass
    return getattr(get_settings(), key, "") or ""


def _get_overseerr_cfg(db: Session) -> tuple[str, str]:
    """Return (base_api_url, api_key) or raise 503."""
    host    = _cfg("overseerr_host",    db)
    api_key = _cfg("overseerr_api_key", db)
    if not host or not api_key:
        raise HTTPException(503, "Overseerr není nakonfigurován — nastav OVERSEERR_HOST a OVERSEERR_API_KEY v Nastavení")
    host = host.rstrip("/")
    if not host.startswith("http"):
        host = f"http://{host}"
    return f"{host}/api/v1", api_key


# ── HTTP helpers ──────────────────────────────────────────────────────────────

def _get(path: str, db: Session, params: dict | None = None) -> dict:
    base_url, api_key = _get_overseerr_cfg(db)
    try:
        r = httpx.get(f"{base_url}{path}", headers={"X-Api-Key": api_key}, params=params, timeout=10)
        r.raise_for_status()
        return r.json()
    except HTTPException:
        raise
    except httpx.HTTPStatusError as e:
        raise HTTPException(e.response.status_code, f"Overseerr: {e.response.text[:200]}")
    except Exception as e:
        raise HTTPException(502, f"Overseerr nedostupný: {e}")


def _post(path: str, body: dict, db: Session) -> dict:
    base_url, api_key = _get_overseerr_cfg(db)
    try:
        r = httpx.post(f"{base_url}{path}", headers={"X-Api-Key": api_key}, json=body, timeout=10)
        r.raise_for_status()
        return r.json()
    except HTTPException:
        raise
    except httpx.HTTPStatusError as e:
        raise HTTPException(e.response.status_code, f"Overseerr: {e.response.text[:200]}")
    except Exception as e:
        raise HTTPException(502, f"Overseerr nedostupný: {e}")


def _delete(path: str, db: Session) -> None:
    base_url, api_key = _get_overseerr_cfg(db)
    try:
        r = httpx.delete(f"{base_url}{path}", headers={"X-Api-Key": api_key}, timeout=10)
        r.raise_for_status()
    except HTTPException:
        raise
    except httpx.HTTPStatusError as e:
        raise HTTPException(e.response.status_code, f"Overseerr: {e.response.text[:200]}")
    except Exception as e:
        raise HTTPException(502, f"Overseerr nedostupný: {e}")


def _normalize_issue(issue: dict) -> dict:
    """Flatten an Overseerr issue to a compact dict."""
    media = issue.get("media") or {}
    return {
        "id":           issue.get("id"),
        "type":         issue.get("issueType"),
        "type_label":   ISSUE_TYPE_LABELS.get(issue.get("issueType"), "?"),
        "status":       issue.get("status"),
        "status_label": ISSUE_STATUS_LABELS.get(issue.get("status"), "?"),
        "message":      (issue.get("comments") or [{}])[0].get("message", "") if issue.get("comments") else "",
        "created_at":   issue.get("createdAt"),
        "updated_at":   issue.get("updatedAt"),
        "media_type":   media.get("mediaType"),
        "tvdb_id":      media.get("tvdbId"),
        "tmdb_id":      media.get("tmdbId"),
        "reported_by":  (issue.get("createdBy") or {}).get("displayName", ""),
        "overseerr_url": None,  # filled below
    }


def _issue_url(issue_id: int | None, db: Session) -> str | None:
    if not issue_id:
        return None
    try:
        host = _cfg("overseerr_host", db)
        if not host:
            return None
        host = host.rstrip("/")
        if not host.startswith("http"):
            host = f"http://{host}"
        return f"{host}/issues/{issue_id}"
    except Exception:
        return None


def _normalize_issue_with_url(issue: dict, db: Session) -> dict:
    d = _normalize_issue(issue)
    d["overseerr_url"] = _issue_url(issue.get("id"), db)
    return d


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/status")
def overseerr_status(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Test connection and return server info. Returns {connected: false} if not configured."""
    host    = _cfg("overseerr_host",    db)
    api_key = _cfg("overseerr_api_key", db)
    if not host or not api_key:
        return {"connected": False, "reason": "not_configured"}
    try:
        data = _get("/status", db)
        return {"connected": True, **data}
    except HTTPException as e:
        return {"connected": False, "reason": e.detail}


@router.get("/requests")
def overseerr_requests(
    filter: str = "all",
    take: int = 50,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """List media requests from Overseerr, enriched with local DB titles."""
    data = _get("/request", db, params={"take": take, "filter": filter, "sort": "modified"})

    from ..models.series import Series
    results = data.get("results") or []
    if not results:
        return data

    # Pass 1: fill titles from our local DB (fast, no extra HTTP)
    tvdb_map: dict[int, Series] = {}
    for s in db.query(Series).all():
        if s.tvdb_id:
            tvdb_map[int(s.tvdb_id)] = s

    still_missing: list[dict] = []   # media dicts that still have no title
    for req in results:
        media = req.get("media") or {}
        if media.get("title"):
            continue
        tvdb_id = media.get("tvdbId")
        if tvdb_id and int(tvdb_id) in tvdb_map:
            s = tvdb_map[int(tvdb_id)]
            media["title"] = s.title_romaji or s.title
        else:
            still_missing.append(media)

    # Pass 2: for requests not in our DB, ask Overseerr's own TV detail endpoint
    # Uses tmdbId — Overseerr always stores it.  Best-effort; don't crash on error.
    if still_missing:
        base_url, api_key = _get_overseerr_cfg(db)
        headers = {"X-Api-Key": api_key}
        for media in still_missing:
            tmdb_id = media.get("tmdbId")
            if not tmdb_id:
                continue
            try:
                r = httpx.get(
                    f"{base_url}/tv/{tmdb_id}",
                    headers=headers,
                    timeout=5,
                )
                if r.status_code == 200:
                    tv = r.json()
                    media["title"] = tv.get("name") or tv.get("originalName") or tv.get("title")
                    if not media.get("posterPath") and tv.get("posterPath"):
                        media["posterPath"] = tv["posterPath"]
            except Exception:
                pass  # best-effort — show TVDB fallback in UI rather than crashing

    return data


@router.post("/request/{series_id}", status_code=201)
def request_series(
    series_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Create an Overseerr request for all seasons of a series."""
    from ..models.series import Series
    s = db.query(Series).filter(Series.id == series_id).first()
    if not s:
        raise HTTPException(404, "Seriál nenalezen")
    if not s.tvdb_id:
        raise HTTPException(400, "Seriál nemá TVDB ID — spusť Sonarr sync")

    result = _post("/request", {
        "mediaType": "tv",
        "mediaId": s.tvdb_id,
        "seasons": "all",
    }, db)
    return result


@router.delete("/request/{request_id}", status_code=204)
def cancel_request(
    request_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Cancel / delete an Overseerr request."""
    _delete(f"/request/{request_id}", db)


@router.get("/issues")
def overseerr_issues(
    issue_type: int | None = None,
    status: int | None = None,
    take: int = 100,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """List issues from Overseerr, optionally filtered by type and status."""
    params: dict = {"take": take, "sort": "modified"}
    if issue_type is not None:
        params["issueType"] = issue_type
    data = _get("/issue", db, params=params)
    results = data.get("results") or []
    if status is not None:
        results = [i for i in results if i.get("status") == status]
    return {
        "results":      [_normalize_issue_with_url(i, db) for i in results],
        "totalResults": len(results),
    }


@router.get("/issues/series/{series_id}")
def series_issues(
    series_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """
    Get Overseerr issues for a specific series, matched by TVDB ID.
    Returns both open subtitle issues and all other open issues.
    """
    from ..models.series import Series
    s = db.query(Series).filter(Series.id == series_id).first()
    if not s:
        raise HTTPException(404, "Seriál nenalezen")
    if not s.tvdb_id:
        return {"subtitle_issues": [], "other_issues": [], "tvdb_id": None}

    try:
        data = _get("/issue", db, params={"take": 100, "sort": "modified"})
    except HTTPException as e:
        if e.status_code == 503:
            return {"subtitle_issues": [], "other_issues": [], "tvdb_id": s.tvdb_id, "overseerr_configured": False}
        raise

    all_issues = data.get("results") or []
    tvdb_id    = int(s.tvdb_id)

    # Match by tvdbId in media object
    matched = [
        i for i in all_issues
        if (i.get("media") or {}).get("tvdbId") == tvdb_id
    ]

    subtitle_issues = [_normalize_issue_with_url(i, db) for i in matched if i.get("issueType") == ISSUE_TYPE_SUBTITLES]
    other_issues    = [_normalize_issue_with_url(i, db) for i in matched if i.get("issueType") != ISSUE_TYPE_SUBTITLES]

    # Also check if a request already exists for this series
    try:
        req_data = _get("/request", db, params={"take": 100, "filter": "all"})
        existing = [
            r for r in (req_data.get("results") or [])
            if (r.get("media") or {}).get("tvdbId") == tvdb_id
        ]
    except Exception:
        existing = []

    return {
        "subtitle_issues":    subtitle_issues,
        "other_issues":       other_issues,
        "existing_requests":  existing,
        "tvdb_id":            tvdb_id,
        "overseerr_configured": True,
    }


# ── Report issue ──────────────────────────────────────────────────────────────

class ReportIssueBody(BaseModel):
    tvdb_id:     int | None = None   # TVDB ID (from Emby via userscript)
    series_id:   int | None = None   # Anisubarr internal ID (optional shortcut)
    issue_type:  int        = 4      # 1=video, 2=audio, 3=subtitles, 4=other
    message:     str        = ""
    season:      int | None = None   # None → whole-series report → demote
    episode:     int | None = None
    demote:      bool | None= None   # None → auto (demote if no episode specified)


def _find_overseerr_media_id(tvdb_id: int, db: Session) -> int | None:
    """
    Find Overseerr's internal media ID for a TV show by TVDB ID.
    Paginates through /media until found.  Returns None if not found.
    """
    base_url, api_key = _get_overseerr_cfg(db)
    headers = {"X-Api-Key": api_key}
    skip, take = 0, 100
    while True:
        try:
            r = httpx.get(
                f"{base_url}/media",
                headers=headers,
                params={"take": take, "skip": skip, "mediaType": "tv"},
                timeout=10,
            )
            r.raise_for_status()
            data = r.json()
        except Exception as exc:
            log.warning("Overseerr /media lookup error: %s", exc)
            return None
        results = data.get("results") or []
        for m in results:
            if m.get("tvdbId") == tvdb_id:
                return m.get("id")
        if len(results) < take:
            break
        skip += take
    return None


@router.post("/report")
def report_issue(
    body: ReportIssueBody,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """
    Create an issue in Overseerr for a series/episode and (optionally) demote it
    in Anisubarr.

    Scope rules:
    - No season/episode specified → whole-series issue → demote=True (unless overridden)
    - Season/episode specified    → episode issue     → demote=False (unless overridden)

    Accepts either tvdb_id (from Emby userscript) or series_id (Anisubarr).
    """
    from ..models.series import Series
    from ..services import promotion as promo_svc
    from ..database import SessionLocal

    # ── Resolve series ────────────────────────────────────────────────────────
    series_obj: Series | None = None

    if body.series_id:
        series_obj = db.query(Series).filter(Series.id == body.series_id).first()

    if series_obj is None and body.tvdb_id:
        series_obj = db.query(Series).filter(Series.tvdb_id == body.tvdb_id).first()

    if series_obj is None:
        raise HTTPException(404, "Série nenalezena — zkontroluj tvdb_id nebo series_id")

    tvdb_id = body.tvdb_id or (int(series_obj.tvdb_id) if series_obj.tvdb_id else None)
    if not tvdb_id:
        raise HTTPException(400, "Série nemá TVDB ID — spusť Sonarr sync")

    # ── Find Overseerr media ID ───────────────────────────────────────────────
    overseerr_media_id = _find_overseerr_media_id(tvdb_id, db)
    if overseerr_media_id is None:
        raise HTTPException(404, f"Série s TVDB ID {tvdb_id} nenalezena v Overseerru — možná není přidána jako požadavek")

    # ── Create Overseerr issue ────────────────────────────────────────────────
    issue_body: dict = {
        "issueType": body.issue_type,
        "message":   body.message or "Nahlášeno přes Anisubarr",
        "mediaType": "tv",
        "mediaId":   overseerr_media_id,
    }
    if body.season is not None:
        issue_body["problemSeason"] = body.season
    if body.episode is not None:
        issue_body["problemEpisode"] = body.episode

    try:
        created_issue = _post("/issue", issue_body, db)
    except HTTPException as exc:
        raise HTTPException(exc.status_code, f"Overseerr issue se nepodařilo vytvořit: {exc.detail}")

    issue_id  = created_issue.get("id")
    issue_url = _issue_url(issue_id, db)

    # ── Demote in Anisubarr ───────────────────────────────────────────────────
    whole_series = body.season is None and body.episode is None
    should_demote = body.demote if body.demote is not None else whole_series

    demote_result: dict | None = None
    if should_demote:
        # Mark has_issue in DB
        series_obj.has_issue = True
        series_obj.promoted  = False
        db.commit()

        # Move files back to incomplete (long-running → background thread)
        import threading
        def _bg():
            _db = SessionLocal()
            try:
                s = _db.query(Series).filter(Series.id == series_obj.id).first()
                if s:
                    promo_svc.force_demote(_db, s)
            finally:
                _db.close()
        threading.Thread(target=_bg, daemon=True).start()

        demote_result = {"status": "started", "series_id": series_obj.id}
        log.info("Report: degradace zahájena pro '%s' (id=%d)", series_obj.title, series_obj.id)
    else:
        # Episode-level: just flag in DB without moving files
        series_obj.has_issue = True
        db.commit()
        log.info("Report: has_issue nastaven pro '%s' (id=%d), bez přesunu", series_obj.title, series_obj.id)

    # ── Discord notification ──────────────────────────────────────────────────
    try:
        from ..services import discord as discord_svc
        discord_svc.notify_issue_flagged(
            title=series_obj.title,
            series_id=series_obj.id,
            poster_url=getattr(series_obj, "poster_url", None),
            overseerr_url=issue_url,
            db=db,
        )
    except Exception:
        pass

    return {
        "status":       "reported",
        "issue_id":     issue_id,
        "issue_url":    issue_url,
        "series_id":    series_obj.id,
        "title":        series_obj.title,
        "demoted":      should_demote,
        "demote_result": demote_result,
    }
