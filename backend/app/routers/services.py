"""services.py – Connection registry CRUD + test.

Admin-managed list of external service instances (Sonarr, Radarr, Prowlarr,
qBittorrent, Emby, Seerr, …). Libraries and the backend resolve connections from
here — see services/connections.py.
"""
from __future__ import annotations

import logging
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user, require_admin
from ..models.service import Service, SERVICE_TYPES
from ..models.user import User

log = logging.getLogger("anisubarr.services")

router = APIRouter(prefix="/api/services", tags=["services"])

_MASK = "••••"


# ── schemas ───────────────────────────────────────────────────────────────────

class ServiceCreate(BaseModel):
    name: str
    type: str
    host: Optional[str] = None
    api_key: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    enabled: bool = True
    is_default: bool = False


class ServiceUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    host: Optional[str] = None
    api_key: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    enabled: Optional[bool] = None
    is_default: Optional[bool] = None


def _out(s: Service) -> dict:
    return {
        "id": s.id,
        "name": s.name,
        "type": s.type,
        "host": s.host,
        "api_key": _MASK if s.api_key else None,
        "username": s.username,
        "password": _MASK if s.password else None,
        "enabled": s.enabled,
        "is_default": s.is_default,
        "created_at": s.created_at.isoformat() if s.created_at else None,
    }


def _clear_other_defaults(db: Session, service_type: str, keep_id: Optional[int]) -> None:
    """Ensure at most one default per type."""
    q = db.query(Service).filter(Service.type == service_type, Service.is_default == True)  # noqa: E712
    if keep_id is not None:
        q = q.filter(Service.id != keep_id)
    for other in q.all():
        other.is_default = False


# ── CRUD ──────────────────────────────────────────────────────────────────────

@router.get("")
def list_services(
    type: Optional[str] = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = db.query(Service)
    if type:
        q = q.filter(Service.type == type)
    return [_out(s) for s in q.order_by(Service.type, Service.id).all()]


@router.post("", status_code=201)
def create_service(body: ServiceCreate, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    if body.type not in SERVICE_TYPES:
        raise HTTPException(400, f"Neznámý typ služby: {body.type}. Povolené: {', '.join(SERVICE_TYPES)}")
    svc = Service(**body.model_dump())
    db.add(svc)
    db.flush()
    if svc.is_default:
        _clear_other_defaults(db, svc.type, svc.id)
    db.commit()
    db.refresh(svc)
    log.info("Created service id=%d name=%r type=%s", svc.id, svc.name, svc.type)
    return _out(svc)


@router.get("/{svc_id}")
def get_service(svc_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    svc = db.query(Service).filter(Service.id == svc_id).first()
    if not svc:
        raise HTTPException(404, "Služba nenalezena")
    return _out(svc)


@router.patch("/{svc_id}")
def update_service(svc_id: int, body: ServiceUpdate, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    svc = db.query(Service).filter(Service.id == svc_id).first()
    if not svc:
        raise HTTPException(404, "Služba nenalezena")
    data = body.model_dump(exclude_none=True)
    # Ignore masked secrets echoed back from the UI — don't overwrite with "••••".
    for secret in ("api_key", "password"):
        if data.get(secret) and data[secret].startswith(_MASK):
            data.pop(secret)
    if data.get("type") and data["type"] not in SERVICE_TYPES:
        raise HTTPException(400, f"Neznámý typ služby: {data['type']}")
    for k, v in data.items():
        setattr(svc, k, v)
    if svc.is_default:
        _clear_other_defaults(db, svc.type, svc.id)
    db.commit()
    db.refresh(svc)
    return _out(svc)


@router.delete("/{svc_id}", status_code=204)
def delete_service(svc_id: int, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    svc = db.query(Service).filter(Service.id == svc_id).first()
    if not svc:
        raise HTTPException(404, "Služba nenalezena")
    # Unlink any libraries pointing at this service so the FK doesn't dangle.
    try:
        from ..models.library import Library
        db.query(Library).filter(Library.sonarr_service_id == svc_id).update({"sonarr_service_id": None})
    except Exception:
        pass
    db.delete(svc)
    db.commit()


# ── test connection ───────────────────────────────────────────────────────────

_TYPE_PROBE = {
    "sonarr":      ("/api/v3/system/status", True),
    "radarr":      ("/api/v3/system/status", True),
    "prowlarr":    ("/api/v1/system/status", True),
    "jackett":     ("/api/v2.0/server/config", False),
    "emby":        ("/System/Info/Public", False),
    "seerr":       ("/api/v1/status", True),
    "qbittorrent": ("/api/v2/app/version", False),
}


@router.post("/{svc_id}/test")
async def test_service(svc_id: int, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    """Test a saved service using its stored credentials — the UI calls this
    when the secret in the form is still the mask (unchanged)."""
    svc = db.query(Service).filter(Service.id == svc_id).first()
    if not svc:
        raise HTTPException(404, "Služba nenalezena")
    return await _probe(svc.type, svc.host or "", svc.api_key or "",
                        svc.username or "", svc.password or "")


class TestBody(BaseModel):
    type: str
    host: Optional[str] = None
    api_key: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None


@router.post("/test")
async def test_unsaved_service(body: TestBody, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    """Test a not-yet-saved connection (used by the 'Test' button in the form)."""
    return await _probe(body.type, body.host or "", body.api_key or "",
                        body.username or "", body.password or "")


async def _probe(service_type: str, host: str, api_key: str,
                 username: str = "", password: str = "") -> dict:
    probe = _TYPE_PROBE.get(service_type)
    if not probe:
        return {"connected": False, "reason": f"Test není podporován pro typ {service_type}"}
    if not host:
        return {"connected": False, "reason": "not_configured"}
    path, needs_key = probe
    base = host.rstrip("/")
    if not base.startswith("http"):
        base = "http://" + base

    # qBittorrent needs a session login (username/password), not an API key —
    # an anonymous GET returns 403 unless the WebUI auth whitelist allows it.
    if service_type == "qbittorrent":
        from .qbittorrent import _qbt_login
        sid, err = await _qbt_login(base, username, password)
        if sid is None:
            return {"connected": False, "reason": err or "Přihlášení selhalo"}
        return {"connected": True}

    headers = {"X-Api-Key": api_key} if (needs_key and api_key) else {}
    try:
        async with httpx.AsyncClient(timeout=6.0) as client:
            r = await client.get(f"{base}{path}", headers=headers, follow_redirects=True)
        if r.status_code == 401:
            return {"connected": False, "reason": "Neplatný API klíč"}
        return {"connected": r.status_code < 400, "status": r.status_code}
    except httpx.ConnectError:
        return {"connected": False, "reason": "Nelze se připojit k hostu"}
    except httpx.TimeoutException:
        return {"connected": False, "reason": "Timeout"}
    except Exception as exc:
        return {"connected": False, "reason": str(exc)}
