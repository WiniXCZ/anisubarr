"""
scheduler.py – APScheduler integration for Anisubarr.

Jobs are defined in JOB_REGISTRY and their schedule/enable state is
persisted in the scheduled_jobs table so users can configure them via UI.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Callable

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

log = logging.getLogger("anisubarr.scheduler")

_scheduler: BackgroundScheduler | None = None


# ──────────────────────────────────────────
# Job implementations
# ──────────────────────────────────────────

def job_sonarr_sync():
    """Pull all series + episodes from Sonarr and update DB."""
    from ..routers.sync import _full_sync
    log.info("[scheduler] sonarr_sync → start")
    _full_sync()
    log.info("[scheduler] sonarr_sync → done")


def job_download_missing():
    """For every monitored episode that has a file but no subtitle, auto-download."""
    from ..database import SessionLocal
    from ..models.series import Episode, Subtitle  # noqa: F401
    from ..routers.subtitles import _fetch_bytes, _save_subtitle
    from .subtitle_utils import extract_subtitle_bytes
    from ..config import get_settings

    settings = get_settings()
    sources  = []
    if settings.hiyori_username and settings.hiyori_password:
        sources.append("hiyori")
    if settings.hns_username and settings.hns_password:
        sources.append("hns")

    if not sources:
        log.warning("[scheduler] download_missing → no scraper credentials configured")
        return

    db = SessionLocal()
    try:
        # Episodes that have a file but no Czech subtitle yet
        # Respects the subtitle_treat_embedded_as_dl setting:
        # if enabled, episodes with embedded CS tracks count as already subtitled.
        from ..routers.subtitles import _already_subbed_ids
        subbed_ep_ids = _already_subbed_ids(db, "cs")
        candidates = (
            db.query(Episode)
            .filter(
                Episode.has_file == True,          # noqa: E712
                Episode.monitored == True,         # noqa: E712
                Episode.file_path.isnot(None),
            )
            .all()
        )
        from ..services.subtitle_langcheck import should_skip_due_to_sk_cooldown
        missing = [
            ep for ep in candidates
            if ep.id not in subbed_ep_ids
            and not should_skip_due_to_sk_cooldown(db, ep.id)
        ]
        log.info(f"[scheduler] download_missing → {len(missing)} episodes without CZ subtitle")

        for ep in missing:
            try:
                from .hiyori import HiyoriScraper
                from .hns import HnsScraper
                results = []
                for src in sources:
                    scraper = (
                        HiyoriScraper(settings.hiyori_username, settings.hiyori_password)
                        if src == "hiyori"
                        else HnsScraper(settings.hns_username, settings.hns_password)
                    )
                    found = scraper.search(
                        title=ep.series.title,
                        season=ep.season_number,
                        episode=ep.episode_number,
                        language="cs",
                    )
                    results.extend(found)
                    if found:
                        break

                if not results:
                    continue

                best      = results[0]
                raw_bytes = _fetch_bytes(best["source"], best["url"])
                sub_bytes, ext = extract_subtitle_bytes(raw_bytes)
                save_path = _save_subtitle(ep, sub_bytes, "cs", ext)

                from ..models.series import Subtitle as SubModel
                sub = SubModel(
                    episode_id=ep.id,
                    language="cs",
                    source=best["source"],
                    file_path=save_path,
                    format=ext,
                )
                db.add(sub)
                db.commit()
                # Okamžitá kontrola jazyka — opraví SK→přejmenuje, příští běh stáhne znovu
                from ..services.subtitle_langcheck import check_and_fix_subtitle
                check_and_fix_subtitle(db, sub)
                log.info(f"[scheduler] ✅ S{ep.season_number:02d}E{ep.episode_number:02d} '{ep.series.title}' → {save_path}")
            except Exception as e:
                log.warning(f"[scheduler] ❌ ep {ep.id}: {e}")
    finally:
        db.close()


def job_anilist_refresh():
    """Re-fetch AniList metadata for series that are missing it."""
    from ..database import SessionLocal
    from ..models.series import Series
    from ..services import anilist as al

    db = SessionLocal()
    try:
        rows = db.query(Series).filter(Series.anilist_id.is_(None)).limit(20).all()
        log.info(f"[scheduler] anilist_refresh → {len(rows)} series without AniList data")
        for s in rows:
            try:
                media = al.search_anime(s.title)
                if media:
                    norm = al.normalize(media)
                    for k, v in norm.items():
                        setattr(s, k, v)
                    db.commit()
            except Exception as e:
                log.warning(f"[scheduler] AniList '{s.title}': {e}")
    finally:
        db.close()


def job_nfo_refresh():
    """Write/refresh NFO files for all series that have a path."""
    from ..database import SessionLocal
    from ..models.series import Series
    from ..services.nfo import write_all_nfo

    db = SessionLocal()
    try:
        rows = db.query(Series).filter(Series.path.isnot(None)).all()
        log.info(f"[scheduler] nfo_refresh → {len(rows)} series")
        ok_total = fail_total = 0
        for s in rows:
            try:
                result = write_all_nfo(s)
                ok_total   += result["ok_count"]
                fail_total += result["fail_count"]
            except Exception as e:
                log.warning(f"[scheduler] NFO '{s.title}': {e}")
        log.info(f"[scheduler] nfo_refresh done — {ok_total} OK, {fail_total} failed")
    finally:
        db.close()


def job_subtitle_langcheck():
    """Zkontroluje jazyk stažených CZ titulků, SK přejmenuje a označí k re-downloadu."""
    from ..database import SessionLocal
    from ..services.subtitle_langcheck import run_langcheck

    db = SessionLocal()
    try:
        result = run_langcheck(db, language_filter="cs")
        log.info(
            f"[scheduler] subtitle_langcheck — "
            f"ok={result['ok']} fixed={result['fixed']} "
            f"skip={result['skipped']} err={result['errors']}"
        )
    finally:
        db.close()


def job_promotion_check():
    """Check all series for promotion eligibility and demote those with Overseerr issues."""
    from ..database import SessionLocal
    from ..services.promotion import run_all_promotions

    db = SessionLocal()
    try:
        results = run_all_promotions(db)
        promoted = sum(1 for r in results if r.get("action") == "promoted")
        demoted  = sum(1 for r in results if r.get("action") == "demoted")
        flagged  = sum(1 for r in results if r.get("action") == "issue_flagged")
        cleared  = sum(1 for r in results if r.get("action") == "issue_cleared")
        log.info(
            f"[scheduler] promotion_check done — "
            f"{promoted} povýšeno, {demoted} degradováno, "
            f"{flagged} označeno, {cleared} vyřešeno"
        )
    except Exception as e:
        log.error(f"[scheduler] promotion_check failed: {e}")
    finally:
        db.close()


def job_ollama_translate():
    """Translate any untranslated overviews using Ollama."""
    from ..database import SessionLocal
    from ..models.series import Series
    from ..services.ollama import translate_to_czech

    db = SessionLocal()
    try:
        rows = (
            db.query(Series)
            .filter(Series.overview.isnot(None), Series.overview_cs.is_(None))
            .limit(10)
            .all()
        )
        log.info(f"[scheduler] ollama_translate → {len(rows)} series to translate")
        for s in rows:
            try:
                result = translate_to_czech(s.overview, "anime synopsis")
                if result:
                    s.overview_cs = result
                    db.commit()
                    log.info(f"[scheduler] translated '{s.title}'")
            except Exception as e:
                log.warning(f"[scheduler] translate '{s.title}': {e}")
    finally:
        db.close()


# ──────────────────────────────────────────
# Registry: job_id → (fn, default_interval, default_hour, name, description)
# ──────────────────────────────────────────

JOB_REGISTRY: dict[str, dict] = {
    "sonarr_sync": {
        "fn":          job_sonarr_sync,
        "name":        "Sonarr sync",
        "description": "Stáhne aktuální seznam seriálů a epizod ze Sonarr",
        "interval":    "daily",
        "hour":        4,
        "minute":      0,
    },
    "download_missing": {
        "fn":          job_download_missing,
        "name":        "Stažení chybějících titulků",
        "description": "Automaticky stáhne CZ titulky pro epizody bez titulků",
        "interval":    "daily",
        "hour":        5,
        "minute":      0,
    },
    "anilist_refresh": {
        "fn":          job_anilist_refresh,
        "name":        "Obnova AniList metadat",
        "description": "Doplní plakáty, popisy a žánry pro seriály bez AniList dat",
        "interval":    "weekly",
        "hour":        3,
        "minute":      0,
        "day_of_week": 0,
    },
    "ollama_translate": {
        "fn":          job_ollama_translate,
        "name":        "Překlad popisů (Ollama)",
        "description": "Přeloží anglické popisy anime do češtiny přes Ollama",
        "interval":    "daily",
        "hour":        6,
        "minute":      0,
    },
    "nfo_refresh": {
        "fn":          job_nfo_refresh,
        "name":        "Obnova NFO souborů",
        "description": "Zapíše/aktualizuje tvshow.nfo a episode .nfo soubory vedle video souborů (čte Emby/Jellyfin/Kodi)",
        "interval":    "weekly",
        "hour":        7,
        "minute":      0,
        "day_of_week": 1,  # Tuesday
    },
    "subtitle_langcheck": {
        "fn":          job_subtitle_langcheck,
        "name":        "Kontrola jazyka titulků",
        "description": "Projde CZ titulky, detekuje slovenské a přejmenuje je — příští download_missing pak stáhne správné",
        "interval":    "daily",
        "hour":        5,
        "minute":      30,
    },
    "promotion_check": {
        "fn":          job_promotion_check,
        "name":        "Kontrola povýšení / degradace",
        "description": "Zkontroluje všechna anime — povýší dokončená (vše staženo) do anime_series složky a degraduje ta s otevřenou issue z Overseerru",
        "interval":    "daily",
        "hour":        8,
        "minute":      0,
    },
}


# ──────────────────────────────────────────
# Trigger builder
# ──────────────────────────────────────────

def _build_trigger(job_row):
    iv = job_row.interval
    h  = job_row.hour   or 3
    m  = job_row.minute or 0

    if iv == "hourly":
        return IntervalTrigger(hours=1, start_date=datetime.now(timezone.utc))
    elif iv == "daily":
        return CronTrigger(hour=h, minute=m)
    elif iv == "weekly":
        dow = job_row.day_of_week if job_row.day_of_week is not None else 0
        return CronTrigger(day_of_week=dow, hour=h, minute=m)
    elif iv == "monthly":
        dom = job_row.day_of_month or 1
        return CronTrigger(day=dom, hour=h, minute=m)
    else:
        return CronTrigger(hour=h, minute=m)


# ──────────────────────────────────────────
# Wrapper that records last_run / last_status
# ──────────────────────────────────────────

def _wrap(job_id: str, fn: Callable):
    def wrapper():
        from ..database import SessionLocal
        from ..models.schedule import ScheduledJob
        from . import job_log

        # Zjisti human-readable název jobu
        job_name = JOB_REGISTRY.get(job_id, {}).get("name", job_id)

        # Zaregistruj spuštění do in-memory logu
        run = job_log.start_run(job_id, job_name)

        db = SessionLocal()
        try:
            fn()
            row = db.query(ScheduledJob).filter(ScheduledJob.job_id == job_id).first()
            if row:
                row.last_run_at = datetime.now(timezone.utc)
                row.last_status = "ok"
                db.commit()
            job_log.finish_run(run, "done")
        except Exception as e:
            log.error(f"[scheduler] {job_id} failed: {e}")
            row = db.query(ScheduledJob).filter(ScheduledJob.job_id == job_id).first()
            if row:
                row.last_run_at = datetime.now(timezone.utc)
                row.last_status = f"error: {str(e)[:200]}"
                db.commit()
            job_log.finish_run(run, "error", str(e)[:300])
        finally:
            db.close()
    wrapper.__name__ = f"wrapped_{job_id}"
    return wrapper


# ──────────────────────────────────────────
# Lifecycle
# ──────────────────────────────────────────

def start(db_session_factory=None):
    """Initialize APScheduler and load jobs from DB."""
    global _scheduler
    if _scheduler and _scheduler.running:
        return

    _ensure_default_jobs()

    _scheduler = BackgroundScheduler(timezone="UTC")

    from ..database import SessionLocal
    from ..models.schedule import ScheduledJob
    db = SessionLocal()
    try:
        rows = db.query(ScheduledJob).all()
        for row in rows:
            if not row.enabled:
                continue
            fn = JOB_REGISTRY.get(row.job_id, {}).get("fn")
            if not fn:
                continue
            trigger = _build_trigger(row)
            _scheduler.add_job(
                _wrap(row.job_id, fn),
                trigger,
                id=row.job_id,
                replace_existing=True,
                misfire_grace_time=3600,
            )
            log.info(f"[scheduler] registered job '{row.job_id}' ({row.interval})")
    finally:
        db.close()

    _scheduler.start()
    log.info("[scheduler] APScheduler started")


def stop():
    global _scheduler
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
        log.info("[scheduler] APScheduler stopped")


def reload_job(job_id: str):
    """Reload a single job from DB (after config change)."""
    global _scheduler
    if not _scheduler:
        return

    from ..database import SessionLocal
    from ..models.schedule import ScheduledJob
    db = SessionLocal()
    try:
        row = db.query(ScheduledJob).filter(ScheduledJob.job_id == job_id).first()
        if not row:
            return

        # Remove existing
        try:
            _scheduler.remove_job(job_id)
        except Exception:
            pass

        if not row.enabled:
            return

        fn = JOB_REGISTRY.get(job_id, {}).get("fn")
        if not fn:
            return

        trigger = _build_trigger(row)
        _scheduler.add_job(
            _wrap(job_id, fn),
            trigger,
            id=job_id,
            replace_existing=True,
            misfire_grace_time=3600,
        )
        log.info(f"[scheduler] reloaded job '{job_id}'")
    finally:
        db.close()


def trigger_now(job_id: str):
    """Run a job immediately (outside its normal schedule)."""
    entry = JOB_REGISTRY.get(job_id)
    if not entry:
        raise ValueError(f"Unknown job: {job_id}")
    _wrap(job_id, entry["fn"])()


def _ensure_default_jobs():
    """Insert default job rows if they don't exist yet."""
    from ..database import SessionLocal
    from ..models.schedule import ScheduledJob
    db = SessionLocal()
    try:
        for job_id, meta in JOB_REGISTRY.items():
            existing = db.query(ScheduledJob).filter(ScheduledJob.job_id == job_id).first()
            if not existing:
                db.add(ScheduledJob(
                    job_id=job_id,
                    name=meta["name"],
                    description=meta.get("description", ""),
                    interval=meta.get("interval", "daily"),
                    hour=meta.get("hour", 3),
                    minute=meta.get("minute", 0),
                    day_of_week=meta.get("day_of_week", 0),
                    day_of_month=meta.get("day_of_month", 1),
                    enabled=True,
                ))
        db.commit()
    finally:
        db.close()


def get_scheduler() -> BackgroundScheduler | None:
    return _scheduler
