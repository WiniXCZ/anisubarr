"""
mailer.py – Minimal SMTP mailer for the newsletter feature.

Reads SMTP config from DB settings (smtp_host/port/username/password/from_email/use_tls),
same DB-first-then-nothing pattern as the rest of the settings system — there is no
.env fallback for these since they're new and publish-safe (no personal defaults baked in).
Best-effort: callers should catch exceptions and report them rather than crash a request.
"""
from __future__ import annotations

import logging
import smtplib
from email.message import EmailMessage

log = logging.getLogger("anisubarr.mailer")


def _cfg(key: str, db=None) -> str | None:
    try:
        if db is not None:
            from ..routers.settings import _get_setting
            return _get_setting(db, key)
        from ..database import SessionLocal
        _db = SessionLocal()
        try:
            from ..models.app_settings import AppSetting
            row = _db.query(AppSetting).filter(AppSetting.key == key).first()
            return (row.value or "").strip() or None
        finally:
            _db.close()
    except Exception:
        return None


def smtp_configured(db=None) -> bool:
    return bool(_cfg("smtp_host", db) and _cfg("smtp_from_email", db))


def send_mail(to_addr: str, subject: str, html_body: str, db=None) -> None:
    """
    Send a single HTML email via the configured SMTP server.
    Raises on failure (missing config, connection error, auth error) — callers
    that shouldn't hard-fail (e.g. a bulk digest send) should catch per-recipient.
    """
    host = _cfg("smtp_host", db)
    if not host:
        raise RuntimeError("SMTP není nakonfigurován — nastav ho v Nastavení → Připojení → Newsletter")
    port = int(_cfg("smtp_port", db) or "587")
    username = _cfg("smtp_username", db) or ""
    password = _cfg("smtp_password", db) or ""
    from_email = _cfg("smtp_from_email", db) or username
    use_tls = (_cfg("smtp_use_tls", db) or "true").lower() != "false"

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = from_email
    msg["To"] = to_addr
    msg.set_content("Tento email vyžaduje HTML klienta.")
    msg.add_alternative(html_body, subtype="html")

    with smtplib.SMTP(host, port, timeout=15) as server:
        if use_tls:
            server.starttls()
        if username:
            server.login(username, password)
        server.send_message(msg)


def send_test_mail(to_addr: str, db=None) -> None:
    send_mail(
        to_addr,
        subject="Testovací email — Anisubarr",
        html_body="<p>Pokud vidíš tuhle zprávu, SMTP nastavení funguje.</p>",
        db=db,
    )
