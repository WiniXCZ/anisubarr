"""
video_stream.py – Range-aware video streaming + FFmpeg clip cut.
"""
import os
import re
import subprocess
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import get_db
from ..deps import get_current_user
from ..models.series import Episode
from ..models.user import User
from ..services import path_resolver
from ..services.auth import decode_token

settings = get_settings()

router = APIRouter(prefix="/api/video", tags=["video-stream"])

_MIME: dict[str, str] = {
    ".mkv":  "video/x-matroska",
    ".mp4":  "video/mp4",
    ".avi":  "video/x-msvideo",
    ".webm": "video/webm",
    ".m4v":  "video/mp4",
    ".mov":  "video/quicktime",
    ".ts":   "video/mp2t",
}


def _resolve_episode(episode_id: int, db: Session) -> tuple[Episode, str]:
    ep = db.query(Episode).filter(Episode.id == episode_id).first()
    if not ep:
        raise HTTPException(404, "Epizoda nenalezena")
    if not ep.file_path:
        raise HTTPException(400, "Epizoda nemá soubor videa")
    try:
        local = path_resolver.resolve(ep.file_path)
    except Exception as exc:
        raise HTTPException(500, f"Nelze přeložit cestu: {exc}")
    if not os.path.isfile(local):
        raise HTTPException(404, f"Soubor nenalezen: {local}")
    return ep, local


def _verify_token(request: Request, token_param: Optional[str], db: Session) -> User:
    """Accepts Bearer header OR ?token= query param (needed for <video src>)."""
    raw = None
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        raw = auth.split(" ", 1)[1]
    elif token_param:
        raw = token_param

    if not raw:
        raise HTTPException(401, "Není přihlášen")

    payload = decode_token(raw)
    if not payload:
        raise HTTPException(401, "Neplatný token")

    user = db.query(User).filter(User.id == payload.get("sub")).first()
    if not user or not user.is_active:
        raise HTTPException(401, "Uživatel nenalezen")
    return user


@router.get("/stream/{episode_id}")
async def stream_video(
    episode_id: int,
    request: Request,
    token: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """Range-aware HTTP streaming for the HTML5 <video> element."""
    _verify_token(request, token, db)
    _, local = _resolve_episode(episode_id, db)

    file_size = os.path.getsize(local)
    mime = _MIME.get(Path(local).suffix.lower(), "video/mp4")

    def _gen(start: int, length: int):
        chunk = 1 << 16  # 64 KiB
        with open(local, "rb") as fh:
            fh.seek(start)
            rem = length
            while rem > 0:
                data = fh.read(min(chunk, rem))
                if not data:
                    break
                rem -= len(data)
                yield data

    range_hdr = request.headers.get("Range")
    if range_hdr:
        m = re.match(r"bytes=(\d+)-(\d*)", range_hdr)
        if not m:
            raise HTTPException(416, "Invalid Range header")
        start = int(m.group(1))
        end = int(m.group(2)) if m.group(2) else file_size - 1
        end = min(end, file_size - 1)
        if start > end or start >= file_size:
            raise HTTPException(416, "Range Not Satisfiable")
        length = end - start + 1
        return StreamingResponse(
            _gen(start, length),
            status_code=206,
            media_type=mime,
            headers={
                "Content-Range": f"bytes {start}-{end}/{file_size}",
                "Accept-Ranges": "bytes",
                "Content-Length": str(length),
            },
        )

    return StreamingResponse(
        _gen(0, file_size),
        status_code=200,
        media_type=mime,
        headers={
            "Accept-Ranges": "bytes",
            "Content-Length": str(file_size),
        },
    )


class CutRequest(BaseModel):
    from_seconds: float
    to_seconds: float
    output_suffix: str = "_cut"


@router.post("/cut/{episode_id}")
def cut_video(
    episode_id: int,
    body: CutRequest,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Cut a clip using FFmpeg stream copy (no re-encode)."""
    _, local = _resolve_episode(episode_id, db)
    src = Path(local)
    out = str(src.with_stem(src.stem + body.output_suffix))

    result = subprocess.run(
        [
            settings.ffmpeg_path or "ffmpeg",
            "-y",
            "-ss", str(body.from_seconds),
            "-to", str(body.to_seconds),
            "-i", local,
            "-c", "copy",
            "-avoid_negative_ts", "make_zero",
            out,
        ],
        capture_output=True,
        text=True,
        encoding='utf-8',
        errors='replace',
        timeout=600,
    )
    if result.returncode != 0:
        raise HTTPException(500, f"FFmpeg selhal: {result.stderr[-500:]}")

    return {
        "output_path": out,
        "from_seconds": body.from_seconds,
        "to_seconds": body.to_seconds,
        "duration_seconds": body.to_seconds - body.from_seconds,
    }
