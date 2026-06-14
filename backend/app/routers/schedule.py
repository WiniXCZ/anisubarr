"""
schedule.py – REST API for managing scheduled jobs.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional

from ..database import get_db
from ..deps import get_current_user, require_admin
from ..models.schedule import ScheduledJob
from ..models.user import User
from ..services import scheduler as sched_svc

router = APIRouter(prefix="/api/schedule", tags=["schedule"])


# ──────────────────────────────────────────
# Schemas
# ──────────────────────────────────────────

class JobUpdate(BaseModel):
    enabled:      Optional[bool] = None
    interval:     Optional[str]  = None
    hour:         Optional[int]  = None
    minute:       Optional[int]  = None
    day_of_week:  Optional[int]  = None   # 0=Mon … 6=Sun
    day_of_month: Optional[int]  = None   # 1-28


_VALID_INTERVALS = {"30s", "5min", "10min", "15min", "30min", "1h", "3h", "6h", "12h",
                    "hourly", "daily", "weekly", "monthly"}


def _validate_interval(iv: str) -> bool:
    return iv in _VALID_INTERVALS


def _iso_utc(dt) -> str | None:
    if dt is None:
        return None
    s = dt.isoformat()
    if dt.tzinfo is not None or "+" in s[10:] or s.endswith("Z"):
        return s
    return s + "Z"


def _job_out(row: ScheduledJob, latest_run: dict | None = None) -> dict:
    out = {
        "job_id":       row.job_id,
        "name":         row.name,
        "description":  row.description,
        "interval":     row.interval,
        "hour":         row.hour,
        "minute":       row.minute,
        "day_of_week":  row.day_of_week,
        "day_of_month": row.day_of_month,
        "enabled":      row.enabled,
        "last_run_at":  _iso_utc(row.last_run_at),
        "last_status":  row.last_status,
    }
    if latest_run:
        out["last_run_message"] = latest_run.get("message", "")
    return out


# ──────────────────────────────────────────
# Endpoints
# ──────────────────────────────────────────

@router.get("")
def list_jobs(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    from ..models.job_run import JobRunModel
    rows = db.query(ScheduledJob).order_by(ScheduledJob.job_id).all()
    result = []
    for row in rows:
        latest = (
            db.query(JobRunModel)
            .filter(JobRunModel.job_id == row.job_id, JobRunModel.status != "running")
            .order_by(JobRunModel.started_at.desc())
            .first()
        )
        latest_dict = {"message": latest.message} if latest else None
        result.append(_job_out(row, latest_dict))
    return result


@router.get("/{job_id}")
def get_job(job_id: str, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    row = db.query(ScheduledJob).filter(ScheduledJob.job_id == job_id).first()
    if not row:
        raise HTTPException(404, "Job not found")
    return _job_out(row)


@router.patch("/{job_id}")
def update_job(
    job_id: str,
    body: JobUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    row = db.query(ScheduledJob).filter(ScheduledJob.job_id == job_id).first()
    if not row:
        raise HTTPException(404, "Job not found")

    if body.enabled is not None:
        row.enabled = body.enabled
    if body.interval is not None:
        if not _validate_interval(body.interval):
            raise HTTPException(
                400,
                f"Neplatný interval '{body.interval}'. "
                f"Povolené hodnoty: {', '.join(sorted(_VALID_INTERVALS))}"
            )
        row.interval = body.interval
    if body.hour is not None:
        row.hour = max(0, min(23, body.hour))
    if body.minute is not None:
        row.minute = max(0, min(59, body.minute))
    if body.day_of_week is not None:
        row.day_of_week = max(0, min(6, body.day_of_week))
    if body.day_of_month is not None:
        row.day_of_month = max(1, min(28, body.day_of_month))

    db.commit()
    db.refresh(row)

    sched_svc.reload_job(job_id)

    return _job_out(row)


@router.post("/{job_id}/run", status_code=202)
def run_now(
    job_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Trigger a job to run immediately (outside its normal schedule)."""
    row = db.query(ScheduledJob).filter(ScheduledJob.job_id == job_id).first()
    if not row:
        raise HTTPException(404, "Job not found")
    if job_id not in sched_svc.JOB_REGISTRY:
        raise HTTPException(400, f"Unknown job: {job_id}")
    if sched_svc.is_running(job_id):
        raise HTTPException(400, f"Job '{job_id}' is already running")
    import threading
    t = threading.Thread(target=sched_svc.trigger_now, args=(job_id,), daemon=True)
    t.start()
    return {"status": "queued", "job_id": job_id}
