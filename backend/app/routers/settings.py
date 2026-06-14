from __future__ import annotations

"""
settings.py – Runtime-editable application settings.

Endpoints:
  GET  /api/settings              → vrátí nastavitelná pole (DB override .env, hesla maskovaná)
  PUT  /api/settings              → uloží změny do DB (vyžaduje admin)
  POST /api/settings/test/{svc}  → otestuje připojení ke službě
"""

import os

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import get_db
from ..deps import get_current_user, require_admin
from ..models.app_settings import AppSetting
from ..models.user import User

router = APIRouter(prefix="/api/settings", tags=["settings"])

# ── Whitelist editovatelných klíčů ────────────────────────────────────────────

EDITABLE_KEYS: set[str] = {
    "sonarr_host", "sonarr_api_key",
    "seerr_host", "seerr_api_key", "seerr_external_url",
    "emby_host", "emby_api_key", "emby_external_url",
    "smb_host", "smb_username", "smb_password",
    # ── AI translation ────────────────────────────────────────────────────
    "ai_translation_provider",  # active provider: deepseek/openrouter/localai/ollama/claude
    "deepseek_api_key", "deepseek_model",
    "openrouter_api_key", "openrouter_model",
    "localai_url", "localai_model", "localai_api_key",
    "ollama_host", "ollama_model",
    "anthropic_api_key",
    "qbittorrent_url", "qbittorrent_host", "qbittorrent_username", "qbittorrent_password",
    "hiyori_username", "hiyori_password",
    "hns_username", "hns_password",
    "kamui_username", "kamui_password", "kamui_rar_password",
    "gensubs_username", "gensubs_password",
    "tvdb_api_key", "tvdb_pin",
    "webhook_secret",
    "discord_webhook_url",
    # Discord notification toggles
    "discord_notify_new_series",
    "discord_notify_subtitles_downloaded",
    "discord_notify_subtitles_missing",
    "discord_notify_promoted",
    "discord_notify_demoted",
    "discord_notify_issue_flagged",
    "discord_notify_nfo",
    "discord_notify_scraper_error",
    # Discord message formatting
    "discord_message_prefix",
    "discord_use_embed",
    "discord_error_role_id",
    "media_root",
    # Rate limits (seconds between subtitle download requests)
    "subtitle_download_delay",
    # ── Subtitle processing (Sub-Zero style) ──────────────────────────
    "subtitle_encode_utf8",            # bool — re-encode to UTF-8 after download
    "subtitle_treat_embedded_as_dl",   # bool — skip download if embedded CS track exists
    "subtitle_ignore_embedded_pgs",    # bool — ignore PGS (image) embedded tracks
    "subtitle_ignore_embedded_vobsub", # bool — ignore VobSub (image) embedded tracks
    "subtitle_ignore_embedded_ass",    # bool — ignore ASS embedded tracks
    "subtitle_remove_tags",            # bool — strip HTML/ASS style tags
    "subtitle_remove_emoji",           # bool — remove emoji & music symbols
    "subtitle_ocr_fixes",              # bool — fix OCR artefacts (smart quotes, dashes…)
    "subtitle_common_fixes",           # bool — collapse whitespace, trailing spaces
    # ── alass sync settings ───────────────────────────────────────────
    "subtitle_auto_sync",              # bool — run alass automatically after every download
    "alass_use_audio_reference",       # bool — use audio track as sync reference
    "alass_no_fix_framerate",          # bool — skip framerate mismatch correction
    "alass_golden_section_search",     # bool — use golden-section search
    "alass_max_offset_seconds",        # int  — max allowed timing offset (default 60)
    # ── AI provider order & enabled state ───────────────────────────────────────
    "ai_provider_order",               # JSON — [{id,enabled},...] priority + on/off per provider
    # ── Provider priority & behaviour ────────────────────────────────────
    "subtitle_provider_priority",      # str  — comma-separated provider order, e.g. "hiyori,hns,kamui,gensubs"
    "subtitle_skip_external_links",    # bool — skip "direct" source results in bulk download
    # ── Subtitle defaults ────────────────────────────────────────────────
    "subtitle_preferred_language",     # str  — cs / sk / cs,sk
    "subtitle_preferred_format",       # str  — srt / ass / vtt
    "subtitle_post_download_action",   # str  — none / auto_sync / rename
    "subtitle_auto_download_on_grab",  # bool — auto-download after Sonarr Download webhook
    "subtitle_preferred_provider",     # str  — hiyori / hns / kamui / gensubs / any
    # ── Scraper behaviour ────────────────────────────────────────────────
    "scraper_timeout",                 # int  — HTTP timeout in seconds (default 30)
    "scraper_max_results",             # int  — max results per provider (0 = unlimited)
    "scraper_provider_order",          # str  — fallback order, e.g. "hiyori,hns,kamui,gensubs"
    # ── NFO & Emby ───────────────────────────────────────────────────────
    "nfo_auto_generate_on_add",        # bool — auto-generate NFO when new series is added
    "nfo_auto_refresh_after_promo",    # bool — auto-refresh NFO after promotion
    # ── Sonarr behaviour ─────────────────────────────────────────────────
    "sonarr_auto_unmonitor_after_download",  # bool — unmonitor episode after subtitle download
    # ── General ──────────────────────────────────────────────────────────
    "app_timezone",                    # str  — timezone for schedule/calendar (e.g. Europe/Prague)
    "schedule_days_ahead",             # int  — days ahead shown in schedule (default 7, range 3-30)
    # ── Promotion rules ───────────────────────────────────────────────────
    "promo_min_subtitle_pct",          # int  — min % of episodes with CS subs (default 80)
    "promo_count_from",                # str  — all / aired (default aired)
    "promo_require_cs_only",           # bool — require strictly CS subs, not SK/EN (default false)
    "promo_require_alass",             # bool — require alass sync before promotion (default false)
    "promo_min_episodes",              # int  — min absolute episode count with subs (default 1)
    # ── Demotion rules ────────────────────────────────────────────────────
    "demote_on_episode_error",         # str  — never / flag_only / after_x_episodes (default flag_only)
    "demote_episode_threshold",        # int  — episodes needed for after_x_episodes mode (default 3)
    "demote_on_full_series_missing",   # bool — demote if series has zero CS subs (default true)
    "demote_protect_completed",        # bool — protect ended series with ≥50% CS subs (default true)
    "demote_cooldown_hours",           # int  — hours to wait after promotion before allowing demote (default 24)
    "demote_on_seerr_report",          # bool — auto-demote when Seerr reports an issue (default true)
    "demote_single_episode_action",    # str  — flag_only / demote — action when exactly 1 ep missing (default flag_only)
    "demote_multi_episode_threshold",  # int  — middle-ep count threshold for continuing series (default 2)
    "demote_completed_threshold",      # int  — missing-ep count threshold for ended/completed series (default 2)
    "demote_pct_threshold",            # int  — % of missing eps that always triggers demotion (default 10)
    "demote_allow_last_episode_missing", # bool — tolerate last ep missing subs for airing series (default true)
    "promo_allow_last_episode_missing",  # bool — tolerate last ep missing subs when evaluating promotion (default true)
    # ── Seerr cache ────────────────────────────────────────────────────────────
    "seerr_sync_interval",             # int  — sync interval in minutes (5/10/15/30, default 10)
    # ── Automatické úlohy — event triggers ─────────────────────────────────────
    "auto_emby_scan_on_promote",       # bool — Emby scan after auto-promotion (default true)
    "auto_nfo_on_promote",             # bool — regenerate NFO after promotion (default true)
    "auto_discord_on_promote",         # bool — Discord notification after promotion (default true)
    "auto_alass_on_download",          # bool — run alass after subtitle download (default false)
    "auto_discord_on_subtitles",       # bool — Discord notification after subtitle download (default true)
    "auto_subtitle_search_on_grab",    # bool — auto-search subtitles after Sonarr grab (default false)
    "auto_promote_check_on_sync",      # bool — check promotion eligibility after Sonarr sync (default true)
    "auto_seerr_issue_on_error",       # bool — auto-report Seerr issue on subtitle error (default false)
}

