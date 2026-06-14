"""
auto_unmonitor.py – Automatic Sonarr monitoring management based on subtitle status.

Logic (three levels):
  1. Episode  – has file + has Czech subtitle → unmonitor the episode in Sonarr
  2. Season   – all episodes-with-file in a season have Czech subtitles → unmonitor all
                season episodes (they are already unmonitored by rule #1, so this is a
                no-op in practice, but we also update the DB monitored flag)
  3. Series   – all non-special episodes with files have Czech subtitles → mark the
                whole series as unmonitored in Sonarr (series.monitored = False)
"""
from __future__ import annotations

import logging
from collections import defaultdict
from typing import Optional

log = logging.getLogger("anisubarr.auto_unmonitor")

from ..utils import has_cs_sub  # noqa: E402


def run_auto_unmonitor(
    db,
    series_ids: Optional[list[int]] = None,
    dry_run: bool = False,
) -> dict:
    """
    Scan DB episodes, determine what should be unmonitored, and apply changes
    in Sonarr.

    Parameters
    ----------
    db          : SQLAlchemy session
    series_ids  : limit to these Series.id values (None = all)
    dry_run     : if True, compute changes but do not call Sonarr API

    Returns
    -------
    dict with counts: episodes_unmonitored, series_unmonitored, series_checked
    """
    from ..models.series import Series, Episode
    from sqlalchemy.orm import subqueryload
    from ..services import sonarr as sonarr_svc

    query = db.query(Series).options(
        subqueryload(Series.episodes).subqueryload(Episode.subtitles)
    )
    if series_ids:
        query = query.filter(Series.id.in_(series_ids))
    all_series = query.all()

    ep_ids_to_unmonitor: list[int] = []   # Sonarr episode IDs
    series_to_unmonitor: list[int] = []   # Sonarr series IDs
    ep_db_to_unmonitor:  list     = []    # Episode ORM objects (to update DB flag)

    stats = {
        "series_checked":       len(all_series),
        "episodes_unmonitored": 0,
        "series_unmonitored":   0,
        "errors":               [],
    }

    dir_cache: dict[str, set[str]] = {}

    for series in all_series:
        non_special = [ep for ep in series.episodes if ep.season_number > 0]
        eps_with_file = [ep for ep in non_special if ep.has_file]

        if not eps_with_file:
            continue

        # Per-episode pass
        cs_ep_ids:   list[int] = []   # Sonarr IDs of episodes with CS subs
        cs_ep_db:    list      = []   # ORM objects
        no_cs_ep_ids: list[int] = []  # episodes with file but no CS sub

        for ep in eps_with_file:
            if has_cs_sub(ep, dir_cache):
                if ep.sonarr_ep_id:
                    cs_ep_ids.append(ep.sonarr_ep_id)
                cs_ep_db.append(ep)
            else:
                if ep.sonarr_ep_id:
                    no_cs_ep_ids.append(ep.sonarr_ep_id)

        ep_ids_to_unmonitor.extend(cs_ep_ids)
        ep_db_to_unmonitor.extend(cs_ep_db)

        # Series-level: all eps with files have CS subs → unmonitor series
        if cs_ep_ids and not no_cs_ep_ids:
            if series.sonarr_id:
                series_to_unmonitor.append(series.sonarr_id)
            log.info("[auto_unmonitor] %s → series complete, will unmonitor", series.title)
        else:
            log.debug(
                "[auto_unmonitor] %s → %d with CS, %d without — series stays monitored",
                series.title, len(cs_ep_ids), len(no_cs_ep_ids),
            )

    stats["episodes_unmonitored"] = len(ep_ids_to_unmonitor)
    stats["series_unmonitored"]   = len(series_to_unmonitor)

    if dry_run:
        return stats

    # ── Apply changes ──────────────────────────────────────────────────────

    # Batch unmonitor episodes (up to 500 per call to avoid huge payloads)
    if ep_ids_to_unmonitor:
        try:
            _batch(ep_ids_to_unmonitor, sonarr_svc.set_episodes_monitored, monitored=False)
            # Also update DB monitored flag so our counts stay accurate
            for ep in ep_db_to_unmonitor:
                ep.monitored = False
            db.commit()
            log.info("[auto_unmonitor] Unmonitored %d episodes in Sonarr", len(ep_ids_to_unmonitor))
        except Exception as e:
            msg = f"Episode unmonitor API call failed: {e}"
            log.error("[auto_unmonitor] %s", msg)
            stats["errors"].append(msg)

    # Unmonitor whole series
    for sonarr_id in series_to_unmonitor:
        try:
            sonarr_svc.update_series(sonarr_id, monitored=False)
            # Update DB flag
            s = db.query(Series).filter(Series.sonarr_id == sonarr_id).first()
            if s:
                s.monitored = False
            db.commit()
            log.info("[auto_unmonitor] Series sonarr_id=%d marked unmonitored", sonarr_id)
        except Exception as e:
            msg = f"Series {sonarr_id} unmonitor failed: {e}"
            log.error("[auto_unmonitor] %s", msg)
            stats["errors"].append(msg)

    return stats


def _batch(ids: list[int], fn, batch_size: int = 500, **kwargs) -> None:
    """Call fn(chunk, **kwargs) for every batch_size-sized chunk of ids."""
    for i in range(0, len(ids), batch_size):
        fn(ids[i : i + batch_size], **kwargs)
