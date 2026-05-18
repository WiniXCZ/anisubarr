from __future__ import annotations

import logging
import os
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response
from sqlalchemy.orm import Session, subqueryload
from ..database import get_db
from ..deps import get_current_user, require_admin
from ..models.series import Series, Episode, Subtitle
from ..models.user import User
from ..services import path_resolver

log = logging.getLogger("anisubarr.series")

router = APIRouter(prefix="/api/series", tags=["series"])


# ──────────────────────────────────────────
# Series list / detail
# ──────────────────────────────────────────

@router.get("")
def list_series(response: Response, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    """Fast list — uses cached counters, no episode/subtitle loading, no disk I/O."""
    response.headers["Cache-Control"] = "no-cache"
    rows = db.query(Series).order_by(Series.title).all()
    return [_series_card(s) for s in rows]


@router.get("/{series_id}")
def get_series(series_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    s = (
        db.query(Series)
        .options(subqueryload(Series.episodes).subqueryload(Episode.subtitles))
        .filter(Series.id == series_id)
        .first()
    )
    if not s:
        raise HTTPException(404, "Series not found")
    return _series_detail(s)


@router.post("/refresh-counts", status_code=202)
def refresh_counts(
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Refresh cached episode/subtitle counts for all series (includes disk scan)."""
    background_tasks.add_task(_refresh_all_counts_task)
    return {"status": "refresh started"}


@router.get("/{series_id}/episodes")
def get_episodes(series_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    s = db.query(Series).filter(Series.id == series_id).first()
    if not s:
        raise HTTPException(404, "Series not found")
    dir_cache: dict[str, set[str]] = {}
    return [
        _episode_out(ep, dir_cache)
        for ep in sorted(s.episodes, key=lambda e: (e.season_number, e.episode_number))
        if ep.season_number > 0
    ]


VALID_WATCH_STATUSES = {"plan_to_watch", "watching", "completed", "on_hold", "dropped"}

@router.patch("/{series_id}/watch-status")
def set_watch_status(
    series_id: int,
    body: dict,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    s = db.query(Series).filter(Series.id == series_id).first()
    if not s:
        raise HTTPException(404, "Series not found")
    status = body.get("watch_status")
    if status is not None and status not in VALID_WATCH_STATUSES:
        raise HTTPException(400, f"Invalid status. Use: {VALID_WATCH_STATUSES}")
    s.watch_status = status  # None clears it
    db.commit()
    return {"watch_status": s.watch_status}


@router.patch("/{series_id}/episodes/{episode_id}/watched")
def set_episode_watched(
    series_id: int,
    episode_id: int,
    body: dict,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    ep = db.query(Episode).filter(Episode.id == episode_id, Episode.series_id == series_id).first()
    if not ep:
        raise HTTPException(404, "Episode not found")
    ep.watched = bool(body.get("watched", not ep.watched))
    db.commit()
    return {"watched": ep.watched}


@router.post("/{series_id}/translate", status_code=202)
def translate_overview(
    series_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    s = db.query(Series).filter(Series.id == series_id).first()
    if not s:
        raise HTTPException(404, "Series not found")
    if not s.overview:
        raise HTTPException(400, "No overview to translate")
    background_tasks.add_task(_do_translate, series_id)
    return {"status": "translation queued"}


# ──────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────

_CS_LANGS = {"cs", "cze", "cz", "ces"}
# Sonarr sometimes reports the full language name or mixed-case variants
_CS_NAMES  = _CS_LANGS | {"czech", "cestina", "češtiny", "čeština"}
_SUB_EXTS  = {".srt", ".ass", ".ssa", ".vtt", ".sub"}


def _file_non_empty(path: str) -> bool:
    """Return True if path exists on disk and has at least 10 bytes of content."""
    try:
        if not os.path.isfile(path):
            return False
        return os.path.getsize(path) >= 10
    except PermissionError:
        return True   # file exists but we can't read it — trust it
    except Exception:
        return False


def _has_cs_sub(ep: Episode, dir_cache: dict[str, set[str]] | None = None) -> bool:
    """Return True if the episode has a Czech subtitle — checks DB, embedded tracks, then disk.

    dir_cache: shared per-request cache mapping directory path → set of lowercase filenames.
    Pass the same dict across all episodes in one request to avoid redundant os.listdir() calls.
    """
    # 1) DB records — trust them. If a Subtitle row exists with CS language, the file is
    #    assumed present. DB records are removed when subtitles are deleted through the app.
    #    We intentionally skip file-existence checks here to avoid false negatives on
    #    network/mapped drives that may not be accessible from the backend service context.
    for sub in ep.subtitles:
        if sub.language in _CS_LANGS:
            return True

    # 2) Embedded subtitle tracks reported by Sonarr mediaInfo (subtitles_in_file field)
    #    Sonarr v3+ stores ISO 639-2 codes: "cze / eng" or "ces" or full names like "Czech"
    if ep.subtitles_in_file:
        for token in ep.subtitles_in_file.replace("/", ",").split(","):
            if token.strip().lower() in _CS_NAMES:
                return True

    # 3) Disk — look for Show.S01E01.cs.srt style files next to the video
    if not ep.file_path:
        return False
    try:
        unc_video   = path_resolver.resolve(ep.file_path)
        local_video = path_resolver.unc_to_local(unc_video)   # Y:\... when available

        # Build list of directories to try: drive-letter first (faster), then UNC fallback
        directories: list[str] = []
        for vid in ([local_video] if local_video != unc_video else []) + [unc_video]:
            d = os.path.dirname(vid)
            if d and d not in directories:
                directories.append(d)

        video_stem = os.path.splitext(os.path.basename(local_video))[0].lower()

        # Use provided cache or create a throwaway local one
        cache = dir_cache if dir_cache is not None else {}

        for directory in directories:
            if directory not in cache:
                try:
                    if os.path.isdir(directory):
                        cache[directory] = {f.lower() for f in os.listdir(directory)}
                    else:
                        cache[directory] = set()
                except Exception:
                    cache[directory] = set()

            filenames = cache[directory]
            for lang in _CS_LANGS:
                for ext in ("srt", "ass", "ssa", "vtt"):
                    candidate = f"{video_stem}.{lang}.{ext}"
                    if candidate in filenames:
                        full_path = os.path.join(directory, candidate)
                        if _file_non_empty(full_path):
                            return True
    except Exception:
        pass
    return False


def _parse_json_list(v) -> list:
    if not v:
        return []
    import json
    try:
        parsed = json.loads(v)
        return parsed if isinstance(parsed, list) else []
    except Exception:
        # Try replacing single quotes (legacy format)
        try:
            return json.loads(v.replace("'", '"'))
        except Exception:
            return []


def _human_size(b) -> str:
    if not b:
        return ""
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if b < 1024:
            return f"{b:.1f} {unit}"
        b /= 1024
    return f"{b:.1f} PB"


def _series_card(s: Series, dir_cache: dict[str, set[str]] | None = None) -> dict:
    """Compact representation for the library grid.

    When dir_cache is None (list view): uses cached counters — O(1), no disk I/O.
    When dir_cache is provided (detail view): computes fresh from episodes + disk.
    """
    if dir_cache is None:
        # Fast path: use pre-computed cached values stored during sync
        cs_sub_count = s.cached_cs_sub_count or 0
        ep_with_file = s.cached_ep_with_file or 0
        ep_monitored = s.cached_ep_monitored or 0
    else:
        # Accurate path for detail view: compute from loaded episodes + disk
        cs_sub_count = sum(
            1 for ep in s.episodes
            if ep.season_number > 0 and ep.has_file and ep.monitored
            and _has_cs_sub(ep, dir_cache)
        )
        ep_with_file = sum(
            1 for ep in s.episodes
            if ep.season_number > 0 and ep.monitored and ep.has_file
        )
        ep_monitored = sum(
            1 for ep in s.episodes
            if ep.season_number > 0 and ep.monitored
        )
    return {
        "id":                s.id,
        "sonarr_id":         s.sonarr_id,
        "anilist_id":        s.anilist_id,
        "title":             s.title,
        "title_romaji":      s.title_romaji,
        "title_english":     s.title_english,
        "title_japanese":    s.title_japanese,
        "year":              s.year,
        "first_aired":       s.first_aired,
        "status":            s.status,
        "network":           s.network,
        "series_type":       s.series_type,
        "cover_url":         s.cover_url or s.poster_url,
        "poster_url":        s.poster_url,
        "average_score":     s.average_score or 0.0,
        "rating_value":      s.rating_value,
        "genres":            _parse_json_list(s.genres),
        "episode_count":     s.episode_count,
        "episode_file_count":s.episode_file_count,
        "episodes_monitored":ep_monitored,
        "episodes_with_file":ep_with_file,
        "percent_complete":  s.percent_complete,
        "monitored":         s.monitored,
        "cs_sub_count":      cs_sub_count,
        "watch_status":      s.watch_status,
        "sonarr_added":      s.sonarr_added,
        "path":              s.path,
        "has_issue":         bool(s.has_issue),
        "promoted":          bool(s.promoted),
    }


def _series_detail(s: Series) -> dict:
    """Full detail for series page."""
    return {
        **_series_card(s, dir_cache={}),
        "sort_title":        s.sort_title,
        "alternate_titles":  _parse_json_list(s.alternate_titles),
        "imdb_id":           s.imdb_id,
        "tvdb_id":           s.tvdb_id,
        "tvmaze_id":         s.tvmaze_id,
        "first_aired":       s.first_aired,
        "air_time":          s.air_time,
        "runtime":           s.runtime,
        "certification":     s.certification,
        "overview":          s.overview_cs or s.overview,
        "overview_orig":     s.overview,
        "overview_cs":       s.overview_cs,
        "fanart_url":        s.fanart_url,
        "banner_url":        s.banner_url,
        "tags":              _parse_json_list(s.tags),
        "sonarr_tags":       _parse_json_list(s.sonarr_tags),
        "quality_profile":   s.quality_profile,
        "path":              s.path,
        "season_count":      s.season_count,
        "total_episode_count": s.total_episode_count,
        "size_on_disk":      s.size_on_disk,
        "size_on_disk_human":_human_size(s.size_on_disk),
        "rating_votes":      s.rating_votes,
        "synced_at":         s.synced_at.isoformat() if s.synced_at else None,
    }


def _episode_out(ep: Episode, dir_cache: dict[str, set[str]] | None = None) -> dict:
    return {
        "id":                   ep.id,
        "sonarr_ep_id":         ep.sonarr_ep_id,
        "season_number":        ep.season_number,
        "episode_number":       ep.episode_number,
        "absolute_episode_number": ep.absolute_episode_number,
        "title":                ep.title,
        "overview":             ep.overview,
        "air_date":             ep.air_date,
        "has_file":             ep.has_file,
        "monitored":            ep.monitored,
        "file_path":            ep.file_path,
        "file_size":            ep.file_size,
        "file_size_human":      _human_size(ep.file_size),
        # Quality
        "quality_name":         ep.quality_name,
        "quality_resolution":   ep.quality_resolution,
        # Media info
        "resolution":           ep.resolution,
        "video_codec":          ep.video_codec,
        "video_fps":            ep.video_fps,
        "video_dynamic_range":  ep.video_dynamic_range,
        "audio_codec":          ep.audio_codec,
        "audio_channels":       ep.audio_channels,
        "audio_languages":      ep.audio_languages,
        "subtitles_in_file":    ep.subtitles_in_file,
        "run_time":             ep.run_time,
        "release_group":        ep.release_group,
        # CZ subtitle flag — DB + disk fallback
        "has_cs_sub":           _has_cs_sub(ep, dir_cache),
        "watched":              ep.watched or False,
    }


def refresh_series_counts(db, series: Series, use_disk: bool = True) -> None:
    """Recompute and store cached episode/subtitle counts for one series.

    Called during sync and by the /refresh-counts endpoint.
    use_disk=True: also scans filesystem for external .srt files (slower but complete).
    """
    from sqlalchemy.orm import subqueryload as _sl
    s = (
        db.query(Series)
        .options(_sl(Series.episodes).subqueryload(Episode.subtitles))
        .filter(Series.id == series.id)
        .first()
    )
    if not s:
        return
    dir_cache: dict[str, set[str]] = {} if use_disk else None  # type: ignore[assignment]
    # Count ALL non-special episodes (season > 0), regardless of monitored flag.
    # Unmonitored episodes can still have files+subtitles on disk — we want to
    # reflect actual library state, not just Sonarr download targets.
    all_eps = [ep for ep in s.episodes if ep.season_number > 0]
    eps_with_file = [ep for ep in all_eps if ep.has_file]
    s.cached_ep_monitored = len(all_eps)
    s.cached_ep_with_file = len(eps_with_file)
    s.cached_cs_sub_count = sum(
        1 for ep in eps_with_file
        if _has_cs_sub(ep, dir_cache)
    )
    db.commit()


def _refresh_all_counts_task() -> None:
    """Background task: refresh cached counts for every series (disk scan included)."""
    from ..database import SessionLocal
    from ..services import job_log
    db = SessionLocal()
    run = job_log.start_run("refresh_counts", "Refresh počtů epizod a titulků")
    try:
        series_list = db.query(Series).all()
        for i, s in enumerate(series_list):
            try:
                job_log.update_message(run.run_id, f"({i+1}/{len(series_list)}) {s.title}")
                refresh_series_counts(db, s, use_disk=True)
            except Exception as exc:
                log.warning("[refresh-counts] '%s': %s", s.title, exc)
        job_log.finish_run(run, "done", f"{len(series_list)} sérií aktualizováno")
        log.info("[refresh-counts] done — %d series updated", len(series_list))
    except Exception as e:
        job_log.finish_run(run, "error", str(e)[:300])
    finally:
        db.close()


def _do_translate(series_id: int):
    from ..database import SessionLocal
    from ..services.ollama import translate_to_czech
    db = SessionLocal()
    try:
        s = db.query(Series).filter(Series.id == series_id).first()
        if s and s.overview and not s.overview_cs:
            result = translate_to_czech(s.overview, context="anime synopsis")
            if result:
                s.overview_cs = result
                db.commit()
    finally:
        db.close()
