from pathlib import Path

from fastapi import APIRouter, Depends, Query
from fastapi.responses import FileResponse

from ..deps import get_current_user
from ..models.user import User

router = APIRouter(prefix="/api/logs", tags=["logs"])

# backend.log is in the project root (one level above backend/)
LOG_PATH = Path(__file__).parent.parent.parent.parent / "backend.log"


@router.get("")
def get_logs(
    lines: int = Query(default=500, ge=1, le=10000),
    level: str = Query(default="ALL"),
    _: User = Depends(get_current_user),
):
    if not LOG_PATH.exists():
        return {"lines": [], "exists": False}

    with open(LOG_PATH, "r", encoding="utf-8", errors="replace") as f:
        all_lines = f.readlines()

    tail = all_lines[-lines:] if len(all_lines) > lines else all_lines

    if level and level.upper() != "ALL":
        lvl = level.upper()
        tail = [l for l in tail if lvl in l]

    return {"lines": [l.rstrip("\n") for l in tail], "exists": True, "total": len(all_lines)}


@router.get("/download")
def download_log(_: User = Depends(get_current_user)):
    if not LOG_PATH.exists():
        from fastapi import HTTPException
        raise HTTPException(404, "Log soubor nenalezen")
    return FileResponse(
        path=str(LOG_PATH),
        filename="backend.log",
        media_type="text/plain",
    )
