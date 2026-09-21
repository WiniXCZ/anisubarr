"""
subtitle_reconcile.py — bring the subtitles table back in line with the disk.

Rows written before a path mapping existed hold Sonarr's namespace, and the
read path resolves those, so they are fine. What resolving cannot fix is a file
that moved under a different name: a subtitle converted from ``.ass`` to
``.srt`` leaves the row pointing at a name nothing will ever create again. And
a row whose file is simply gone is worse than useless — it tells Anisubarr the
episode is covered, so nothing downloads a replacement.

Two hazards shape the design.

A file that "isn't there" may only be unreachable: an unmounted share makes
every subtitle in the library look deleted, and a job that trusted that would
empty the table in one pass. So a row is only judged when the folder it lives
in can actually be read, and the whole delete phase stands down when most of
what was checked looks missing — that is a mount problem, not 700 deletions.

And a repaired row keeps the prefix it came with. Only the file name changes.
Rewriting ``/data/media/…`` into ``/media/media/…`` would bake today's volume
mapping into the database, so the next time the mount moves, every row that was
"repaired" breaks again.
"""
from __future__ import annotations

import logging
import os

from sqlalchemy.orm import Session

from ..models.series import Episode, Series, Subtitle
from . import path_resolver

log = logging.getLogger("anisubarr.subtitle_reconcile")

# The formats a subtitle can have been converted into.
_SUB_EXTS = (".srt", ".ass", ".ssa", ".vtt", ".sub")

# Above this share of missing rows, the disk is the problem, not the rows —
# but only once there is enough to judge. One missing subtitle out of one is
# 100 % and means nothing; the folder check above already catches an unmounted
# share, so this is the second line, for a partially readable one.
_ABORT_RATIO = 0.5
_ABORT_MIN_ROWS = 10


def _local(stored: str) -> str:
    """Where the row points, translated for this process."""
    try:
        return path_resolver.unc_to_local(path_resolver.resolve(stored))
    except Exception:
        return stored


def _sibling_with_other_extension(local_path: str) -> str | None:
    """The same subtitle under a different format, if one is on the disk."""
    stem, current = os.path.splitext(local_path)
    folder = os.path.dirname(local_path)
    try:
        present = {name.lower(): name for name in os.listdir(folder)}
    except OSError:
        return None
    for ext in _SUB_EXTS:
        if ext == current.lower():
            continue
        candidate = os.path.basename(stem) + ext
        actual = present.get(candidate.lower())
        if actual:
            return os.path.join(folder, actual)
    return None


def _sibling_of(reference: str, new_name: str) -> str:
    """``new_name`` beside ``reference``, in the reference's own namespace.

    Used when a row follows its series to a new root: the episode's path is
    the one Sonarr keeps current, so the subtitle inherits it rather than an
    absolute path resolved for this container, which would bake today's volume
    mapping into the database.
    """
    return _rename_kept_in_place(reference, new_name)


def _rename_kept_in_place(stored: str, new_name: str) -> str:
    """Swap the file name, keep everything to its left exactly as it was.

    The prefix is whatever namespace the row already used — Sonarr's, this
    container's, a UNC share. Normalising it here would bake today's volume
    mapping into the database and break the row the next time the mount moves.
    """
    separator = "\\" if "\\" in stored and "/" not in stored else "/"
    head, found, _ = stored.rpartition(separator)
    return f"{head}{separator}{new_name}" if found else new_name


def _where_the_episode_lives_now(sub: Subtitle) -> str | None:
    """The subtitle's folder as Sonarr sees it today, if the series moved.

    A series that gets promoted moves from incomplete_anime into the main
    library, and its subtitle rows keep pointing at the old root. The folder
    there is simply gone, so the row was written off as "unreachable" and
    skipped forever — 100 rows of false "has subtitles" that nothing would
    ever download a replacement for.

    Searching the library for them would be guesswork. Sonarr already knows:
    it rewrites the episode's own file_path on the move, so the video is the
    authority on where its subtitles should be.
    """
    episode = sub.episode
    video = getattr(episode, "file_path", None) if episode else None
    if not video:
        return None
    folder = os.path.dirname(_local(video))
    return folder if folder and os.path.isdir(folder) else None


def _named_like(folder: str, stored_name: str) -> str | None:
    """The same subtitle in a folder, under its own name or another format."""
    stem = os.path.splitext(stored_name)[0].lower()
    try:
        present = {name.lower(): name for name in os.listdir(folder)}
    except OSError:
        return None
    for ext in _SUB_EXTS:
        actual = present.get(stem + ext)
        if actual:
            return os.path.join(folder, actual)
    return None