# Klíče jejichž hodnoty se maskují (zobrazí jen posledních 4 znaků)
_SECRET_KEYS: set[str] = {
    "sonarr_api_key", "seerr_api_key", "emby_api_key",
    "smb_password", "hiyori_password", "hns_password", "webhook_secret",
    "discord_webhook_url",
    "kamui_password", "kamui_rar_password",
    "gensubs_password",
    "tvdb_api_key", "tvdb_pin",
    "anthropic_api_key",
    "deepseek_api_key",
    "openrouter_api_key",
    "localai_api_key",
    "qbittorrent_password",
}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_setting(db: Session, key: str) -> str | None:
    """Vrátí hodnotu z DB, nebo fallback z config/.env."""
    row = db.query(AppSetting).filter(AppSetting.key == key).first()
    if row is not None and row.value is not None:
        return row.value
    return getattr(get_settings(), key, None)


def _mask(value: str | None) -> str:
    """Maskuje citlivou hodnotu — vrátí jen poslední 4 znaky."""
    if not value:
        return ""
    if len(value) <= 4:
        return "••••"
    return "••••••••" + value[-4:]


# ── Subtitle post-processing config helper ────────────────────────────────────

def get_subtitle_postprocess_cfg(db: Session) -> dict:
    """Return dict of subtitle post-processing flags, read from DB settings."""
    bool_keys = [
        "subtitle_encode_utf8",
        "subtitle_remove_tags",
        "subtitle_remove_emoji",
        "subtitle_ocr_fixes",
        "subtitle_common_fixes",
    ]
    cfg = {}
    for key in bool_keys:
        raw = _get_setting(db, key)
        cfg[key.replace("subtitle_", "")] = raw == "true"
    return cfg


