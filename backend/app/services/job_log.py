"""
job_log.py – Persistent job run log backed by SQLite.

Each run is written to the `job_runs` table immediately on start, and updated
on finish. In-memory deque is kept only for fast running_count queries.

Keeps up to MAX_RUNS rows in the database; older rows are pruned on startup
and after each new run.
"""
from __future__ import annotations

import logging
import threading
from collections import deque
from datetime import datetime, timezone
from typing import Optional
from uuid import uuid4

log = logging.getLogger("anisubarr.job_log")

MAX_RUNS = 200  # max rows to keep in DB

# In-memory set of run_ids currently "running" — for fast badge count
_running: set[str] = set()
_lock = threading.Lock()

# Live progress messages for running jobs (in-memory only, not persisted to DB)
_live_messages: dict[str, str] = {}
# Live progress 0–100 for running jobs (in-memory only)
_live_progress: dict[str, int] = {}


# ── JobRun handle (returned to callers so they can call finish_run) ───────────

class JobRun:
    def __init__(self, run_id: str, job_id: str, job_name: str):
        self.run_id  = run_id
        self.job_id  = job_id
        self.job_name = job_name
        self.status  = "running"
        self.started_at  = datetime.now(timezone.utc)
        self.finished_at: Optional[datetime] = None
        self.message = ""


# ── DB helpers ────────────────────────────────────────────────────────────────

def _db_write(run: JobRun) -> None:
    """Insert a new run row into the DB."""
    try:
        from ..database import SessionLocal
        from ..models.job_run import JobRunModel
        db = SessionLocal()
        try:
            row = JobRunModel(
                run_id     = run.run_id,
                job_id     = run.job_id,
                job_name   = run.job_name,
                status     = run.status,
                started_at = run.started_at,
                message    = run.message,
            )
            db.add(row)
            db.commit()
        finally:
            db.close()
    except Exception as e:
        log.warning("DB write error: %s", e)


def _db_update(run: JobRun) -> None:
    """Update status/finished_at/message for an existing run row."""
    try:
        from ..database import SessionLocal
        from ..models.job_run import JobRunModel
        db = SessionLocal()
        try:
            row = db.query(JobRunModel).filter(JobRunModel.run_id == run.run_id).first()
            if row:
                row.status      = run.status
                row.finished_at = run.finished_at
                row.message     = run.message
                db.commit()
        finally:
            db.close()
    except Exception as e:
        log.warning("DB update error: %s", e)


def _db_prune() -> None:
    """Keep only the newest MAX_RUNS rows; delete the rest."""
    try:
        from ..database import SessionLocal, engine
        from ..models.job_run import JobRunModel
        from sqlalchemy import text
        db = SessionLocal()
        try:
            # Delete rows older than the newest MAX_RUNS
            count = db.query(JobRunModel).count()
            if count > MAX_RUNS:
                oldest_ids = (
                    db.query(JobRunModel.id)
                    .order_by(JobRunModel.started_at.asc())
                    .limit(count - MAX_RUNS)
                    .all()
                )
                ids_to_del = [r.id for r in oldest_ids]
                if ids_to_del:
                    db.query(JobRunModel).filter(JobRunModel.id.in_(ids_to_del)).delete(synchronize_session=False)
                    db.commit()
        finally:
            db.close()
    except Exception as e:
        log.warning("DB prune error: %s", e)


# ── Public API ────────────────────────────────────────────────────────────────

def cleanup_stale_running() -> None:
    """Mark any DB rows still 'running' as error — called on app startup after crash/restart."""
    try:
        from ..database import SessionLocal
        from ..models.job_run import JobRunModel
        db = SessionLocal()
        try:
            stale = db.query(JobRunModel).filter(JobRunModel.status == "running").all()
            for row in stale:
                row.status      = "error"
                row.message     = "Přerušeno restartem serveru"
                row.finished_at = datetime.now(timezone.utc)
            if stale:
                db.commit()
                log.info("[job_log] Cleaned up %d stale running jobs", len(stale))
        finally:
            db.close()
    except Exception as e:
        log.warning("Stale job cleanup error: %s", e)


