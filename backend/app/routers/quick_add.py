"""
quick_add.py – Quick-add anime to Sonarr from Anisubarr.

Endpoints:
  GET  /api/sonarr/root-folders       – list root folders
  GET  /api/sonarr/quality-profiles   – list quality profiles
  POST /api/sonarr/add                – add series to Sonarr
"""
from __future__ import annotations

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user
from ..models.user import User
from ..utils.settings_helper import read_setting

router = APIRouter(prefix="/api/sonarr", tags=["quick_add"])


def _sonarr_client(db: Session) -> tuple[str, str]:
    """Return (base_url, api_key) from DB/env settings."""
    host = read_setting("sonarr_host", db) or ""
    api_key = read_setting("sonarr_api_key", db) or ""
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


@router.post("/add")
def add_series_to_sonarr(
    body: AddSeriesRequest,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Add an anime series to Sonarr by TVDB ID."""
    base, api_key = _sonarr_client(db)
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
