"""
seerr.py – Seerr integration (formerly Overseerr / Jellyseerr).

Endpoints:
  GET  /api/seerr/status              → test connection + server info
  GET  /api/seerr/requests            → list media requests
  POST /api/seerr/request/{series_id} → request all seasons of a series
  DELETE /api/seerr/request/{req_id}  → cancel a request
  GET  /api/seerr/issues              → all open issues
  GET  /api/seerr/issues/series/{id}  → subtitle issues for one series
  POST /api/seerr/report              → create issue + (optionally) demote
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

log = logging.getLogger("anisubarr.seerr")

router = APIRouter(prefix="/api/seerr", tags=["seerr"])

# Issue type constants (Seerr API)
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


def _get_seerr_cfg(db: Session) -> tuple[str, str]:
    """Return (base_api_url, api_key) or raise 503."""
    host    = _cfg("seerr_host",    db)
    api_key = _cfg("seerr_api_key", db)
    if not host or not api_key:
        raise HTTPException(503, "Seerr není nakonfigurován — nastav SEERR_HOST a SEERR_API_KEY v Nastavení")
    host = host.rstrip("/")
    if not host.startswith("http"):
        host = f"http://{host}"
    return f"{host}/api/v1", api_key


# ── HTTP helpers ──────────────────────────────────────────────────────────────

def _get(path: str, db: Session, params: dict | None = None) -> dict:
    base_url, api_key = _get_seerr_cfg(db)
    try:
        r = httpx.get(f"{base_url}{path}", headers={"X-Api-Key": api_key}, params=params, timeout=10)
        r.raise_for_status()
        return r.json()
    except HTTPException:
        raise
    except httpx.HTTPStatusError as e:
        raise HTTPException(e.response.status_code, f"Seerr: {e.response.text[:200]}")
    except Exception as e:
        raise HTTPException(502, f"Seerr nedostupný: {e}")


def _post(path: str, body: dict, db: Session) -> dict:
    base_url, api_key = _get_seerr_cfg(db)
    try:
        r = httpx.post(f"{base_url}{path}", headers={"X-Api-Key": api_key}, json=body, timeout=10)
        r.raise_for_status()
        return r.json()
    except HTTPException:
        raise
    except httpx.HTTPStatusError as e:
        raise HTTPException(e.response.status_code, f"Seerr: {e.response.text[:200]}")
    except Exception as e:
        raise HTTPException(502, f"Seerr nedostupný: {e}")


def _delete(path: str, db: Session) -> None:
    base_url, api_key = _get_seerr_cfg(db)
    try:
        r = httpx.delete(f"{base_url}{path}", headers={"X-Api-Key": api_key}, timeout=10)
        r.raise_for_status()
    except HTTPException:
        raise
    except httpx.HTTPStatusError as e:
        raise HTTPException(e.response.status_code, f"Seerr: {e.response.text[:200]}")
    except Exception as e:
        raise HTTPException(502, f"Seerr nedostupný: {e}")


def _normalize_issue(issue: dict) -> dict:
    """Flatten a Seerr issue to a compact dict."""
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
        "seerr_url": None,  # filled below
    }


def _issue_url(issue_id: int | None, db: Session) -> str | None:
    if not issue_id:
        return None
    try:
        host = _cfg("seerr_host", db)
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
    d["seerr_url"] = _issue_url(issue.get("id"), db)
    return d


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/status")
def seerr_status(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Test connection and return server info. Returns {connected: false} if not configured."""
    host    = _cfg("seerr_host",    db)
    api_key = _cfg("seerr_api_key", db)
    if not host or not api_key:
        return {"connected": False, "reason": "not_configured"}
    try:
        data = _get("/status", db)
        return {"connected": True, **data}
    except HTTPException as e:
        return {"connected": False, "reason": e.detail}


