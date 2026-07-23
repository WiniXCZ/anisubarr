"""
jobs.py – REST endpoint pro čtení persistentního logu spuštěných jobů.

GET /api/jobs           → seznam posledních spuštění + počet běžících
GET /api/jobs?limit=50  → omezit počet vrácených záznamů
"""
from fastapi import APIRouter, Depends, HTTPException, Query

from ..deps import get_current_user
from ..models.user import User
from ..services import job_log

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


@router.get("")
def get_jobs(
    limit: int = Query(default=100, ge=1, le=500),
    _: User = Depends(get_current_user),
):
    """Vrátí posledních N spuštění jobů (z DB) a počet právě běžících."""
    return {
        "runs":          job_log.get_runs(limit=limit),
        "running_count": job_log.get_running_count(),
    }


@router.post("/{run_id}/cancel")
def cancel_job(
    run_id: str,
    _: User = Depends(get_current_user),
):
    """Zruší běžící job (nastaví status na 'cancelled')."""
    success = job_log.cancel_run(run_id)
    if not success:
        raise HTTPException(404, "Job nenalezen nebo již není aktivní")
    return {"status": "cancelled"}
