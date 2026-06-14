"""
downloads.py – Download queue and recent downloads.

GET /api/downloads/queue   → active/queued downloads (from qBittorrent if configured)
GET /api/downloads/recent  → recently downloaded episodes (last 7 days)
GET /api/downloads/stats   → aggregate download stats
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user
from ..models.user import User
from ..utils.settings_helper import read_setting as _read_setting

log = logging.getLogger("anisubarr.downloads")

router = APIRouter(prefix="/api/downloads", tags=["downloads"])


def _human_size(b: Optional[int]) -> str:
    if not b:
        return ""
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if b < 1024:
            return f"{b:.1f} {unit}"
        b /= 1024
    return f"{b:.1f} PB"


def _qbit_queue(db) -> list[dict]:
    """Fetch active torrents from qBittorrent API."""
    try:
        import httpx
        host = _read_setting("qbittorrent_host", db) or "http://localhost:8080"
        user = _read_setting("qbittorrent_username", db) or "admin"
        pwd  = _read_setting("qbittorrent_password", db) or "adminadmin"

        session = httpx.Client(base_url=host, timeout=5)
        # Login
        login_resp = session.post("/api/v2/auth/login", data={"username": user, "password": pwd})
        if login_resp.text != "Ok.":
            return []
        # Get torrents
        torrents = session.get("/api/v2/torrents/info").json()
        result = []
        for t in torrents[:20]:
            state = t.get("state", "")
            if state in ("downloading", "stalledDL", "checkingDL", "queuedDL", "metaDL"):
                progress = round(t.get("progress", 0) * 100, 1)
                size = t.get("size", 0)
                downloaded = t.get("downloaded", 0)
                speed = t.get("dlspeed", 0)
                eta = t.get("eta", 0)

                if speed > 0 and eta < 999999:
                    eta_str = f"{eta // 60:02d}:{eta % 60:02d}"
                else:
                    eta_str = "—"

                result.append({
                    "hash":     t.get("hash", ""),
                    "name":     t.get("name", ""),
                    "size":     _human_size(size),
                    "speed":    f"{speed / 1_000_000:.1f} MB/s" if speed else "0 MB/s",
                    "eta":      eta_str,
                    "progress": progress,
                    "state":    "downloading" if state in ("downloading", "stalledDL", "metaDL") else "queued",
                    "client":   "qBittorrent",
                })
        return result
    except Exception as e:
        log.debug("qBittorrent not available: %s", e)
        return []


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/queue")
def get_queue(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    """Active downloads from qBittorrent. Returns empty list if qBittorrent is not configured."""
    return {"items": _qbit_queue(db)}


@router.get("/recent")
def get_recent(
    days: int = 7,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Episodes with files added in the last N days."""
    from ..models.series import Episode, Series
    from sqlalchemy.orm import joinedload

    cutoff = (datetime.utcnow() - timedelta(days=days)).isoformat()
    rows = (
        db.query(Episode)
        .options(joinedload(Episode.series))
        .filter(Episode.has_file == True, Episode.date_added >= cutoff)  # noqa: E712
        .order_by(Episode.date_added.desc())
        .limit(50)
        .all()
    )

    result = []
    for ep in rows:
        s = ep.series
        # Sub state
        sub_langs = [sub.language for sub in ep.subtitles if not sub.is_embedded]
        has_cs = any(l in ("cs", "cze", "ces", "cz") for l in sub_langs)
        has_jp = any(l in ("ja", "jpn") for l in sub_langs)
        subs_label = ("jp + cs" if has_cs and has_jp else
                      "cs" if has_cs else
                      "jp" if has_jp else
                      "—")
        result.append({
            "id":             ep.id,
            "file":           os.path.basename(ep.file_path) if ep.file_path else "",
            "series_id":      s.id if s else None,
            "series_title":   s.title if s else "",
            "season":         ep.season_number,
            "episode":        ep.episode_number,
            "size":           _human_size(ep.file_size),
            "date_added":     ep.date_added,
            "subs":           subs_label,
            "has_cs_sub":     has_cs,
        })
    return {"items": result}


@router.get("/stats")
def get_stats(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    from ..models.series import Episode, Series

    total_size = db.query(Series).all()
    disk_bytes = sum(s.size_on_disk or 0 for s in total_size)

    today = datetime.utcnow().date().isoformat()
    downloaded_today = (
        db.query(Episode)
        .filter(Episode.has_file == True, Episode.date_added >= today)  # noqa: E712
        .count()
    )

    queue = _qbit_queue(db)
    active  = sum(1 for q in queue if q["state"] == "downloading")
    queued  = sum(1 for q in queue if q["state"] == "queued")

    return {
        "downloading":   active,
        "queued":        queued,
        "done_today":    downloaded_today,
        "disk_bytes":    disk_bytes,
        "disk_human":    _human_size(disk_bytes),
    }
