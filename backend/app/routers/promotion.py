"""
promotion.py – Auto-promotion / demotion API endpoints.

Endpoints:
  POST /api/promotion/check               → run promotion check for all series (background)
  POST /api/promotion/check/{series_id}   → run promotion check for one series (inline)
  GET  /api/promotion/status              → list promoted series + series with open issues
"""
from __future__ import annotations

import logging
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db, SessionLocal
from ..deps import get_current_user
from ..models.series import Series
from ..models.user import User
from ..services import promotion as promo_svc

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/promotion", tags=["promotion"])


# ── Background task helpers ───────────────────────────────────────────────────

def _bg_publish(series_id: int):
    """Background task: publish a series (long-running Sonarr file move)."""
    db = SessionLocal()
    try:
        s = db.query(Series).filter(Series.id == series_id).first()
        if s:
            result = promo_svc.force_publish(db, s)
            log.info("BG publish %d: %s", series_id, result)
    except Exception as exc:
        log.error("BG publish %d failed: %s", series_id, exc)
    finally:
        db.close()


def _bg_demote(series_id: int):
    """Background task: demote a series (long-running Sonarr file move)."""
    db = SessionLocal()
    try:
        s = db.query(Series).filter(Series.id == series_id).first()
        if s:
            result = promo_svc.force_demote(db, s)
            log.info("BG demote %d: %s", series_id, result)
    except Exception as exc:
        log.error("BG demote %d failed: %s", series_id, exc)
    finally:
        db.close()


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/check")
def check_all_promotions(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Run a full promotion + demotion sweep synchronously and return result counts."""
    results = promo_svc.run_all_promotions(db)
    promoted = sum(1 for r in results if r.get("action") == "promoted")
    demoted  = sum(1 for r in results if r.get("action") == "demoted")
    issues   = sum(1 for r in results if r.get("action") in ("issue_flagged", "demotion_error"))
    return {
        "status":   "done",
        "promoted": promoted,
        "demoted":  demoted,
        "issues":   issues,
        "results":  results,
    }


@router.post("/check/{series_id}")
def check_series_promotion(
    series_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Run a promotion check for a single series (synchronous)."""
    s = db.query(Series).filter(Series.id == series_id).first()
    if not s:
        raise HTTPException(404, "Seriál nenalezen")
    return promo_svc.check_and_promote(db, s)


@router.post("/publish/{series_id}", status_code=202)
def publish_series(
    series_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Manually publish a series (move to anime_series folder + add tit tag).
    Runs in the background — file move can take many minutes.
    Returns 202 immediately; check /api/promotion/status for the result."""
    s = db.query(Series).filter(Series.id == series_id).first()
    if not s:
        raise HTTPException(404, "Seriál nenalezen")
    background_tasks.add_task(_bg_publish, series_id)
    return {"status": "started", "series_id": series_id, "title": s.title}


@router.post("/demote/{series_id}", status_code=202)
def demote_series(
    series_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Manually move a series back to the incomplete folder.
    Runs in the background — file move can take many minutes."""
    s = db.query(Series).filter(Series.id == series_id).first()
    if not s:
        raise HTTPException(404, "Seriál nenalezen")
    background_tasks.add_task(_bg_demote, series_id)
    return {"status": "started", "series_id": series_id, "title": s.title}


@router.get("/status")
def promotion_status(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Return lists of promoted series and series with open issues."""
    promoted     = db.query(Series).filter(Series.promoted   == True).all()  # noqa: E712
    with_issues  = db.query(Series).filter(Series.has_issue  == True).all()  # noqa: E712
    return {
        "promoted": [
            {"id": s.id, "title": s.title, "path": s.path}
            for s in promoted
        ],
        "with_issues": [
            {"id": s.id, "title": s.title, "path": s.path}
            for s in with_issues
        ],
    }
