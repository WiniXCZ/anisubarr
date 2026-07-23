from __future__ import annotations

"""
backup.py – Admin endpoints for database backup & restore.

Endpoints:
  GET    /api/backup/list                    → existing backups (name/size/date)
  POST   /api/backup/create                   → create a new snapshot now
  GET    /api/backup/download/{filename}      → download an existing backup
  GET    /api/backup/download-now             → create + immediately download a fresh one
  DELETE /api/backup/{filename}                → delete a backup
  POST   /api/backup/restore                   → upload a .db file and restore from it
  POST   /api/backup/restore-existing/{filename} → restore from an already-stored backup
"""

import logging
import shutil
import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse

from ..deps import require_admin
from ..models.user import User
from ..services import backup as backup_svc

log = logging.getLogger("anisubarr.backup_router")

router = APIRouter(prefix="/api/backup", tags=["backup"])


@router.get("/list")
def list_backups(_: User = Depends(require_admin)):
    return {"backups": backup_svc.list_backups()}


@router.post("/create")
def create_backup(body: dict | None = None, _: User = Depends(require_admin)):
    label = (body or {}).get("label", "")
    try:
        return backup_svc.create_backup(label=label)
    except Exception as exc:
        raise HTTPException(500, f"Vytvoření zálohy selhalo: {exc}")


@router.get("/download-now")
def download_now(_: User = Depends(require_admin)):
    try:
        meta = backup_svc.create_backup(label="manual")
        path = backup_svc.get_backup_path(meta["filename"])
        return FileResponse(path, filename=meta["filename"], media_type="application/octet-stream")
    except Exception as exc:
        raise HTTPException(500, f"Vytvoření zálohy selhalo: {exc}")


@router.get("/download/{filename}")
def download_backup(filename: str, _: User = Depends(require_admin)):
    try:
        path = backup_svc.get_backup_path(filename)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except FileNotFoundError:
        raise HTTPException(404, "Záloha nenalezena")
    return FileResponse(path, filename=filename, media_type="application/octet-stream")


@router.delete("/{filename}")
def delete_backup(filename: str, _: User = Depends(require_admin)):
    try:
        backup_svc.delete_backup(filename)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return {"status": "deleted"}


@router.post("/restore")
async def restore_upload(
    file: UploadFile = File(...),
    _: User = Depends(require_admin),
):
    """
    Upload an Anisubarr .db backup and restore from it.
    The app process exits right after (container restart policy brings it
    back up against the new file) — the response is sent first so the admin
    sees confirmation before the connection drops.
    """
    tmp_path = Path(tempfile.gettempdir()) / f"anisubarr_restore_upload_{file.filename}"
    try:
        with open(tmp_path, "wb") as f:
            shutil.copyfileobj(file.file, f)
        result = backup_svc.restore_from_path(tmp_path)
        return {
            "status": "restoring",
            "message": "Obnova proběhla, aplikace se za chvíli restartuje s novými daty.",
            **result,
        }
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        raise HTTPException(500, f"Obnova selhala: {exc}")
    finally:
        tmp_path.unlink(missing_ok=True)


@router.post("/restore-existing/{filename}")
def restore_existing(filename: str, _: User = Depends(require_admin)):
    try:
        path = backup_svc.get_backup_path(filename)
        result = backup_svc.restore_from_path(path)
        return {
            "status": "restoring",
            "message": "Obnova proběhla, aplikace se za chvíli restartuje s novými daty.",
            **result,
        }
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except FileNotFoundError:
        raise HTTPException(404, "Záloha nenalezena")
    except Exception as exc:
        raise HTTPException(500, f"Obnova selhala: {exc}")
