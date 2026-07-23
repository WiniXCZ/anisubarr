"""
audit.py – Subtitle audit / state-machine API endpoints.

Endpoints:
  GET  /api/audit/status                  → audit_status summary for all series
  GET  /api/audit/{series_id}              → current audit status + last eval details
  GET  /api/audit/{series_id}/log          → chronological audit_log entries
  POST /api/audit/check                    → re-run audit for all series (sync)
  POST /api/audit/check/{series_id}        → re-run audit for one series (sync)
"""
from __future__ import annotations

import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, subqueryload

from ..database import get_db
from ..deps import get_current_user
from ..models.series import Series, Episode
from ..models.audit_log import SeriesAuditLog
from ..models.user import User
from ..services import audit as audit_svc

log = logging.getLogger("anisubarr.audit")
router = APIRouter(prefix="/api/audit", tags=["audit"])


def _log_entry_out(e: SeriesAuditLog) -> dict:
    return {
        "id":         e.id,
        "event_type": e.event_type,
        "message":    e.message,
        "detail":     e.detail,
        "created_at": e.created_at.isoformat() if e.created_at else None,
    }


@router.get("/status")
def audit_status_all(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Return audit_status summary for every series (for dashboard/list badges)."""
    rows = db.query(Series).all()
    return [
        {
            "id":                  s.id,
            "title":               s.title,
            "audit_status":        s.audit_status,
            "audit_status_reason": s.audit_status_reason,
            "audit_status_since":  s.audit_status_since.isoformat() if s.audit_status_since else None,
        }
        for s in rows
    ]


@router.get("/{series_id}")
def audit_status_one(
    series_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Return the current audit status + last evaluation details for one series."""
    s = (
        db.query(Series)
        .options(subqueryload(Series.episodes).subqueryload(Episode.subtitles))
        .filter(Series.id == series_id)
        .first()
    )
    if not s:
        raise HTTPException(404, "Seriál nenalezen")

    subtitle_eval = audit_svc.evaluate_subtitle_confidence(s, db)
    seerr_map = audit_svc._fetch_seerr_damage_map(db)
    damage_info = seerr_map.get(int(s.tvdb_id)) if s.tvdb_id else None
    damage_eval = audit_svc.evaluate_damage_ratio(s, damage_info)

    return {
        "id":                  s.id,
        "title":               s.title,
        "audit_status":        s.audit_status,
        "audit_status_reason": s.audit_status_reason,
        "audit_status_since":  s.audit_status_since.isoformat() if s.audit_status_since else None,
        "last_hiyori_check_at": s.last_hiyori_check_at.isoformat() if s.last_hiyori_check_at else None,
        "subtitle_eval": subtitle_eval,
        "damage_eval":   damage_eval,
    }


@router.get("/{series_id}/log")
def audit_log_list(
    series_id: int,
    limit: int = Query(200, ge=1, le=1000),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Return chronological audit_log entries for one series (newest first)."""
    s = db.query(Series).filter(Series.id == series_id).first()
    if not s:
        raise HTTPException(404, "Seriál nenalezen")

    entries = (
        db.query(SeriesAuditLog)
        .filter(SeriesAuditLog.series_id == series_id)
        .order_by(SeriesAuditLog.created_at.desc())
        .limit(limit)
        .all()
    )
    return [_log_entry_out(e) for e in entries]


@router.post("/check")
def audit_check_all(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Re-run the audit pipeline for all series (synchronous)."""
    results = audit_svc.audit_all(db)
    changed = sum(1 for r in results if r.get("changed"))
    return {"status": "done", "total": len(results), "changed": changed, "results": results}


@router.post("/check/{series_id}")
def audit_check_one(
    series_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Re-run the audit pipeline for one series (synchronous)."""
    s = (
        db.query(Series)
        .options(subqueryload(Series.episodes).subqueryload(Episode.subtitles))
        .filter(Series.id == series_id)
        .first()
    )
    if not s:
        raise HTTPException(404, "Seriál nenalezen")
    return audit_svc.audit_series(db, s)
