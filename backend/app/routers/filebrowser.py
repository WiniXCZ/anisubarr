"""filebrowser.py – Browse media directories."""
import os
from fastapi import APIRouter, Depends, Query, HTTPException
from ..deps import get_current_user
from ..models.user import User
from ..services import path_resolver
from ..config import get_settings

router = APIRouter(prefix="/api/files", tags=["files"])

VIDEO_EXT  = {".mkv", ".mp4", ".avi", ".m2ts", ".ts", ".mov", ".wmv", ".flv"}
SUB_EXT    = {".srt", ".ass", ".ssa", ".vtt", ".sub"}
IMAGE_EXT  = {".jpg", ".jpeg", ".png", ".webp"}
SHOW_EXT   = VIDEO_EXT | SUB_EXT | IMAGE_EXT | {".nfo"}


def _entry(full_path: str, name: str) -> dict:
    stat    = os.stat(full_path)
    _, ext  = os.path.splitext(name)
    is_dir  = os.path.isdir(full_path)
    size    = 0 if is_dir else stat.st_size
    return {
        "name":    name,
        "path":    full_path,
        "is_dir":  is_dir,
        "ext":     ext.lower(),
        "size":    size,
        "size_h":  _human(size),
        "mtime":   int(stat.st_mtime),
        "kind":    "dir" if is_dir
                   else ("video"    if ext.lower() in VIDEO_EXT
                   else ("subtitle" if ext.lower() in SUB_EXT
                   else ("image"    if ext.lower() in IMAGE_EXT
                   else "other"))),
    }


def _human(b: int) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if b < 1024:
            return f"{b:.1f} {unit}"
        b /= 1024
    return f"{b:.1f} PB"


@router.get("/browse")
def browse(
    path: str = Query("", description="Absolute path to browse"),
    _: User = Depends(get_current_user),
):
    settings = get_settings()

    # Determine root: prefer explicit path, else media_root or local_prefix
    if not path:
        root = settings.media_root or settings.path_local_prefix or ""
        if not root:
            return {"path": "", "entries": [], "error": "media_root not configured"}
        path = root

    # Ensure SMB share is authenticated & mapped (no-op on Linux or non-UNC paths)
    try:
        path_resolver.ensure_smb(path)
    except PermissionError as e:
        raise HTTPException(403, str(e))

    # Translate UNC path (\\server\share\...) → drive letter (Y:\...) on Windows
    path = path_resolver.unc_to_local(path)

    if not os.path.exists(path):
        raise HTTPException(404, f"Path not found: {path}")
    if not os.path.isdir(path):
        raise HTTPException(400, "Not a directory")

    try:
        names   = sorted(os.listdir(path))
        entries = []
        for name in names:
            if name.startswith("."):
                continue
            full = os.path.join(path, name)
            _, ext = os.path.splitext(name)
            if os.path.isdir(full) or ext.lower() in SHOW_EXT:
                entries.append(_entry(full, name))

        # Sort: dirs first, then by name
        entries.sort(key=lambda e: (0 if e["is_dir"] else 1, e["name"].lower()))

        # Parent path
        parent = os.path.dirname(path) if path != os.path.dirname(path) else None

        return {
            "path":    path,
            "parent":  parent,
            "entries": entries,
        }
    except PermissionError:
        raise HTTPException(403, "Permission denied")
