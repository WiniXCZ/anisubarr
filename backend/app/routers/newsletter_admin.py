from __future__ import annotations

"""
newsletter_admin.py – Admin-only endpoints for the newsletter feature.

Separate from routers/public.py (unauthenticated, mounted on the public port
too) so that no admin action is ever reachable from the public site's port.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import require_admin
from ..models.user import User

log = logging.getLogger("anisubarr.newsletter_admin")

router = APIRouter(prefix="/api/newsletter", tags=["newsletter"])


@router.get("/subscribers")
def list_subscribers(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    from ..models.newsletter import NewsletterSubscriber
    rows = db.query(NewsletterSubscriber).order_by(NewsletterSubscriber.created_at.desc()).all()
    active = [r for r in rows if r.active]
    return {
        "total":   len(rows),
        "active":  len(active),
        "subscribers": [
            {"id": r.id, "email": r.email, "active": r.active, "created_at": r.created_at}
            for r in rows
        ],
    }


class DigestBody(BaseModel):
    subject: str
    html_body: str


@router.post("/send-digest")
def send_digest(
    body: DigestBody,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """
    Send a manually-composed digest email to every active subscriber.
    Best-effort per recipient — one bad address doesn't stop the rest.
    Each email gets a personal unsubscribe link appended.
    """
    from ..models.newsletter import NewsletterSubscriber
    from ..services.mailer import send_mail, smtp_configured
    from ..routers.settings import _get_setting

    if not smtp_configured(db):
        raise HTTPException(503, "SMTP není nakonfigurován — nastav ho v Nastavení → Veřejný web → Newsletter")

    site_url = (_get_setting(db, "public_site_url") or "").rstrip("/")
    subs = db.query(NewsletterSubscriber).filter(NewsletterSubscriber.active == True).all()  # noqa: E712

    sent, failed = 0, []
    for sub in subs:
        unsub_link = f"{site_url}/unsubscribe?token={sub.unsubscribe_token}" if site_url else None
        html = body.html_body
        if unsub_link:
            html += f'<p style="font-size:11px;color:#888;margin-top:24px">Odhlásit odběr: <a href="{unsub_link}">{unsub_link}</a></p>'
        try:
            send_mail(sub.email, body.subject, html, db=db)
            sent += 1
        except Exception as exc:
            log.warning("send_digest: failed for %s: %s", sub.email, exc)
            failed.append(sub.email)

    return {"sent": sent, "failed": failed, "total": len(subs)}
