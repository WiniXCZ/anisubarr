"""connections.py – Central access to the service registry.

Single source of truth for "which Sonarr / Emby / Seerr / … should the backend
use". Everything that used to read settings.sonarr_host in its own spot should
go through here so there's one place to change.

Resolution order for a type:
  1. the enabled Service marked is_default,
  2. otherwise the first enabled Service of that type,
  3. otherwise (legacy fallback) the global .env/AppSetting values, so an
     install that hasn't populated the registry yet keeps working.
"""
from __future__ import annotations

import logging
from typing import Optional

from sqlalchemy.orm import Session

log = logging.getLogger("anisubarr.connections")


def get_default(db: Session, service_type: str):
    """Return the Service instance to use for *service_type*, or None."""
    from ..models.service import Service
    q = db.query(Service).filter(Service.type == service_type, Service.enabled == True)  # noqa: E712
    return (
        q.filter(Service.is_default == True).first()  # noqa: E712
        or q.order_by(Service.id).first()
    )


def list_services(db: Session, service_type: Optional[str] = None):
    from ..models.service import Service
    q = db.query(Service)
    if service_type:
        q = q.filter(Service.type == service_type)
    return q.order_by(Service.type, Service.id).all()


def resolve(db: Session, service_type: str, legacy_host_key: str, legacy_key_key: str) -> tuple[str, str]:
    """Return (host, api_key) for *service_type* from the registry, falling back
    to the legacy global settings so pre-registry installs keep working."""
    svc = get_default(db, service_type)
    if svc and svc.host:
        return svc.host, (svc.api_key or "")
    # Legacy fallback — read from DB AppSetting override then .env.
    from ..routers.settings import _get_setting
    return (_get_setting(db, legacy_host_key) or "", _get_setting(db, legacy_key_key) or "")


def resolve_sonarr(db: Session) -> tuple[str, str]:
    return resolve(db, "sonarr", "sonarr_host", "sonarr_api_key")


def migrate_legacy_config(db: Session) -> int:
    """Seed the registry from existing global settings on first run.

    For each service type that has legacy host/key configured but no Service row
    yet, create one (marked default). Idempotent — skips a type that already has
    any Service. Returns how many rows were created.
    """
    from ..models.service import Service
    from ..routers.settings import _get_setting

    # (type, host_setting_key, api_key_setting_key, default_name)
    legacy_map = [
        ("sonarr", "sonarr_host", "sonarr_api_key", "Sonarr"),
        ("emby",   "emby_host",   "emby_api_key",   "Emby"),
        ("seerr",  "seerr_host",  "seerr_api_key",  "Seerr"),
    ]

    created = 0
    for stype, host_key, key_key, name in legacy_map:
        existing = db.query(Service).filter(Service.type == stype).first()
        if existing:
            continue
        host = (_get_setting(db, host_key) or "").strip()
        api_key = (_get_setting(db, key_key) or "").strip()
        if not host:
            continue
        db.add(Service(
            name=name, type=stype, host=host, api_key=api_key or None,
            enabled=True, is_default=True,
        ))
        created += 1

    # qBittorrent uses username/password rather than an api_key.
    if not db.query(Service).filter(Service.type == "qbittorrent").first():
        qb_host = (_get_setting(db, "qbittorrent_host") or "").strip()
        if qb_host:
            db.add(Service(
                name="qBittorrent", type="qbittorrent", host=qb_host,
                username=(_get_setting(db, "qbittorrent_username") or None),
                password=(_get_setting(db, "qbittorrent_password") or None),
                enabled=True, is_default=True,
            ))
            created += 1

    if created:
        db.commit()
        log.info("[connections] seeded %d service(s) from legacy config", created)
    return created
