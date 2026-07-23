from __future__ import annotations

import json
import logging
import os
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response
from sqlalchemy.orm import Session, subqueryload
from ..database import get_db
from ..deps import get_current_user, require_admin
from ..models.series import Series, Episode, Subtitle
from ..models.user import User
from ..services import path_resolver
from ..utils import CS_LANGS, CS_NAMES, has_cs_sub

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


@router.get("/orphaned-folders")
def orphaned_folders(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    """
    List subfolders inside the anime_series root folder that have no matching
    Series record in the database (by path basename comparison).
    """
    import os as _os
    from ..services.promotion import _find_root_folder
    from ..services import path_resolver as _pr

    target_folder = (
        _find_root_folder("anime_series")
        or _find_root_folder("anime series")
        or _find_root_folder("animeseries")
    )
    if not target_folder:
        return {"error": "anime_series root folder not found in Sonarr", "folders": [], "root_folder": None}

    # Try to get a locally accessible path (UNC → drive letter on Windows)
    try:
        local_folder = _pr.unc_to_local(target_folder)
    except Exception:
        local_folder = target_folder

    # List subdirectories
    try:
        subdirs = sorted(
            d for d in _os.listdir(local_folder)
            if _os.path.isdir(_os.path.join(local_folder, d))
        )
    except Exception as exc:
        return {
            "error": f"Cannot list folder '{local_folder}': {exc}",
            "root_folder": target_folder,
            "folders": [],
        }

    # Collect all Series path basenames from DB (across ALL series, published or not)
    all_series = db.query(Series).all()
    db_folder_names: set[str] = set()
    for s in all_series:
        if s.path:
            norm = s.path.replace("\\", "/").rstrip("/")
            db_folder_names.add(norm.split("/")[-1])

    orphaned = [d for d in subdirs if d not in db_folder_names]
    return {
        "root_folder": target_folder,
        "total_folders": len(subdirs),
        "orphaned_count": len(orphaned),
        "folders": orphaned,
    }


@router.get("/{series_id}/demotion-check")
def demotion_check(series_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    """
    Diagnose why a series would or would not be demoted.
    Returns verdict, reason, per-episode CS subtitle status, and active thresholds.
    """
    s = (
        db.query(Series)
        .options(subqueryload(Series.episodes).subqueryload(Episode.subtitles))
        .filter(Series.id == series_id)
        .first()
    )
    if not s:
        raise HTTPException(404, "Series not found")

    from ..services.promotion import _should_demote
    from ..utils.settings_helper import read_setting as _rs

    dir_cache: dict[str, set[str]] = {}
    verdict, reason = _should_demote(s, db, dir_cache=dir_cache)

    eps_with_file = sorted(
        [ep for ep in s.episodes if ep.season_number > 0 and ep.has_file],
        key=lambda ep: (ep.season_number, ep.episode_number),
    )
    eps_info = [
        {
            "id":               ep.id,
            "code":             f"S{ep.season_number:02d}E{ep.episode_number:02d}",
            "title":            ep.title,
            "has_cs_sub":       has_cs_sub(ep, dir_cache),
            "subtitles_db":     [{"lang": sub.language, "path": sub.path} for sub in ep.subtitles],
            "subtitles_in_file": ep.subtitles_in_file,
        }
        for ep in eps_with_file
    ]
    missing_count = sum(1 for e in eps_info if not e["has_cs_sub"])

    return {
        "series_id":           s.id,
        "title":               s.title,
        "status":              s.status,
        "promoted":            bool(s.promoted),
        "has_issue":           bool(s.has_issue),
        "verdict":             verdict,
        "reason":              reason,
        "episodes_with_file":  len(eps_with_file),
        "episodes_missing_cs": missing_count,
        "pct_missing":         round(missing_count / len(eps_with_file) * 100, 1) if eps_with_file else 0,
        "thresholds": {
            "pct_threshold":       int(_rs("demote_pct_threshold",             db) or "10"),
            "multi_threshold":     int(_rs("demote_multi_episode_threshold",   db) or "2"),
            "completed_threshold": int(_rs("demote_completed_threshold",       db) or "2"),
            "allow_last_missing":  _rs("demote_allow_last_episode_missing",    db) != "false",
            "single_action":       _rs("demote_single_episode_action",         db) or "flag_only",
        },
        "episodes": eps_info,
    }


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
    s = (
        db.query(Series)
        .options(subqueryload(Series.episodes).subqueryload(Episode.subtitles))
        .filter(Series.id == series_id)
        .first()
    )
    if not s:
        raise HTTPException(404, "Series not found")
    dir_cache: dict[str, set[str]] = {}
    return [
        _episode_out(ep, dir_cache)
        for ep in sorted(s.episodes, key=lambda e: (e.season_number, e.episode_number))
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


@router.post("/{series_id}/fetch-english-title")
def fetch_english_title(
    series_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Fetch English title and synopsis from AniList API and save to series.title_english."""
    s = db.query(Series).filter(Series.id == series_id).first()
    if not s:
        raise HTTPException(404, "Series not found")
    from ..services.anilist import fetch_english_title as anilist_fetch
    result = anilist_fetch(s.title, year=s.year)
    if result is None:
        raise HTTPException(404, "AniList: série nenalezena nebo API selhal")
    if result.get("title_english"):
        s.title_english = result["title_english"]
        db.commit()
    return {
        "title_en":      result.get("title_english"),
        "title_romaji":  result.get("title_romaji"),
        "synopsis_en":   result.get("synopsis"),
    }


@router.post("/{series_id}/fetch-tmdb")
def fetch_tmdb(
    series_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Fetch poster + metadata from TMDb and save to series."""
    from ..services import tmdb as tmdb_svc
    s = db.get(Series, series_id)
    if not s:
        raise HTTPException(404, "Series not found")
    info = tmdb_svc.fetch_anime_info(s.title, year=getattr(s, "year", None))
    if not info:
        raise HTTPException(404, "TMDb: série nenalezena nebo API klíč chybí")
    for k in ("tmdb_id", "poster_url", "backdrop_url"):
        if info.get(k) is not None:
            setattr(s, k, info[k])
    db.commit()
    db.refresh(s)
    return info


@router.post("/{series_id}/translate-description")
def translate_description(
    series_id: int,
    force: bool = False,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Synchronously translate series description to Czech via AI provider.

    If force=true, clears existing overview_cs and re-translates.
    Returns {overview_cs: "..."} on success.
    """
    s = db.query(Series).filter(Series.id == series_id).first()
    if not s:
        raise HTTPException(404, "Series not found")

    if force and s.overview_cs:
        s.overview_cs = None
        db.commit()
        db.refresh(s)

    from ..services.ai_description import ensure_czech_description
    result = ensure_czech_description(s, db)
    if result is None:
        raise HTTPException(400, "Překlad se nezdařil — není popis nebo AI provider není nakonfigurován")

    return {"overview_cs": result}


# ──────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────



def _parse_json_list(v) -> list:
    if not v:
        return []
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
            and has_cs_sub(ep, dir_cache)
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
        "audit_status":      s.audit_status,
        "audit_status_reason": s.audit_status_reason,
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
        "tmdb_id":           getattr(s, "tmdb_id", None),
        "backdrop_url":      getattr(s, "backdrop_url", None),
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
        "audit_status_since":   s.audit_status_since.isoformat() if s.audit_status_since else None,
        "last_hiyori_check_at": s.last_hiyori_check_at.isoformat() if s.last_hiyori_check_at else None,
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
        "quality_name":         ep.quality_name,
        "quality_resolution":   ep.quality_resolution,
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
        "has_cs_sub":           has_cs_sub(ep, dir_cache),
        "watched":              ep.watched or False,
    }


def refresh_series_counts(db, series: Series, use_disk: bool = True) -> None:
    """Recompute and store cached episode/subtitle counts for one series."""
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
    all_eps = [ep for ep in s.episodes if ep.season_number > 0]
    eps_with_file = [ep for ep in all_eps if ep.has_file]
    s.cached_ep_monitored = len(all_eps)
    s.cached_ep_with_file = len(eps_with_file)
    s.cached_cs_sub_count = sum(
        1 for ep in eps_with_file
        if has_cs_sub(ep, dir_cache)
    )
    db.commit()


def _refresh_all_counts_task() -> None:
    """Background task: refresh cached counts for every series (disk scan included). [reload trigger]"""
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
        job_log.finish_run(run, "done", f"{len(series_list)} sérií obnoveno")
    except Exception as exc:
        job_log.finish_run(run, "error", str(exc))
    finally:
        db.close()
