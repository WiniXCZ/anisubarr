"""
system.py – diagnostics for troubleshooting a broken install.

GET /api/system/diag (admin) returns everything needed to debug the classic
failure modes remotely: where the DB actually lives (and whether it's on a
mapped volume), WAL state, config file location, registry summary, and the
result of the startup self-heal pass.
"""
from __future__ import annotations

import os
import sys

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import get_db, engine
from ..deps import require_admin
from ..models.user import User

router = APIRouter(prefix="/api/system", tags=["system"])

# Filled in by main.py's lifespan after the startup self-heal pass.
last_selfheal: dict = {}


def _limiter_usage() -> dict:
    """Per-provider request budget usage — shows at a glance whether a provider
    is being hammered or is in a cooldown window."""
    try:
        from ..services import scraper_limiter
        return scraper_limiter.usage()
    except Exception as exc:
        return {"error": str(exc)}


@router.get("/diag")
def system_diag(db: Session = Depends(get_db), _: User = Depends(require_admin)) -> dict:
    settings = get_settings()

    # DB file info
    db_info: dict = {"url": settings.database_url}
    try:
        from ..services.backup import _db_path
        p = _db_path()
        db_info.update({
            "path": str(p),
            "exists": p.is_file(),
            "size_bytes": p.stat().st_size if p.is_file() else 0,
            "dir_writable": os.access(p.parent, os.W_OK),
        })
    except Exception as exc:
        db_info["error"] = str(exc)

    try:
        with engine.connect() as conn:
            db_info["journal_mode"] = conn.execute(text("PRAGMA journal_mode")).scalar()
    except Exception as exc:
        db_info["journal_mode"] = f"error: {exc}"

    # settings.yaml
    yaml_info: dict = {}
    try:
        from ..services.config_file import _yaml_path
        yp = _yaml_path()
        yaml_info = {"path": str(yp), "exists": yp.is_file()}
    except Exception as exc:
        yaml_info = {"error": str(exc)}

    # Connection registry summary
    services: list = []
    try:
        from ..models.service import Service
        for s in db.query(Service).order_by(Service.type, Service.id).all():
            services.append({
                "id": s.id, "type": s.type, "name": s.name,
                "enabled": s.enabled, "is_default": s.is_default,
                "has_host": bool(s.host),
            })
    except Exception as exc:
        services = [{"error": str(exc)}]

    libraries: dict = {}
    try:
        from ..models.library import Library
        libs = db.query(Library).all()
        libraries = {
            "count": len(libs),
            "unlinked": sum(1 for l in libs if not l.sonarr_service_id and l.media_type != "movies"),
        }
    except Exception as exc:
        libraries = {"error": str(exc)}

    return {
        "version": settings.app_version,
        "platform": sys.platform,
        "database": db_info,
        "settings_yaml": yaml_info,
        "services": services,
        "libraries": libraries,
        "selfheal": last_selfheal,
        "scraper_limits": _limiter_usage(),
    }
