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
    """
    cfg = get_settings()

    # Ověř secret (pokud je nakonfigurován)
    if cfg.webhook_secret:
        if token != cfg.webhook_secret:
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
            return {"status": "sync_queued", "sonarr_id": sonarr_id, "event": event_type}

    # Ostatní eventy ignorujeme
    return {"status": "ignored", "event": event_type}