def wal_checkpoint() -> None:
    """Run SQLite WAL checkpoint to compact the WAL file (prevents unbounded growth)."""
    try:
        from ..database import engine
        with engine.connect() as conn:
            conn.execute(__import__("sqlalchemy").text("PRAGMA wal_checkpoint(TRUNCATE)"))
    except Exception as e:
        log.warning("WAL checkpoint error: %s", e)


def start_run(job_id: str, job_name: str) -> JobRun:
    """Register a new job run. Persists immediately to DB."""
    run = JobRun(run_id=uuid4().hex[:8], job_id=job_id, job_name=job_name)
    with _lock:
        _running.add(run.run_id)
    _db_write(run)
    _db_prune()
    return run


def update_progress(run_id: str, current: int, total: int, message: str = "") -> None:
    """Update live progress (0–100) and optional message for a running job."""
    pct = round(current / total * 100) if total > 0 else 0
    with _lock:
        if run_id in _running:
            _live_progress[run_id] = pct
            if message:
                _live_messages[run_id] = message


def update_message(run_id: str, message: str) -> None:
    """Update live progress message for a running job (in-memory only, no DB write)."""
    with _lock:
        if run_id in _running:
            _live_messages[run_id] = message


def cancel_run_id(run_id: str) -> None:
    """Internal helper to mark run_id as no longer running (without DB update)."""
    with _lock:
        _running.discard(run_id)
        _live_messages.pop(run_id, None)
        _live_progress.pop(run_id, None)


def finish_run(run: JobRun, status: str, message: str = "") -> None:
    """Mark run as done/error. Updates DB row."""
    run.status      = status
    run.finished_at = datetime.now(timezone.utc)
    run.message     = message
    with _lock:
        _running.discard(run.run_id)
        _live_messages.pop(run.run_id, None)
        _live_progress.pop(run.run_id, None)
    _db_update(run)


def _iso_utc(dt) -> str | None:
    """Serialize a datetime to ISO-8601 with explicit UTC 'Z' suffix.
    SQLite returns naive datetimes even when stored as UTC; without the suffix
    JavaScript's Date() mis-interprets them as local time."""
    if dt is None:
        return None
    s = dt.isoformat()
    # Already has timezone info (+XX:XX or Z)
    if dt.tzinfo is not None or "+" in s[10:] or s.endswith("Z"):
        return s
    return s + "Z"


def get_runs(limit: int = 100) -> list[dict]:
    """Return most recent runs from DB, newest first."""
    try:
        from ..database import SessionLocal
        from ..models.job_run import JobRunModel
        db = SessionLocal()
        try:
            rows = (
                db.query(JobRunModel)
                .order_by(JobRunModel.started_at.desc())
                .limit(limit)
                .all()
            )
            return [
                {
                    "run_id":      r.run_id,
                    "job_id":      r.job_id,
                    "job_name":    r.job_name,
                    "status":      r.status,
                    "started_at":  _iso_utc(r.started_at),
                    "finished_at": _iso_utc(r.finished_at),
                    "message":     _live_messages.get(r.run_id, r.message or ""),
                    "progress":    _live_progress.get(r.run_id),  # None when not running
                }
                for r in rows
            ]
        finally:
            db.close()
    except Exception as e:
        log.warning("DB read error: %s", e)
        return []


def cancel_run(run_id: str) -> bool:
    """Mark a running job as cancelled. Returns True if found and was running."""
    try:
        from ..database import SessionLocal
        from ..models.job_run import JobRunModel
        db = SessionLocal()
        try:
            row = db.query(JobRunModel).filter(JobRunModel.run_id == run_id).first()
            if row and row.status == "running":
                row.status      = "cancelled"
                row.finished_at = datetime.now(timezone.utc)
                row.message     = "Zrušeno uživatelem"
                db.commit()
                with _lock:
                    _running.discard(run_id)
                    _live_messages.pop(run_id, None)
                return True
            return False
        finally:
            db.close()
    except Exception as e:
        log.warning("DB cancel error: %s", e)
        return False


def get_running_count() -> int:
    """Fast in-memory count of currently running jobs."""
    with _lock:
        return len(_running)