@router.get("/requests")
def seerr_requests(
    filter: str = "all",
    take: int = 50,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """List media requests. Reads from DB cache (up to 15 min old); falls back to live Seerr API."""
    import json
    from datetime import datetime, timezone, timedelta

    data: dict | None = None
    from_cache = False

    # ── Try cache first ───────────────────────────────────────────────────────
    try:
        from ..models.seerr_cache import SeerrRequestCache
        cache_rows = db.query(SeerrRequestCache).all()
        if cache_rows:
            newest = max((r.synced_at for r in cache_rows if r.synced_at), default=None)
            if newest:
                if newest.tzinfo is None:
                    newest = newest.replace(tzinfo=timezone.utc)
                if datetime.now(timezone.utc) - newest < timedelta(minutes=15):
                    results_raw = []
                    for r in cache_rows:
                        item = json.loads(r.raw_json)
                        media = item.get("media") or {}
                        # Inject stored title/poster from DB if media object lacks them
                        if r.media_title and not media.get("title") and not media.get("name"):
                            media["title"] = r.media_title
                        if r.poster_path and not media.get("posterPath"):
                            media["posterPath"] = r.poster_path
                        item["media"] = media
                        results_raw.append(item)
                    data = {"results": results_raw, "totalResults": len(results_raw)}
                    from_cache = True
                    log.debug("seerr_requests: serving %d requests from cache", len(results_raw))
    except Exception as e:
        log.warning("seerr_requests: cache read failed: %s", e)

    if data is None:
        data = _get("/request", db, params={"take": take, "filter": filter, "sort": "modified"})

    # ── Enrichment ────────────────────────────────────────────────────────────
    from ..models.series import Series
    results = data.get("results") or []
    if not results:
        return data

    # Pass 1: fill/override titles from our local DB (always prefer EN title from DB)
    tvdb_map: dict[int, Series] = {}
    for s in db.query(Series).all():
        if s.tvdb_id:
            tvdb_map[int(s.tvdb_id)] = s

    still_missing: list[dict] = []
    for req in results:
        media = req.get("media") or {}
        tvdb_id = media.get("tvdbId")
        if tvdb_id and int(tvdb_id) in tvdb_map:
            s = tvdb_map[int(tvdb_id)]
            en = s.title_english or s.title or s.title_romaji
            if en:
                media["title"] = en
        else:
            still_missing.append(media)

    # Pass 2: for requests not in our DB, ask Seerr's own TV detail endpoint.
    # Skip when serving from cache — enrichment already happened at sync time.
    # Also skip series whose title already looks Latin (no point looking up).
    def _needs_lookup(media: dict) -> bool:
        title = (media.get("title") or "").strip()
        if not title:
            return True
        return any(ord(c) >= 0x3000 for c in title if not c.isspace())

    if still_missing and not from_cache:
        to_lookup = [m for m in still_missing if _needs_lookup(m) and m.get("tmdbId")][:20]
        if to_lookup:
            try:
                base_url, api_key = _get_seerr_cfg(db)
                headers = {"X-Api-Key": api_key}

                def _is_latin(s: str) -> bool:
                    return bool(s) and all(ord(c) < 0x3000 for c in s if not c.isspace())

                def _fetch_one(media: dict):
                    tmdb_id = media.get("tmdbId")
                    try:
                        r = httpx.get(
                            f"{base_url}/tv/{tmdb_id}",
                            headers=headers,
                            params={"language": "en"},
                            timeout=3,
                        )
                        if r.status_code == 200:
                            tv = r.json()
                            name = tv.get("name") or ""
                            orig = tv.get("originalName") or tv.get("originalTitle") or ""
                            media["title"] = (
                                name if _is_latin(name)
                                else orig if _is_latin(orig)
                                else name or orig
                            )
                            if not media.get("posterPath") and tv.get("posterPath"):
                                media["posterPath"] = tv["posterPath"]
                    except Exception:
                        pass

                # Paralelní volání místo sériových — max 10 concurrent vláken
                from concurrent.futures import ThreadPoolExecutor, as_completed
                with ThreadPoolExecutor(max_workers=min(len(to_lookup), 10)) as pool:
                    futs = [pool.submit(_fetch_one, m) for m in to_lookup]
                    for f in as_completed(futs):
                        pass  # výsledky jsou zapsány do media dict in-place
            except Exception:
                pass

        # Write-through cache: po live enrichmentu ulož výsledky do DB cache
        # aby příští request byl okamžitě servován z cache
        try:
            import json as _json
            from datetime import datetime, timezone as _tz
            from ..models.seerr_cache import SeerrRequestCache
            now = datetime.now(_tz.utc)
            for req in results:
                media = req.get("media") or {}
                seerr_id = req.get("id")
                if not seerr_id:
                    continue
                media_title = (media.get("title") or media.get("name")
                               or media.get("originalName") or "")
                poster_path = media.get("posterPath") or ""
                requester = (req.get("requestedBy") or {}).get("displayName", "")
                raw = _json.dumps(req)
                existing = db.query(SeerrRequestCache).filter(
                    SeerrRequestCache.seerr_id == seerr_id
                ).first()
                if existing:
                    existing.media_title = media_title
                    existing.poster_path = poster_path
                    existing.status      = req.get("status")
                    existing.requested_by = requester
                    existing.updated_at  = now
                    existing.raw_json    = raw
                    existing.synced_at   = now
                else:
                    db.add(SeerrRequestCache(
                        seerr_id     = seerr_id,
                        media_title  = media_title,
                        media_type   = media.get("mediaType", ""),
                        poster_path  = poster_path,
                        status       = req.get("status"),
                        requested_by = requester,
                        created_at   = now,
                        updated_at   = now,
                        raw_json     = raw,
                        synced_at    = now,
                    ))
            db.commit()
            log.debug("seerr_requests: write-through cache updated for %d requests", len(results))
        except Exception as e:
            log.warning("seerr_requests: write-through cache failed: %s", e)
            db.rollback()

    # ── Title fallback ────────────────────────────────────────────────────────
    # Seerr API may store the title in `name`, `originalName`, or `originalTitle`
    # depending on version. Guarantee `media["title"]` is always populated so
    # the frontend never shows "—" for a missing field.
    for req in results:
        media = req.get("media") or {}
        if not media.get("title"):
            media["title"] = (
                media.get("name")
                or media.get("originalName")
                or media.get("originalTitle")
                or "—"
            )
            req["media"] = media  # write back in case it was a new dict

    return data


@router.post("/sync")
def sync_seerr_cache(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Manually trigger Seerr cache synchronization."""
    try:
        from ..services.scheduler import trigger_now
        trigger_now("seerr_sync")
        return {"status": "ok", "message": "Cache synchronizována"}
    except Exception as e:
        raise HTTPException(500, f"Sync selhal: {e}")


@router.post("/request/{series_id}", status_code=201)
def request_series(
    series_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Create a Seerr request for all seasons of a series."""
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


@router.post("/request/{request_id}/approve")
def approve_request(
    request_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Approve a Seerr request."""
    return _post(f"/request/{request_id}/approve", {}, db)


@router.post("/request/{request_id}/decline")
def decline_request(
    request_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Decline a Seerr request."""
    return _post(f"/request/{request_id}/decline", {}, db)


@router.delete("/request/{request_id}", status_code=204)
def cancel_request(
    request_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Cancel / delete a Seerr request."""
    _delete(f"/request/{request_id}", db)


@router.get("/issues")
def seerr_issues(
    issue_type: int | None = None,
    status: int | None = None,
    take: int = 100,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """List issues from Seerr, optionally filtered by type and status."""
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
    Get Seerr issues for a specific series, matched by TVDB ID.
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
            return {"subtitle_issues": [], "other_issues": [], "tvdb_id": s.tvdb_id, "seerr_configured": False}
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
        "seerr_configured": True,
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


def _find_seerr_media_id(tvdb_id: int, db: Session) -> int | None:
    """
    Find Seerr's internal media ID for a TV show by TVDB ID.
    Paginates through /media until found.  Returns None if not found.
    """
    base_url, api_key = _get_seerr_cfg(db)
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
            log.warning("Seerr /media lookup error: %s", exc)
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
    Create an issue in Seerr for a series/episode and (optionally) demote it
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

    # ── Find Seerr media ID ───────────────────────────────────────────────────
    seerr_media_id = _find_seerr_media_id(tvdb_id, db)
    if seerr_media_id is None:
        raise HTTPException(404, f"Série s TVDB ID {tvdb_id} nenalezena v Seerr — možná není přidána jako požadavek")

    # ── Create Seerr issue ────────────────────────────────────────────────────
    issue_body: dict = {
        "issueType": body.issue_type,
        "message":   body.message or "Nahlášeno přes Anisubarr",
        "mediaType": "tv",
        "mediaId":   seerr_media_id,
    }
    if body.season is not None:
        issue_body["problemSeason"] = body.season
    if body.episode is not None:
        issue_body["problemEpisode"] = body.episode

    try:
        created_issue = _post("/issue", issue_body, db)
    except HTTPException as exc:
        raise HTTPException(exc.status_code, f"Seerr issue se nepodařilo vytvořit: {exc.detail}")

    issue_id  = created_issue.get("id")
    issue_url = _issue_url(issue_id, db)

    # ── Demote in Anisubarr ───────────────────────────────────────────────────
    whole_series = body.season is None and body.episode is None
    should_demote = body.demote if body.demote is not None else whole_series

    demote_result: dict | None = None
    if should_demote:
        series_obj.has_issue = True
        series_obj.promoted  = False
        db.commit()

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
            seerr_url=issue_url,
            db=db,
        )
    except Exception:
        pass

    return {
        "status":        "reported",
        "issue_id":      issue_id,
        "issue_url":     issue_url,
        "series_id":     series_obj.id,
        "title":         series_obj.title,
        "demoted":       should_demote,
        "demote_result": demote_result,
    }
