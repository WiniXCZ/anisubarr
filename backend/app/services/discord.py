"""
discord.py – Discord Webhook notification helper for Anisubarr.

Sends rich embed messages to a Discord channel when a series is promoted
or demoted.  The webhook URL is read from DB settings (discord_webhook_url).
All calls are best-effort — errors are logged but never raised.
"""
from __future__ import annotations

import logging
from typing import Optional

log = logging.getLogger("anisubarr.discord")


# ── Colour constants (decimal) ────────────────────────────────────────────────
_COLOR_PROMOTED = 0x57F287   # green
_COLOR_DEMOTED  = 0xED4245   # red
_COLOR_ISSUE    = 0xFEE75C   # yellow/orange


# ── Config helper ─────────────────────────────────────────────────────────────

def _webhook_url(db=None) -> str | None:
    """Return the configured Discord webhook URL, or None if not set."""
    try:
        if db is not None:
            from ..routers.settings import _get_setting
            url = _get_setting(db, "discord_webhook_url")
            if url and url.strip():
                return url.strip()
        # Fallback: read directly from DB without a passed session
        from ..database import SessionLocal
        _db = SessionLocal()
        try:
            from ..models.app_settings import AppSetting
            row = _db.query(AppSetting).filter(AppSetting.key == "discord_webhook_url").first()
            return (row.value or "").strip() or None
        finally:
            _db.close()
    except Exception:
        return None


# ── Low-level send ────────────────────────────────────────────────────────────

def _send_embed(webhook_url: str, embed: dict) -> None:
    """POST a single embed to Discord. Raises on HTTP error."""
    import httpx
    r = httpx.post(
        webhook_url,
        json={"embeds": [embed]},
        timeout=10,
    )
    r.raise_for_status()


# ── Public notification helpers ───────────────────────────────────────────────

def notify_promoted(
    *,
    title: str,
    series_id: int,
    poster_url: Optional[str] = None,
    overview: Optional[str] = None,
    has_cs: bool = True,
    db=None,
) -> None:
    """
    Send a Discord notification that an anime series was promoted
    (all episodes downloaded + all CZ subtitles present → moved to anime_series).
    """
    url = _webhook_url(db)
    if not url:
        return
    try:
        embed: dict = {
            "title":       f"✅ Povýšeno: {title}",
            "description": (
                (overview[:300] + "…" if overview and len(overview) > 300 else overview or "")
                or "Všechny epizody mají CZ titulky — série přesunuta do knihovny."
            ),
            "color":  _COLOR_PROMOTED,
            "fields": [
                {
                    "name":   "CZ titulky",
                    "value":  "✅ Kompletní" if has_cs else "⚠️ Chybí",
                    "inline": True,
                },
            ],
            "footer": {"text": "Anisubarr · Promotion"},
        }
        if poster_url:
            embed["thumbnail"] = {"url": poster_url}
        _send_embed(url, embed)
        log.info("Discord: povýšení odesláno pro '%s'", title)
    except Exception as exc:
        log.warning("Discord notify_promoted selhalo pro '%s': %s", title, exc)


def notify_demoted(
    *,
    title: str,
    series_id: int,
    reason: Optional[str] = None,
    poster_url: Optional[str] = None,
    overseerr_url: Optional[str] = None,
    db=None,
) -> None:
    """
    Send a Discord notification that an anime series was demoted
    (open Overseerr issue detected → moved back to incomplete folder).
    """
    url = _webhook_url(db)
    if not url:
        return
    try:
        desc = reason or "Série má otevřenou issue v Overseerru a byla vrácena do neúplné složky."
        if overseerr_url:
            desc += f"\n\n🔗 [Otevřít issue v Overseerru]({overseerr_url})"

        embed: dict = {
            "title":       f"⚠️ Degradováno: {title}",
            "description": desc,
            "color":       _COLOR_DEMOTED,
            "footer":      {"text": "Anisubarr · Demotion"},
        }
        if poster_url:
            embed["thumbnail"] = {"url": poster_url}
        _send_embed(url, embed)
        log.info("Discord: degradace odesláno pro '%s'", title)
    except Exception as exc:
        log.warning("Discord notify_demoted selhalo pro '%s': %s", title, exc)


def notify_issue_flagged(
    *,
    title: str,
    series_id: int,
    poster_url: Optional[str] = None,
    overseerr_url: Optional[str] = None,
    db=None,
) -> None:
    """
    Send a notification that a series has been flagged with an open issue
    (but not moved, e.g. because the incomplete folder wasn't found).
    """
    url = _webhook_url(db)
    if not url:
        return
    try:
        desc = "Série má otevřenou issue v Overseerru."
        if overseerr_url:
            desc += f"\n\n🔗 [Otevřít issue]({overseerr_url})"

        embed: dict = {
            "title":       f"🚩 Issue: {title}",
            "description": desc,
            "color":       _COLOR_ISSUE,
            "footer":      {"text": "Anisubarr · Issue"},
        }
        if poster_url:
            embed["thumbnail"] = {"url": poster_url}
        _send_embed(url, embed)
        log.info("Discord: issue flag odesláno pro '%s'", title)
    except Exception as exc:
        log.warning("Discord notify_issue_flagged selhalo pro '%s': %s", title, exc)
