"""
subtitle_import.py — record the subtitles that are already on the disk.

``reconcile`` walks the table and asks the disk about each row. This walks the
other way, and it is the direction that was missing: the table held 564
subtitle rows while the library held 13 533 Czech subtitle files. Coverage
looked catastrophic in the database and was in fact 86 %.

Nothing downstream noticed only because ``has_cs_sub()`` gives up on the table
and scans the folder itself — which is why the series grid works at all, and
also why it is expensive: one readdir per episode, on every render. Every
decision built on the table proper (promotion, the dashboard, what to download
next) was reading the 4 %.

What this does **not** do is guess. A sidecar carries its language in the file
name, and that tag is taken at face value: ``Show S01E01.cs.srt`` is recorded
as Czech because that is what the name says and what ``has_cs_sub`` already
concluded from the same file. Files with no tag at all are counted and left
alone — an untagged subtitle next to a Czech library is probably Czech, and
"probably" is not good enough to write into the row that decides whether an
episode still needs a download.

The stored path keeps the episode's own namespace (Sonarr's ``/data/…``,
usually), same as everywhere else: an absolute local path would bake today's
volume mapping into the database and break on the next remount.
"""
from __future__ import annotations

import logging
import os

from sqlalchemy.orm import Session, subqueryload

from ..models.series import Episode, Series, Subtitle
from ..utils import _sidecar_languages

log = logging.getLogger("anisubarr.subtitle_import")


def _sibling_path(video_path: str, subtitle_name: str) -> str:
    """The subtitle beside the video, in whatever namespace the video uses."""
    separator = "\\" if "\\" in video_path and "/" not in video_path else "/"
    head, found, _ = video_path.rpartition(separator)
    return f"{head}{separator}{subtitle_name}" if found else subtitle_name


def _known_files(episode: Episode) -> set[str]:
    """File names this episode already has rows for, lowercased."""
    names = set()
    for sub in episode.subtitles or []:
        if sub.file_path:
            names.add(os.path.basename(sub.file_path.replace("\\", "/")).lower())
    return names


def import_from_disk(db: Session, *, series_ids: list[int] | None = None,
                     languages: set[str] | None = None) -> dict:
    """Add a row for every sidecar subtitle the table does not know about.

    ``languages`` limits what is recorded (lowercase two-letter codes); the
    default records every tagged sidecar, because the table is meant to say
    what is there, not only what was looked for.
    """
    query = db.query(Series).options(
        subqueryload(Series.episodes).subqueryload(Episode.subtitles))
    if series_ids is not None:
        query = query.filter(Series.id.in_(series_ids))

    report = {"series": 0, "episodes": 0, "added": 0,
              "already_known": 0, "untagged": 0, "unreachable": 0}
    by_language: dict[str, int] = {}
    touched_series: list[Series] = []

    for series in query.all():
        report["series"] += 1
        dir_cache: dict[str, dict] = {}
        added_here = 0

        for ep in series.episodes:
            if not ep.file_path:
                continue
            report["episodes"] += 1

            found = _sidecar_languages(ep, dir_cache)
            if not found:
                continue
            known = _known_files(ep)

            for code, filename in found.items():
                if code == "?":
                    # No language tag in the name. Guessing here would write a
                    # language into the row that decides whether this episode
                    # still needs a download.
                    report["untagged"] += 1
                    continue
                if languages and code not in languages:
                    continue
                if filename.lower() in known:
                    report["already_known"] += 1
                    continue

                db.add(Subtitle(
                    episode_id=ep.id,
                    language=code,
                    source="disk",
                    file_path=_sibling_path(ep.file_path, filename),
                    format=os.path.splitext(filename)[1].lstrip(".").lower(),
                    is_embedded=False,
                ))
                known.add(filename.lower())
                by_language[code] = by_language.get(code, 0) + 1
                report["added"] += 1
                added_here += 1

        # An unreadable folder yields nothing, same as an empty one. Counting
        # the series tells an unmounted share apart from a tidy library.
        if added_here:
            touched_series.append(series)
        if dir_cache and not any(dir_cache.values()):
            report["unreachable"] += 1

    db.commit()
    _refresh_counts(db, touched_series)

    report["by_language"] = dict(sorted(by_language.items(),
                                        key=lambda kv: -kv[1]))
    log.info("[import] %d seriálů, %d epizod: %d nových záznamů (%s), "
             "%d už známých, %d bez jazykové značky, %d nedosažitelných",
             report["series"], report["episodes"], report["added"],
             report["by_language"] or "nic", report["already_known"],
             report["untagged"], report["unreachable"])
    return report


def _refresh_counts(db: Session, series_list: list[Series]) -> None:
    """Recount what the new rows changed.

    The grid and the promotion rules read ``cached_cs_sub_count``, so a series
    whose subtitles were just recorded should stop reading as uncovered
    straight away rather than at the next Sonarr sync.
    """
    if not series_list:
        return
    try:
        from ..routers.series import refresh_series_counts
        for series in series_list:
            refresh_series_counts(db, series)
    except Exception as exc:
        log.warning("[import] přepočet cache se nepovedl: %s", exc)
