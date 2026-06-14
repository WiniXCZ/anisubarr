"""
discord.py – Discord Webhook notification helper for Anisubarr.

Sends rich embed messages to a Discord channel when interesting events occur.
The webhook URL is read from DB settings (discord_webhook_url).
All calls are best-effort — errors are logged but never raised.
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Optional

log = logging.getLogger("anisubarr.discord")

# ── Cross-process deduplication ────────────────────────────────────────────────
# Uses the app_settings DB table as an atomic "claim" so that two uvicorn
# worker processes (from --reload) don't both send the same notification.
_DEDUP_SECONDS = 86400  # 24 hours — prevents repeat notifications for the same event


def _claim_notification(notification_type: str, series_id: int, db) -> bool:
    """
    Atomically claim the right to send this notification.
    Returns True if we should send, False if another process already did.

    Algorithm (SQLite-safe):
      1. DELETE any expired claim for this key
      2. INSERT OR IGNORE a new claim
      3. If INSERT succeeded (rowcount > 0) → we claimed it → send
      4. If INSERT was ignored (rowcount == 0) → already claimed → skip
    """
    if db is None:
        return True  # no DB available, allow send (best-effort)

    try:
        from sqlalchemy import text
        now = time.time()
        key = f"_notif_{notification_type}_{series_id}"
        cutoff = now - _DEDUP_SECONDS

        # Step 1: remove expired claim so the INSERT can fire again after the window
        db.execute(
            text("DELETE FROM app_settings WHERE key = :k AND CAST(value AS REAL) <= :cut"),
            {"k": key, "cut": cutoff},
        )
        # Step 2: try to claim; OR IGNORE means only the first concurrent writer wins
        result = db.execute(
            text("INSERT OR IGNORE INTO app_settings (key, value) VALUES (:k, :v)"),
            {"k": key, "v": str(now)},
        )
        db.commit()
        won = result.rowcount > 0
        if not won:
            log.debug("Discord dedup: skipping '%s' series_id=%s (already claimed)", notification_type, series_id)
        return won
    except Exception:
        return True  # on any error, allow send


# ── Colour constants (decimal) ────────────────────────────────────────────────
_COLOR_PROMOTED  = 0x57F287   # green
_COLOR_DEMOTED   = 0xED4245   # red
_COLOR_ISSUE     = 0xFEE75C   # yellow
_COLOR_INFO      = 0x5865F2   # blurple
_COLOR_SUCCESS   = 0x2ECC71   # green
_COLOR_WARNING   = 0xE67E22   # orange
_COLOR_ERROR     = 0xE74C3C   # red


# ── Config helpers ─────────────────────────────────────────────────────────────

def _get_db_setting(key: str, db=None) -> str | None:
    """Return a setting value from DB with optional session reuse."""
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


def _webhook_url(db=None) -> str | None:
    v = _get_db_setting("discord_webhook_url", db)
    return v.strip() if v and v.strip() else None


def _is_enabled(toggle_key: str, db=None) -> bool:
    """Return True if a discord_notify_* toggle is enabled (default: True)."""
    v = _get_db_setting(toggle_key, db)
    # If not set, default to enabled
    if v is None:
        return True
    return v.lower() == "true"


def _message_prefix(db=None) -> str:
    v = _get_db_setting("discord_message_prefix", db)
    return v.strip() if v and v.strip() else "[Anisubarr]"


def _emby_play_url(db=None, emby_id: str | None = None) -> str | None:
    """
    Return Emby URL for the 'Přehrát' link.

    If *emby_id* is provided, returns a deep link directly to that item:
      {emby_external_url}/web/index.html#!/item?id={emby_id}
    Otherwise falls back to the Emby homepage (emby_external_url).
    Returns None if emby_external_url is not configured.
    """
    v = _get_db_setting("emby_external_url", db)
    if not v or not v.strip():
        return None
    base = v.strip().rstrip("/")
    if emby_id:
        return f"{base}/web/index.html#!/item?id={emby_id}"
    return base


def _use_embed(db=None) -> bool:
    v = _get_db_setting("discord_use_embed", db)
    if v is None:
        return True
    return v.lower() == "true"


def _error_role_id(db=None) -> str | None:
    v = _get_db_setting("discord_error_role_id", db)
    return v.strip() if v and v.strip() else None


def _now_ts() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Low-level send ────────────────────────────────────────────────────────────

def _send_embed(webhook_url: str, embed: dict, content: str | None = None) -> None:
    """POST a single embed to Discord. Raises on HTTP error."""
    import httpx
    payload: dict = {"embeds": [embed]}
    if content:
        payload["content"] = content
    r = httpx.post(webhook_url, json=payload, timeout=10)
    r.raise_for_status()


def _send_plain(webhook_url: str, text: str) -> None:
    """POST a plain text message to Discord."""
    import httpx
    r = httpx.post(webhook_url, json={"content": text}, timeout=10)
    r.raise_for_status()


def _build_footer(extra: str = "") -> dict:
    label = "Anisubarr"
    if extra:
        label += f" · {extra}"
    return {"text": label}


# ── Internal dispatch ──────────────────────────────────────────────────────────

def _dispatch(
    toggle_key: str,
    embed: dict,
    plain_text: str,
    mention_content: str | None = None,
    db=None,
) -> None:
    """Check toggle + webhook, then send embed or plain text depending on setting."""
    if not _is_enabled(toggle_key, db):
        return
    url = _webhook_url(db)
    if not url:
        return
    try:
        if _use_embed(db):
            _send_embed(url, embed, content=mention_content)
        else:
            prefix = _message_prefix(db)
            msg = f"{prefix} {plain_text}"
            if mention_content:
                msg = f"{mention_content}\n{msg}"
            _send_plain(url, msg)
    except Exception as exc:
        log.warning("Discord dispatch selhalo (toggle=%s): %s", toggle_key, exc)


# ── Public notification helpers ───────────────────────────────────────────────

def notify_promoted(
    *,
    title: str,
    series_id: int,
    poster_url: Optional[str] = None,
    overview: Optional[str] = None,
    has_cs: bool = True,
    emby_id: Optional[str] = None,
    db=None,
) -> None:
    if not _claim_notification("promoted", series_id, db):
        return
    prefix = _message_prefix(db)
    desc = (overview[:300] + "…" if overview and len(overview) > 300 else overview or "")
    desc = desc or "Všechny epizody mají CZ titulky — série přesunuta do knihovny."
    emby_url = _emby_play_url(db, emby_id=emby_id)
    if emby_url:
        desc += f"\n\n[▶ Přehrát]({emby_url})"
    embed: dict = {
        "title":       f"✅ Povýšeno: {title}",
        "description": desc,
        "color":       _COLOR_PROMOTED,
        "fields":      [{"name": "CZ titulky", "value": "✅ Kompletní" if has_cs else "⚠️ Chybí", "inline": True}],
        "footer":      _build_footer("Promotion"),
        "timestamp":   _now_ts(),
    }
    if poster_url:
        embed["thumbnail"] = {"url": poster_url}
    _dispatch("discord_notify_promoted", embed, f"✅ Povýšeno: {title}", db=db)
    log.info("Discord: povýšení odesláno pro '%s'", title)


def notify_demoted(
    *,
    title: str,
    series_id: int,
    reason: Optional[str] = None,
    poster_url: Optional[str] = None,
    seerr_url: Optional[str] = None,
    overseerr_url: Optional[str] = None,  # backward compat alias
    db=None,
) -> None:
    if not _claim_notification("demoted", series_id, db):
        return
    role_id = _error_role_id(db)
    mention = f"<@&{role_id}>" if role_id else None
    issue_url = seerr_url or overseerr_url
    desc = reason or "Série má otevřenou issue v Seerr a byla vrácena do neúplné složky."
    if issue_url:
        desc += f"\n\n🔗 [Otevřít issue v Seerr]({issue_url})"
    embed: dict = {
        "title":       f"⚠️ Degradováno: {title}",
        "description": desc,
        "color":       _COLOR_DEMOTED,
        "footer":      _build_footer("Demotion"),
        "timestamp":   _now_ts(),
    }
    if poster_url:
        embed["thumbnail"] = {"url": poster_url}
    _dispatch("discord_notify_demoted", embed, f"⚠️ Degradováno: {title}", mention_content=mention, db=db)
    log.info("Discord: degradace odesláno pro '%s'", title)


def notify_issue_flagged(
    *,
    title: str,
    series_id: int,
    poster_url: Optional[str] = None,
    seerr_url: Optional[str] = None,
    overseerr_url: Optional[str] = None,  # backward compat alias
    db=None,
) -> None:
    if not _claim_notification("issue_flagged", series_id, db):
        return
    role_id = _error_role_id(db)
    mention = f"<@&{role_id}>" if role_id else None
    issue_url = seerr_url or overseerr_url
    desc = "Série má otevřenou issue v Seerr."
    if issue_url:
        desc += f"\n\n🔗 [Otevřít issue]({issue_url})"
    embed: dict = {
        "title":       f"🚩 Issue: {title}",
        "description": desc,
        "color":       _COLOR_ISSUE,
        "footer":      _build_footer("Issue"),
        "timestamp":   _now_ts(),
    }
    if poster_url:
        embed["thumbnail"] = {"url": poster_url}
    _dispatch("discord_notify_issue_flagged", embed, f"🚩 Issue: {title}", mention_content=mention, db=db)
    log.info("Discord: issue flag odesláno pro '%s'", title)


def notify_new_series(
    *,
    title: str,
    series_id: int,
    poster_url: Optional[str] = None,
    overview: Optional[str] = None,
    db=None,
) -> None:
    """Called when a new series is added via Sonarr sync."""
    desc = (overview[:300] + "…" if overview and len(overview) > 300 else overview or "") or "Nová série přidána do sledování."
    embed: dict = {
        "title":       f"🆕 Nová série: {title}",
        "description": desc,
        "color":       _COLOR_INFO,
        "footer":      _build_footer("Sonarr Sync"),
        "timestamp":   _now_ts(),
    }
    if poster_url:
        embed["thumbnail"] = {"url": poster_url}
    _dispatch("discord_notify_new_series", embed, f"🆕 Nová série: {title}", db=db)
    log.info("Discord: nová série '%s'", title)


def notify_subtitles_downloaded(
    *,
    title: str,
    episode: str | None = None,
    source: str | None = None,
    emby_id: Optional[str] = None,
    db=None,
) -> None:
    """Called when subtitles are successfully downloaded."""
    ep_info = f" — {episode}" if episode else ""
    src_info = f" ze zdroje **{source}**" if source else ""
    emby_url = _emby_play_url(db, emby_id=emby_id)
    play_link = f"\n\n[▶ Přehrát]({emby_url})" if emby_url else ""
    embed: dict = {
        "title":       f"💬 Titulky staženy: {title}{ep_info}",
        "description": f"CZ titulky úspěšně staženy{src_info}.{play_link}",
        "color":       _COLOR_SUCCESS,
        "footer":      _build_footer("Subtitles"),
        "timestamp":   _now_ts(),
    }
    _dispatch("discord_notify_subtitles_downloaded", embed, f"💬 Titulky staženy: {title}{ep_info}", db=db)


def notify_subtitles_missing(
    *,
    title: str,
    episode: str | None = None,
    attempts: int = 0,
    db=None,
) -> None:
    """Called when subtitles cannot be found after max attempts."""
    role_id = _error_role_id(db)
    mention = f"<@&{role_id}>" if role_id else None
    ep_info = f" — {episode}" if episode else ""
    desc = f"Po {attempts} pokusech nebyly nalezeny CZ titulky." if attempts else "CZ titulky nebyly nalezeny."
    embed: dict = {
        "title":       f"❌ Titulky nenalezeny: {title}{ep_info}",
        "description": desc,
        "color":       _COLOR_WARNING,
        "footer":      _build_footer("Subtitles"),
        "timestamp":   _now_ts(),
    }
    _dispatch("discord_notify_subtitles_missing", embed, f"❌ Titulky nenalezeny: {title}{ep_info}", mention_content=mention, db=db)


def notify_nfo_generated(
    *,
    title: str,
    count: int = 1,
    db=None,
) -> None:
    """Called when NFO files are generated."""
    embed: dict = {
        "title":       f"📄 NFO vygenerováno: {title}",
        "description": f"Vygenerováno {count} NFO soubor{'ů' if count != 1 else ''}.",
        "color":       _COLOR_INFO,
        "footer":      _build_footer("NFO"),
        "timestamp":   _now_ts(),
    }
    _dispatch("discord_notify_nfo", embed, f"📄 NFO vygenerováno: {title}", db=db)


def notify_scraper_error(
    *,
    title: str,
    scraper: str,
    error: str,
    db=None,
) -> None:
    """Called when a scraper fails to find subtitles."""
    embed: dict = {
        "title":       f"⚠ Chyba scraperu: {title}",
        "description": f"Scraper **{scraper}** hlásí chybu: {error}",
        "color":       _COLOR_ERROR,
        "footer":      _build_footer("Scraper"),
        "timestamp":   _now_ts(),
    }
    _dispatch("discord_notify_scraper_error", embed, f"⚠ Chyba scraperu: {title}", db=db)
    log.info("Discord: scraper_error odesláno pro '%s'", title)