def get_subtitle_behavior_cfg(db: Session) -> dict:
    """Return dict controlling subtitle detection/download behaviour."""
    return {
        "treat_embedded_as_dl":   _get_setting(db, "subtitle_treat_embedded_as_dl")   == "true",
        "ignore_embedded_pgs":    _get_setting(db, "subtitle_ignore_embedded_pgs")    == "true",
        "ignore_embedded_vobsub": _get_setting(db, "subtitle_ignore_embedded_vobsub") == "true",
        "ignore_embedded_ass":    _get_setting(db, "subtitle_ignore_embedded_ass")    == "true",
    }


# ── GET /api/settings ─────────────────────────────────────────────────────────

@router.get("")
def get_all_settings(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> dict:
    """Vrátí všechna editovatelná nastavení. Tajné hodnoty jsou maskovány."""
    # Load all DB rows in one query instead of one query per key
    db_rows = {
        row.key: row.value
        for row in db.query(AppSetting).filter(AppSetting.key.in_(EDITABLE_KEYS)).all()
    }
    cfg = get_settings()
    result: dict[str, str] = {}
    for key in sorted(EDITABLE_KEYS):
        raw = db_rows.get(key)
        if raw is None:
            raw = getattr(cfg, key, None)
        if key in _SECRET_KEYS:
            result[key] = _mask(raw)
        else:
            result[key] = raw or ""
    return result


# ── PUT /api/settings ─────────────────────────────────────────────────────────

@router.put("")
def save_settings(
    body: dict,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> dict:
    """Uloží zadané klíče do DB. Pouze whitelisted klíče jsou přijaty."""
    unknown = set(body.keys()) - EDITABLE_KEYS
    if unknown:
        raise HTTPException(400, f"Nepovolené klíče: {sorted(unknown)}")

    saved: list[str] = []
    for key, value in body.items():
        # Prázdný string = smazat DB override (fallback na .env)
        if value == "" or value is None:
            db.query(AppSetting).filter(AppSetting.key == key).delete()
        else:
            row = db.query(AppSetting).filter(AppSetting.key == key).first()
            if row:
                row.value = str(value)
            else:
                db.add(AppSetting(key=key, value=str(value)))
        saved.append(key)

    db.commit()

    # If seerr_sync_interval changed, update the ScheduledJob and reload the scheduler job
    if "seerr_sync_interval" in saved:
        try:
            minutes_str = body.get("seerr_sync_interval", "10") or "10"
            minutes = max(1, int(str(minutes_str)))
            from ..models.schedule import ScheduledJob
            from ..services import scheduler as sched_svc
            row = db.query(ScheduledJob).filter(ScheduledJob.job_id == "seerr_sync").first()
            if row:
                row.interval = f"{minutes}min"
                db.commit()
                sched_svc.reload_job("seerr_sync")
        except Exception:
            pass

    return {
        "saved": saved,
        "message": "Nastavení uloženo. Změny klíčů/hostů se projeví po restartu serveru.",
    }


# ── POST /api/settings/test/{service} ─────────────────────────────────────────

@router.post("/test/{service}")
async def test_connection(
    service: str,
    body: dict | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> dict:
    """Otestuje připojení ke službě.

    Body (volitelné) — umožňuje testovat neuložené hodnoty:
      { "host": "http://...", "api_key": "..." }
    Pokud body není poskytnuto, použijí se hodnoty z DB / .env.
    """
    body = body or {}

    if service == "sonarr":
        return await _test_sonarr(body, db)
    elif service in ("seerr", "overseerr"):
        return await _test_seerr(body, db)
    elif service == "emby":
        return await _test_emby(body, db)
    elif service == "smb":
        return _test_smb(body, db)
    elif service == "deepseek":
        return await _test_deepseek(body, db)
    elif service == "openrouter":
        return await _test_openrouter(body, db)
    elif service == "localai":
        return await _test_localai(body, db)
    elif service == "ollama":
        return await _test_ollama(body, db)
    elif service == "claude":
        return await _test_claude(body, db)
    elif service == "discord":
        return await _test_discord(body, db)
    elif service == "qbittorrent":
        from .qbittorrent import get_status as _qbt_status
        # Dočasně uložíme url/username/password do DB session pro test
        return await _qbt_status_with_body(body, db)
    else:
        raise HTTPException(400, f"Neznámá služba: {service}")


# ── Test helpers ──────────────────────────────────────────────────────────────

async def _test_sonarr(body: dict, db: Session) -> dict:
    host    = body.get("host") or _get_setting(db, "sonarr_host") or ""
    api_key = body.get("api_key") or _get_setting(db, "sonarr_api_key") or ""

    if not host or not api_key:
        return {"connected": False, "reason": "not_configured"}

    # Normalize host — přidej http:// pokud chybí
    if not host.startswith("http"):
        host = "http://" + host

    url = host.rstrip("/") + "/api/v3/health"
    try:
        async with httpx.AsyncClient(timeout=6.0) as client:
            resp = await client.get(url, headers={"X-Api-Key": api_key})
        if resp.status_code == 401:
            return {"connected": False, "reason": "Neplatný API klíč"}
        resp.raise_for_status()
        data = resp.json()
        issues = [i for i in (data if isinstance(data, list) else []) if i.get("type") == "error"]
        return {
            "connected": True,
            "version": resp.headers.get("X-Sonarr-Version") or "?",
            "issues": len(issues),
        }
    except httpx.ConnectError:
        return {"connected": False, "reason": "Nelze se připojit k hostu"}
    except httpx.TimeoutException:
        return {"connected": False, "reason": "Timeout"}
    except Exception as exc:
        return {"connected": False, "reason": str(exc)}


async def _test_seerr(body: dict, db: Session) -> dict:
    host    = body.get("host") or _get_setting(db, "seerr_host") or ""
    api_key = body.get("api_key") or _get_setting(db, "seerr_api_key") or ""

    if not host or not api_key:
        return {"connected": False, "reason": "not_configured"}

    url = host.rstrip("/") + "/api/v1/status"
    try:
        async with httpx.AsyncClient(timeout=6.0) as client:
            resp = await client.get(url, headers={"X-Api-Key": api_key})
        if resp.status_code == 401:
            return {"connected": False, "reason": "Neplatný API klíč"}
        resp.raise_for_status()
        data = resp.json()
        return {"connected": True, "version": data.get("version", "?")}
    except httpx.ConnectError:
        return {"connected": False, "reason": "Nelze se připojit k hostu"}
    except httpx.TimeoutException:
        return {"connected": False, "reason": "Timeout"}
    except Exception as exc:
        return {"connected": False, "reason": str(exc)}


async def _test_emby(body: dict, db: Session) -> dict:
    host    = body.get("host") or _get_setting(db, "emby_host") or ""
    api_key = body.get("api_key") or _get_setting(db, "emby_api_key") or ""

    if not host:
        return {"connected": False, "reason": "not_configured"}

    url = host.rstrip("/") + "/System/Info/Public"
    try:
        async with httpx.AsyncClient(timeout=6.0) as client:
            resp = await client.get(url)
        resp.raise_for_status()
        data = resp.json()
        return {
            "connected": True,
            "version": data.get("Version"),
            "server_name": data.get("ServerName"),
        }
    except httpx.ConnectError:
        return {"connected": False, "reason": "Nelze se připojit k hostu"}
    except httpx.TimeoutException:
        return {"connected": False, "reason": "Timeout"}
    except Exception as exc:
        return {"connected": False, "reason": str(exc)}


async def _test_deepseek(body: dict, db: Session) -> dict:
    api_key = body.get("api_key") or _get_setting(db, "deepseek_api_key") or ""

    if not api_key:
        return {"connected": False, "reason": "not_configured"}

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(
                "https://api.deepseek.com/models",
                headers={"Authorization": f"Bearer {api_key}"},
            )
        if resp.status_code == 401:
            return {"connected": False, "reason": "Neplatný API klíč"}
        resp.raise_for_status()
        return {"connected": True, "model": "deepseek-chat"}
    except httpx.ConnectError:
        return {"connected": False, "reason": "Nelze se připojit k api.deepseek.com"}
    except httpx.TimeoutException:
        return {"connected": False, "reason": "Timeout"}
    except Exception as exc:
        return {"connected": False, "reason": str(exc)}


async def _test_openrouter(body: dict, db: Session) -> dict:
    api_key = body.get("api_key") or _get_setting(db, "openrouter_api_key") or ""
    if not api_key:
        return {"connected": False, "reason": "not_configured"}
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(
                "https://openrouter.ai/api/v1/models",
                headers={"Authorization": f"Bearer {api_key}"},
            )
        if resp.status_code == 401:
            return {"connected": False, "reason": "Neplatný API klíč"}
        resp.raise_for_status()
        count = len(resp.json().get("data", []))
        return {"connected": True, "models": count}
    except httpx.ConnectError:
        return {"connected": False, "reason": "Nelze se připojit k openrouter.ai"}
    except httpx.TimeoutException:
        return {"connected": False, "reason": "Timeout"}
    except Exception as exc:
        return {"connected": False, "reason": str(exc)}


async def _test_localai(body: dict, db: Session) -> dict:
    url = (body.get("url") or _get_setting(db, "localai_url") or "").rstrip("/")
    api_key = body.get("api_key") or _get_setting(db, "localai_api_key") or ""
    if not url:
        return {"connected": False, "reason": "not_configured"}
    if not url.startswith("http"):
        url = "http://" + url
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(f"{url}/v1/models", headers=headers)
        if resp.status_code == 401:
            return {"connected": False, "reason": "Neplatný API klíč"}
        resp.raise_for_status()
        models = [m.get("id", "?") for m in resp.json().get("data", [])[:5]]
        return {"connected": True, "models": models}
    except httpx.ConnectError:
        return {"connected": False, "reason": "Nelze se připojit k LocalAI serveru"}
    except httpx.TimeoutException:
        return {"connected": False, "reason": "Timeout"}
    except Exception as exc:
        return {"connected": False, "reason": str(exc)}


async def _test_ollama(body: dict, db: Session) -> dict:
    url = (body.get("url") or _get_setting(db, "ollama_host") or "").rstrip("/")
    if not url:
        return {"connected": False, "reason": "not_configured"}
    if not url.startswith("http"):
        url = "http://" + url
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(f"{url}/api/tags")
        resp.raise_for_status()
        models = [m["name"] for m in resp.json().get("models", [])[:5]]
        return {"connected": True, "models": models}
    except httpx.ConnectError:
        return {"connected": False, "reason": "Nelze se připojit k Ollama serveru"}
    except httpx.TimeoutException:
        return {"connected": False, "reason": "Timeout"}
    except Exception as exc:
        return {"connected": False, "reason": str(exc)}


async def _test_claude(body: dict, db: Session) -> dict:
    api_key = body.get("api_key") or _get_setting(db, "anthropic_api_key") or ""
    if not api_key:
        return {"connected": False, "reason": "not_configured"}
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(
                "https://api.anthropic.com/v1/models",
                headers={"x-api-key": api_key, "anthropic-version": "2023-06-01"},
            )
        if resp.status_code == 401:
            return {"connected": False, "reason": "Neplatný API klíč"}
        resp.raise_for_status()
        models = [m["id"] for m in resp.json().get("data", [])[:3]]
        return {"connected": True, "models": models}
    except httpx.ConnectError:
        return {"connected": False, "reason": "Nelze se připojit k api.anthropic.com"}
    except httpx.TimeoutException:
        return {"connected": False, "reason": "Timeout"}
    except Exception as exc:
        return {"connected": False, "reason": str(exc)}


async def _test_discord(body: dict, db: Session) -> dict:
    webhook_url = body.get("webhook_url") or _get_setting(db, "discord_webhook_url") or ""
    if not webhook_url or webhook_url.strip() == "":
        return {"connected": False, "reason": "not_configured"}
    try:
        from ..services.discord import send_test_message
        send_test_message(webhook_url)
        return {"connected": True}
    except Exception as exc:
        return {"connected": False, "reason": str(exc)}


async def _qbt_status_with_body(body: dict, db: Session) -> dict:
    """Test qBittorrent připojení — přijímá url/username/password z body nebo DB."""
    url      = body.get("url")      or _get_setting(db, "qbittorrent_url") or _get_setting(db, "qbittorrent_host") or ""
    username = body.get("username") or _get_setting(db, "qbittorrent_username") or ""
    password = body.get("password") or _get_setting(db, "qbittorrent_password") or ""

    if not url:
        return {"connected": False, "reason": "not_configured"}
    if not url.startswith("http"):
        url = "http://" + url

    login_url = url.rstrip("/") + "/api/v2/auth/login"
    version_url = url.rstrip("/") + "/api/v2/app/version"
    try:
        async with httpx.AsyncClient(timeout=6.0) as client:
            resp = await client.post(login_url, data={"username": username, "password": password})
        login_text = resp.text.strip()
        if login_text == "Fails.":
            return {"connected": False, "reason": "Špatné uživatelské jméno nebo heslo"}
        if login_text == "Banned.":
            return {"connected": False, "reason": "IP dočasně zablokována (příliš mnoho pokusů) — počkej chvíli"}
        if login_text not in ("Ok.", ""):
            return {"connected": False, "reason": f"Neočekávaná odpověď: {login_text[:80]}"}
        sid = resp.cookies.get("SID") or ""
        # sid=="" may mean bypass-auth is enabled — still try the version endpoint
        cookies = {"SID": sid} if sid else {}
        async with httpx.AsyncClient(timeout=6.0, cookies=cookies) as client:
            ver_resp = await client.get(version_url)
        if ver_resp.status_code == 403:
            return {"connected": False, "reason": "Přístup odepřen (403) — ověřte přihlašovací údaje nebo whitelist IP"}
        version = ver_resp.text.strip() if ver_resp.status_code == 200 else "?"
        return {"connected": True, "version": version}
    except httpx.ConnectError as exc:
        return {"connected": False, "reason": f"Nelze se připojit: {exc}"}
    except httpx.TimeoutException:
        return {"connected": False, "reason": "Timeout"}
    except Exception as exc:
        return {"connected": False, "reason": str(exc)}
