"""
ai_description.py – Translate an anime series description to Czech.

Uses the configured AI provider via ai_provider.call_ai().
Result is cached in series.overview_cs so it is never translated twice.
"""
from __future__ import annotations

import logging
import re
from typing import Optional

log = logging.getLogger("anisubarr.ai_description")

_SYSTEM = (
    "Jsi profesionální překladatel anime. "
    "Přelož anglický popis anime seriálu do přirozené češtiny. "
    "Zachovej jména postav a speciální pojmy v originálním tvaru. "
    "Vrať POUZE přeložený text bez dalšího komentáře."
)


def _strip_html(text: str) -> str:
    return re.sub(r"<[^>]+>", "", text).strip()


def ensure_czech_description(series, db) -> Optional[str]:
    """
    Ensure series.overview_cs is set.  If already present, return it immediately.
    Otherwise translate overview_anilist (or overview) and persist the result.

    Returns the Czech description, or None if no source text or no AI provider.
    Does NOT raise — errors are logged and None is returned so callers stay robust.
    """
    if series.overview_cs:
        return series.overview_cs

    source = series.overview_anilist or series.overview
    if not source:
        log.debug("No source description for series %d — skipping translation", series.id)
        return None

    source = _strip_html(source)
    if not source:
        return None

    title = series.title_english or series.title_romaji or series.title or ""
    user_msg = (
        f"Anime: {title}\n\nPřelož tento popis do češtiny:\n\n{source}"
        if title else
        f"Přelož tento popis do češtiny:\n\n{source}"
    )

    try:
        from .ai_provider import call_ai
        translated, _ = call_ai(
            messages=[
                {"role": "system", "content": _SYSTEM},
                {"role": "user",   "content": user_msg},
            ],
            db=db,
            timeout=30,
        )
        if translated:
            series.overview_cs = translated
            db.commit()
            log.info("Translated description for series %d (%s)", series.id, title)
            return translated
    except RuntimeError as e:
        log.info("Cannot translate description for series %d: %s", series.id, e)
    except Exception as exc:
        log.error("Description translation failed for series %d: %s", series.id, exc)

    return None


_EPISODE_SYSTEM = (
    "Jsi profesionální překladatel anime. "
    "Přelož anglický popis epizody anime do přirozené češtiny. "
    "Zachovej jména postav a speciální pojmy v originálním tvaru. "
    "Vrať POUZE přeložený text bez dalšího komentáře."
)


def ensure_czech_episode_description(episode, db) -> Optional[str]:
    """
    Ensure episode.overview_cs is set.  If already present, return it immediately.
    Otherwise translate episode.overview and persist the result.

    Returns the Czech description, or None if no source text or no AI provider.
    Does NOT raise — errors are logged and None is returned so callers stay robust.
    """
    if episode.overview_cs:
        return episode.overview_cs

    source = episode.overview
    if not source:
        return None

    source = _strip_html(source)
    if not source:
        return None

    title_part = ""
    if episode.title:
        title_part = f"Epizoda: {episode.title}\n\n"

    user_msg = f"{title_part}Přelož tento popis epizody do češtiny:\n\n{source}"

    try:
        from .ai_provider import call_ai
        translated, _ = call_ai(
            messages=[
                {"role": "system", "content": _EPISODE_SYSTEM},
                {"role": "user",   "content": user_msg},
            ],
            db=db,
            timeout=30,
        )
        if translated:
            episode.overview_cs = translated
            db.commit()
            log.debug(
                "Translated episode description for episode %d (%s)",
                episode.id,
                episode.title or f"S{episode.season_number:02d}E{episode.episode_number:02d}",
            )
            return translated
    except RuntimeError as e:
        log.info("Cannot translate episode description for episode %d: %s", episode.id, e)
    except Exception as exc:
        log.error("Episode description translation failed for episode %d: %s", episode.id, exc)

    return None
