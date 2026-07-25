"""
quick_add.py – Quick-add anime to Sonarr from Anisubarr.

Endpoints:
  GET  /api/sonarr/root-folders       – list root folders
  GET  /api/sonarr/quality-profiles   – list quality profiles
  POST /api/sonarr/add                – add series to Sonarr
"""
from __future__ import annotations

import difflib
import re

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user
from ..models.user import User
from ..utils.settings_helper import read_setting

router = APIRouter(prefix="/api/sonarr", tags=["quick_add"])

# Below this similarity score, two titles are considered unrelated.
_DUPLICATE_THRESHOLD = 0.6


def _normalize_title(s: str) -> str:
    """Lowercase, strip year suffixes and punctuation for fuzzy comparison."""
    s = s.lower()
    s = re.sub(r"\(\d{4}\)", "", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return s.strip()


def _find_similar_series(base: str, api_key: str, title: str) -> dict | None:
    """Look for an existing Sonarr series whose title (or alternate titles)
    is suspiciously similar to ``title``. Returns info about the best match
    if it's above the duplicate threshold, else None.

    This guards against adding a series that's already in the library under
    a different TVDB entry / title (e.g. an English title vs. a romaji
    title for the same season), which previously created duplicate, empty
    folders.
    """
    try:
        with httpx.Client(timeout=15) as c:
            r = c.get(f"{base}/api/v3/series", headers={"X-Api-Key": api_key})
            r.raise_for_status()
            existing = r.json()
    except httpx.HTTPError:
        # If we can't check, don't block the add - just skip the warning.
        return None

    target = _normalize_title(title)
    best = None
    best_score = 0.0
    for s in existing:
        candidates = [s.get("title", "")] + [
            a.get("title", "") for a in s.get("alternateTitles", []) if a.get("title")
        ]
        for cand in candidates:
            if not cand:
                continue
            score = difflib.SequenceMatcher(None, target, _normalize_title(cand)).ratio()
            if score > best_score:
                best_score = score
                best = s

    if best and best_score >= _DUPLICATE_THRESHOLD:
        return {
            "sonarr_id": best.get("id"),
            "title": best.get("title"),
            "path": best.get("path"),
            "tvdb_id": best.get("tvdbId"),
            "score": round(best_score, 2),
        }
    return None


def _sonarr_client(db: Session) -> tuple[str, str]:
    """Return (base_url, api_key) from the connection registry (fallback DB/env)."""
    from ..services import connections
    host, api_key = connections.resolve_sonarr(db)
    if not host:
        raise HTTPException(status_code=503, detail="Sonarr host není nakonfigurován")
    if not api_key:
        raise HTTPException(status_code=503, detail="Sonarr API key není nakonfigurován")
    if not host.startswith("http"):
        host = f"http://{host}"
    return host.rstrip("/"), api_key


@router.get("/root-folders")
def get_root_folders(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Return list of Sonarr root folders with free space."""
    base, api_key = _sonarr_client(db)
    try:
        with httpx.Client(timeout=10) as c:
            r = c.get(f"{base}/api/v3/rootfolder", headers={"X-Api-Key": api_key})
            r.raise_for_status()
            return [
                {
                    "path": f["path"],
                    "freeSpace": f.get("freeSpace", 0),
                }
                for f in r.json()
            ]
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Sonarr chyba: {e}")


@router.get("/quality-profiles")
def get_quality_profiles(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Return list of Sonarr quality profiles."""
    base, api_key = _sonarr_client(db)
    try:
        with httpx.Client(timeout=10) as c:
            r = c.get(f"{base}/api/v3/qualityprofile", headers={"X-Api-Key": api_key})
            r.raise_for_status()
            return [{"id": p["id"], "name": p["name"]} for p in r.json()]
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Sonarr chyba: {e}")


class AddSeriesRequest(BaseModel):
    tvdb_id: int
    title: str
    root_folder_path: str
    quality_profile_id: int
    season_folder: bool = True
    force: bool = False


@router.post("/add")
def add_series_to_sonarr(
    body: AddSeriesRequest,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Add an anime series to Sonarr by TVDB ID."""
    base, api_key = _sonarr_client(db)

    if not body.force:
        similar = _find_similar_series(base, api_key, body.title)
        if similar:
            raise HTTPException(
                status_code=409,
                detail={
                    "message": (
                        f"V knihovně už možná existuje podobný titul: "
                        f"\"{similar['title']}\" ({similar['path']}). "
                        "Pokud jde o jiný díl/sezónu, potvrď přidání znovu s force=true."
                    ),
                    "similar": similar,
                },
            )

    payload = {
        "tvdbId": body.tvdb_id,
        "title": body.title,
        "qualityProfileId": body.quality_profile_id,
        "rootFolderPath": body.root_folder_path,
        "seasonFolder": body.season_folder,
        "monitored": True,
        "addOptions": {
            "searchForMissingEpisodes": True,
            "monitor": "all",
        },
    }
    try:
        with httpx.Client(timeout=30) as c:
            r = c.post(
                f"{base}/api/v3/series",
                json=payload,
                headers={"X-Api-Key": api_key},
            )
            if r.status_code == 400:
                detail = r.json()
                # Sonarr returns array of validation errors
                if isinstance(detail, list):
                    msgs = [e.get("errorMessage", "") for e in detail]
                    raise HTTPException(status_code=400, detail="; ".join(msgs))
                raise HTTPException(status_code=400, detail=str(detail))
            r.raise_for_status()
            result = r.json()
            return {"sonarr_id": result.get("id"), "title": result.get("title")}
    except HTTPException:
        raise
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Sonarr chyba: {e}")