def reconcile(db: Session, *, delete_missing: bool = True,
              episode_ids: list[int] | None = None) -> dict:
    """Repair what moved, drop what is gone, and report the rest.

    ``episode_ids`` narrows the sweep to those episodes, so one series can be
    reconciled without touching the rest of the library — and so the abort
    guard below is judged against that series, not against everything.
    """
    query = db.query(Subtitle).filter(
        Subtitle.file_path.isnot(None), Subtitle.is_embedded.is_(False))
    if episode_ids is not None:
        query = query.filter(Subtitle.episode_id.in_(episode_ids))
    rows = query.all()

    report = {"checked": len(rows), "ok": 0, "repaired": 0,
              "unreachable": 0, "missing": 0, "deleted": 0,
              "followed_move": 0, "moved_missing": 0}
    phantoms: list[Subtitle] = []
    touched: set[int] = set()

    for sub in rows:
        local = _local(sub.file_path)
        if os.path.isfile(local):
            report["ok"] += 1
            continue

        stored_name = os.path.basename(sub.file_path.replace("\\", "/"))
        folder = os.path.dirname(local)

        if folder and os.path.isdir(folder):
            found = _sibling_with_other_extension(local)
        else:
            # The folder is gone. That is either an unmounted share or a series
            # that moved between library roots, and those need opposite
            # answers — so ask the episode where it lives now before writing
            # the row off.
            moved_to = _where_the_episode_lives_now(sub)
            if not moved_to:
                report["unreachable"] += 1
                continue
            found = _named_like(moved_to, stored_name)
            if not found:
                # The video is reachable and the subtitle is not beside it.
                # That is a real answer, not a mount problem.
                report["moved_missing"] += 1
                report["missing"] += 1
                phantoms.append(sub)
                continue
            sub.file_path = _sibling_of(
                getattr(sub.episode, "file_path", "") or sub.file_path,
                os.path.basename(found))
            sub.format = os.path.splitext(found)[1].lstrip(".").lower()
            touched.add(sub.episode_id)
            report["repaired"] += 1
            report["followed_move"] += 1
            continue

        if found:
            sub.file_path = _rename_kept_in_place(sub.file_path, os.path.basename(found))
            sub.format = os.path.splitext(found)[1].lstrip(".").lower()
            touched.add(sub.episode_id)
            report["repaired"] += 1
            continue

        report["missing"] += 1
        phantoms.append(sub)

    judged = report["ok"] + report["repaired"] + report["missing"]
    too_many_gone = (judged >= _ABORT_MIN_ROWS
                     and report["missing"] / judged > _ABORT_RATIO)

    if phantoms and delete_missing and not too_many_gone:
        for sub in phantoms:
            touched.add(sub.episode_id)
            db.delete(sub)
        report["deleted"] = len(phantoms)
    elif too_many_gone:
        log.warning(
            "[reconcile] %d z %d titulků chybí — to vypadá na nedostupné úložiště, "
            "nic nemažu", report["missing"], judged)
        report["aborted"] = True

    db.commit()
    _refresh_counts(db, touched)
    log.info("[reconcile] zkontrolováno %d: %d v pořádku, %d opraveno, "
             "%d chybí (%d smazáno), %d nedosažitelných",
             report["checked"], report["ok"], report["repaired"],
             report["missing"], report["deleted"], report["unreachable"])
    return report


def _refresh_counts(db: Session, episode_ids: set[int]) -> None:
    """Recount the series whose rows changed.

    The series list, the dashboard and the promotion rules all read
    ``cached_cs_sub_count`` rather than counting episodes themselves. Deleting
    a phantom without recounting would leave the series still claiming the
    episode is covered — the exact state this job exists to end.
    """
    if not episode_ids:
        return
    try:
        from ..routers.series import refresh_series_counts
        series_ids = {
            sid for (sid,) in db.query(Episode.series_id)
            .filter(Episode.id.in_(episode_ids)).distinct()
        }
        for series in db.query(Series).filter(Series.id.in_(series_ids)).all():
            refresh_series_counts(db, series)
    except Exception as exc:
        # The rows are already correct; a stale count is fixed by the next sync.
        log.warning("[reconcile] přepočet cache se nepovedl: %s", exc)
