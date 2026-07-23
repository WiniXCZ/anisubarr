from __future__ import annotations

"""
webhooks.py – Příjem webhooků od Sonarru (a dalších služeb v budoucnu).
Endpoint je veřejný (bez JWT auth), ale podporuje volitelný secret token.
"""

from fastapi import APIRouter, BackgroundTasks, Query, Request, HTTPException

from ..config import get_settings

router = APIRouter(prefix="/api/webhooks", tags=["webhooks"])

_TRIGGER_EVENTS = {"Download", "EpisodeFileDelete"}


def _run_series_sync(sonarr_id: int) -> None:
    """Spustí sync pro konkrétní series na pozadí (přes existující sync logiku)."""
    from ..routers.sync import _sync_series_logged  # noqa: PLC0415
    _sync_series_logged(sonarr_id)


def _auto_download_subtitles_for_episodes(episode_sonarr_ids: list[int]) -> None:
    """After sync, attempt subtitle download for newly grabbed episodes if setting is enabled."""
    import logging
    import time
    log = logging.getLogger("anisubarr.webhooks")
    from ..database import SessionLocal
    from ..utils.settings_helper import read_setting

    db = SessionLocal()
    try:
        auto_dl    = read_setting("subtitle_auto_download_on_grab", db) == "true"
        auto_search = read_setting("auto_subtitle_search_on_grab", db) == "true"
        if not auto_dl and not auto_search:
            return

        # Wait briefly for the sync to populate episode file paths
        time.sleep(3)

        from ..models.series import Episode
        from ..services import job_log

        for sonarr_ep_id in episode_sonarr_ids:
            ep = db.query(Episode).filter(Episode.sonarr_ep_id == sonarr_ep_id).first()
            if not ep or not ep.has_file:
                continue

            # Check if episode already has a subtitle
            if ep.subtitles:
                log.info("[webhook] Episode %d already has subtitles, skipping auto-download", ep.id)
                continue

            label = f"Auto-DL titulku S{ep.season_number:02d}E{ep.episode_number:02d} ({ep.series.title if ep.series else '?'})"
            run = job_log.start_run("subtitle_auto_download", label)
            try:
                from ..routers.subtitles import _download_best_for_episode
                result = _download_best_for_episode(ep, db)
                job_log.finish_run(run, "done" if result else "skipped", result or "Žádný výsledek")
            except Exception as exc:
                job_log.finish_run(run, "error", str(exc)[:200])
                log.warning("[webhook] Auto-download failed for episode %d: %s", ep.id, exc)
    except Exception as exc:
        log.error("[webhook] Auto-download task failed: %s", exc)
    finally:
        db.close()


@router.post("/sonarr")
async def sonarr_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    token: str | None = Query(default=None),
):
    """
    Příjem Sonarr webhooků.
    - eventType == 'Test'  → vrátí {"status": "ok"}
    - eventType == 'Download' | 'EpisodeFileDelete' → spustí sync série na pozadí

    Secret se přednostně čte z hlavičky X-Webhook-Token; query parametr ?token=
    je zachován pro zpětnou kompatibilitu.
    """
    cfg = get_settings()

    # Ověř secret (pokud je nakonfigurován).
    # Preferuj X-Webhook-Token header; fallback na query param pro zpětnou kompatibilitu.
    if cfg.webhook_secret:
        header_token = request.headers.get("X-Webhook-Token")
        provided = header_token or token
        if provided != cfg.webhook_secret:
            raise HTTPException(status_code=403, detail="Neplatný webhook token")

    payload: dict = await request.json()
    event_type = payload.get("eventType", "")

    if event_type == "Test":
        return {"status": "ok"}

    if event_type in _TRIGGER_EVENTS:
        series = payload.get("series", {})
        sonarr_id = series.get("id")
        if sonarr_id:
            background_tasks.add_task(_run_series_sync, sonarr_id)
            # Queue auto-subtitle-download for grabbed episodes
            if event_type == "Download":
                episode_sonarr_ids = [e["id"] for e in payload.get("episodes", []) if e.get("id")]
                if episode_sonarr_ids:
                    background_tasks.add_task(_auto_download_subtitles_for_episodes, episode_sonarr_ids)
            return {"status": "sync_queued", "sonarr_id": sonarr_id, "event": event_type}

    # Ostatní eventy ignorujeme
    return {"status": "ignored", "event": event_type}
