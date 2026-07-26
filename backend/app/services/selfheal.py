"""
selfheal.py – startup consistency checks & automatic repairs.

Run once per boot from main.py's lifespan. Every check is best-effort and
individually wrapped — a failed repair logs a warning, it never prevents the
app from starting. Returns a summary dict that /api/system/diag exposes.
"""
from __future__ import annotations

import logging

log = logging.getLogger("anisubarr.selfheal")


def run_startup_checks(db) -> dict:
    summary: dict = {"orphaned_library_links": 0, "duplicate_defaults_fixed": 0}

    # 1) Libraries pointing at a deleted/unknown Service → unlink so library
    #    sync falls back to the default instance instead of silently failing.
    try:
        from ..models.library import Library
        from ..models.service import Service
        valid_ids = {sid for (sid,) in db.query(Service.id).all()}
        orphans = (
            db.query(Library)
            .filter(Library.sonarr_service_id.isnot(None))
            .filter(~Library.sonarr_service_id.in_(valid_ids) if valid_ids
                    else Library.sonarr_service_id.isnot(None))
            .all()
        )
        for lib in orphans:
            log.warning(
                "[selfheal] knihovna '%s' odkazovala na neexistující službu id=%s — odpojeno",
                lib.name, lib.sonarr_service_id,
            )
            lib.sonarr_service_id = None
        if orphans:
            db.commit()
        summary["orphaned_library_links"] = len(orphans)
    except Exception as exc:
        db.rollback()
        log.warning("[selfheal] kontrola knihoven selhala: %s", exc)

    # 2) At most one default Service per type — duplicates keep the oldest.
    try:
        from ..models.service import Service
        by_type: dict = {}
        for svc in (
            db.query(Service)
            .filter(Service.is_default == True)  # noqa: E712
            .order_by(Service.type, Service.id)
            .all()
        ):
            if svc.type in by_type:
                svc.is_default = False
                summary["duplicate_defaults_fixed"] += 1
                log.warning(
                    "[selfheal] služba '%s' (id=%d) byla druhá výchozí pro typ %s — zrušeno",
                    svc.name, svc.id, svc.type,
                )
            else:
                by_type[svc.type] = svc.id
        if summary["duplicate_defaults_fixed"]:
            db.commit()
    except Exception as exc:
        db.rollback()
        log.warning("[selfheal] kontrola výchozích služeb selhala: %s", exc)

    return summary
