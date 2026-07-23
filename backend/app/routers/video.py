"""
video.py – FFmpeg subtitle-extraction and removal endpoints.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.orm import Session
from ..database import get_db
from ..deps import get_current_user
from ..models.user import User
from ..services import video as video_svc
from ..services import path_resolver

router = APIRouter(prefix="/api/video", tags=["video"])


# ──────────────────────────────────────────
# Schemas
# ──────────────────────────────────────────

class ExtractRequest(BaseModel):
    file_path: str
    stream_index: int
    output_path: Optional[str] = None


class RemoveRequest(BaseModel):
    file_path: str
    stream_indices: Optional[list[int]] = None
    remove_all: bool = False
    output_path: Optional[str] = None
    in_place: bool = False


# ──────────────────────────────────────────
# Endpoints
# ──────────────────────────────────────────

@router.get("/tools")
def check_tools(_: User = Depends(get_current_user)):
    """Check if ffmpeg and ffprobe are available."""
    return video_svc.check_tools()


@router.post("/probe")
def probe(body: dict, _: User = Depends(get_current_user)):
    """Full ffprobe JSON for a media file. Body: {"file_path": "..."}"""
    path = body.get("file_path")
    if not path:
        raise HTTPException(400, "file_path required")
    try:
        return video_svc.probe(path)
    except Exception as e:
        raise HTTPException(500, str(e))


@router.post("/subtitle-tracks")
def subtitle_tracks(body: dict, _: User = Depends(get_current_user)):
    """List all subtitle streams in a media file. Body: {"file_path": "..."}"""
    path = body.get("file_path")
    if not path:
        raise HTTPException(400, "file_path required")
    try:
        return {"tracks": video_svc.list_subtitle_tracks(path)}
    except Exception as e:
        raise HTTPException(500, str(e))


@router.post("/extract")
def extract(req: ExtractRequest, _: User = Depends(get_current_user)):
    """Extract a single subtitle track to a file."""
    try:
        out = video_svc.extract_subtitle(
            req.file_path,
            req.stream_index,
            output_path=req.output_path,
        )
        return {"output_path": out}
    except NotImplementedError as e:
        raise HTTPException(422, str(e))
    except ValueError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        raise HTTPException(500, str(e))


@router.post("/extract-all")
def extract_all(body: dict, _: User = Depends(get_current_user)):
    """Extract every subtitle track from a media file."""
    path       = body.get("file_path")
    output_dir = body.get("output_dir")
    if not path:
        raise HTTPException(400, "file_path required")
    try:
        results = video_svc.extract_all_subtitles(path, output_dir=output_dir)
        return {"results": results}
    except Exception as e:
        raise HTTPException(500, str(e))


@router.post("/remove-subtitles")
def remove_subtitles(req: RemoveRequest, _: User = Depends(get_current_user)):
    """
    Remux a media file while dropping the specified subtitle tracks.
    Set remove_all=true to strip every subtitle stream.
    Set in_place=true to overwrite the original (DESTRUCTIVE).
    """
    try:
        out = video_svc.remove_subtitles(
            req.file_path,
            stream_indices=req.stream_indices,
            remove_all=req.remove_all,
            output_path=req.output_path,
            in_place=req.in_place,
        )
        return {"output_path": out}
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, str(e))


@router.post("/strip-embedded/{episode_id}")
def strip_embedded_subtitles(
    episode_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """
    Remove ALL embedded subtitle tracks from an episode's video file (in-place remux).
    This is DESTRUCTIVE — the original file is replaced.
    After stripping, clears the subtitles_in_file field in the DB.
    """
    from ..models.series import Episode

    ep = db.query(Episode).filter(Episode.id == episode_id).first()
    if not ep:
        raise HTTPException(404, "Epizoda nenalezena")
    if not ep.file_path:
        raise HTTPException(400, "Epizoda nemá soubor videa")

    # Resolve UNC/Sonarr path to local filesystem path
    try:
        local_path = path_resolver.resolve(ep.file_path)
    except Exception as e:
        raise HTTPException(500, f"Nelze přeložit cestu k souboru: {e}")

    import os
    if not os.path.isfile(local_path):
        raise HTTPException(404, f"Soubor videa nenalezen na disku: {local_path}")

    # Check if there are any subtitle tracks to remove
    try:
        tracks = video_svc.list_subtitle_tracks(local_path)
    except Exception as e:
        raise HTTPException(500, f"ffprobe selhal: {e}")

    if not tracks:
        return {"message": "Žádné vložené titulky k odstranění", "tracks_removed": 0}

    # Strip all subtitle tracks in-place
    try:
        video_svc.remove_subtitles(local_path, remove_all=True, in_place=True)
    except Exception as e:
        raise HTTPException(500, f"FFmpeg selhal při odstraňování titulků: {e}")

    # Clear the cached embedded subtitle info in DB
    ep.subtitles_in_file = None
    db.commit()

    return {
        "message": f"Odstraněno {len(tracks)} vložených stop titulků",
        "tracks_removed": len(tracks),
        "tracks": tracks,
    }
