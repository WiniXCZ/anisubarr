"""
movie_files.py – the "Filmy" tab: every movie file with what is really inside it.

GET  /api/movie-files            all rows (resolution, HDR, audio tracks, subtitles, verification)
GET  /api/movie-files/status     whether a scan / verification is running
POST /api/movie-files/scan       start a scan (?verify=true adds the playability check)
POST /api/movie-files/{id}/rescan  re-read (and verify) one file right now
"""
from __future__ import annotations

import threading

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user
from ..models.movie_file import MovieFile
from ..models.user import User
from ..services import movie_scan, job_log
from ..services import scheduler as sched_svc

router = APIRouter(prefix="/api/movie-files", tags=["movie-files"])


@router.get("")
def list_movie_files(db: Session = Depends(get_db), _: User = Depends(get_current_user)) -> list[dict]:
    rows = db.query(MovieFile).order_by(MovieFile.title, MovieFile.year, MovieFile.path).all()
    return [movie_scan.row_dict(r) for r in rows]


def _running() -> dict:
    out = {}
    for job_id in ("movie_scan", "movie_verify"):
        run_id = job_log.current_run_id(job_id)
        out[job_id] = {"running": bool(run_id) or sched_svc.is_running(job_id),
                       "message": job_log.get_message(run_id) if run_id else ""}
    return out


@router.get("/status")
def scan_status(_: User = Depends(get_current_user)) -> dict:
    return {"jobs": _running(), "roots": movie_scan.roots()}


@router.post("/scan", status_code=202)
def start_scan(verify: bool = False, _: User = Depends(get_current_user)) -> dict:
    job_id = "movie_verify" if verify else "movie_scan"
    if any(j["running"] for j in _running().values()):
        raise HTTPException(409, "Sken filmů už běží")
    threading.Thread(target=sched_svc.trigger_now, args=(job_id,), daemon=True).start()
    return {"status": "queued", "job_id": job_id}


@router.post("/{file_id}/rescan")
def rescan_one(file_id: int, verify: bool = True, db: Session = Depends(get_db),
               _: User = Depends(get_current_user)) -> dict:
    row = db.get(MovieFile, file_id)
    if not row:
        raise HTTPException(404, "Soubor nenalezen")
    try:
        movie_scan.scan_one(db, row, verify_file=verify, force=True)
    except FileNotFoundError:
        db.delete(row)
        db.commit()
        raise HTTPException(410, "Soubor už na disku není")
    db.commit()
    return movie_scan.row_dict(row)
