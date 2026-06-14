"""
scheduler.py – APScheduler integration for Anisubarr.

Jobs are defined in JOB_REGISTRY and their schedule/enable state is
persisted in the scheduled_jobs table so users can configure them via UI.
"""
from __future__ import annotations

import logging
import threading
from datetime import datetime, timezone
from typing import Callable

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

log = logging.getLogger("anisubarr.scheduler")

_scheduler: BackgroundScheduler | None = None

# Tracks job_ids currently executing, so trigger_now() can refuse to
# start a second concurrent run of the same job.
_running_jobs: set[str] = set()
_running_lock = threading.Lock()


# ──────────────────────────────────────────
# Job implementations
# ──────────────────────────────────────────

def job_sonarr_sync():
    """Pull all series + episodes from Sonarr and update DB."""
    from ..routers.sync import _full_sync
    log.info("[scheduler] sonarr_sync → start")
    _full_sync()
    log.info("[scheduler] sonarr_sync → done")

    # New episodes/subtitles may have arrived — re-evaluate audit state
    _run_audit_recheck("sonarr_sync")


def job_download_missing():
    """For every monitored episode that has a file but no subtitle, auto-download."""
    from ..database import SessionLocal
    from ..models.series import Episode, Subtitle  # noqa: F401
    from ..routers.subtitles import _fetch_bytes, _save_subtitle
    from .subtitle_utils import extract_subtitle_bytes
    from ..utils.settings_helper import read_setting

    db = SessionLocal()
    try:
        hiyori_user = read_setting("hiyori_username", db)
        hiyori_pass = read_setting("hiyori_password", db)
        hns_user    = read_setting("hns_username", db)
        hns_pass    = read_setting("hns_password", db)

        sources = []
        if hiyori_user and hiyori_pass:
            sources.append("hiyori")
        if hns_user and hns_pass:
            sources.append("hns")

        if not sources:
            log.warning("[scheduler] download_missing → no scraper credentials configured")
            return
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
        from datetime import timedelta
        from ..models.series import Subtitle as _Sub
        from ..services.subtitle_langcheck import LANGCHECK_COOLDOWN_HOURS
        cutoff = datetime.now(timezone.utc) - timedelta(hours=LANGCHECK_COOLDOWN_HOURS)
        sk_cooldown_ids = {
            sub.episode_id
            for sub in db.query(_Sub).filter(
                _Sub.detected_lang == "sk",
                _Sub.downloaded_at >= cutoff,
            ).all()
        }
        missing = [
            ep for ep in candidates
            if ep.id not in subbed_ep_ids
            and ep.id not in sk_cooldown_ids
        ]
        log.info(f"[scheduler] download_missing → {len(missing)} episodes without CZ subtitle")

        # Per-series log of search attempts/results from this run, written to
        # SeriesAuditLog (event_type="subtitle_search") after the loop so the
        # user can see in the series detail "Log" tab where it searched and
        # what the outcome was.
        series_search_log: dict[int, list[dict]] = {}

        for ep in missing:
            ep_id = ep.id  # cache before any operation that might expire the ORM object
            ep_label = f"S{ep.season_number:02d}E{ep.episode_number:02d}"
            series_id = ep.series_id
            tried_sources: list[str] = []
            try:
                from .hiyori import HiyoriScraper
                from .hns import HnsScraper
                results = []
                for src in sources:
                    tried_sources.append(src)
                    scraper = (
                        HiyoriScraper(hiyori_user, hiyori_pass)
                        if src == "hiyori"
                        else HnsScraper(hns_user, hns_pass)
                    )
                    found = scraper.search(
                        title=ep.series.title if ep.series else "",
                        season=ep.season_number,
                        episode=ep.episode_number,
                        language="cs",
                    )
                    results.extend(found)
                    if found:
                        break

                # Skip "direct" cross-site links (e.g. ange.3mka.cz) —
                # they are often geo-blocked for server IPs or require login.
                results = [r for r in results if r.get("source") != "direct"]

                if not results:
                    series_search_log.setdefault(series_id, []).append({
                        "episode": ep_label,
                        "sources_tried": tried_sources,
                        "status": "not_found",
                    })
                    continue

                best      = results[0]
                raw_bytes = _fetch_bytes(best["source"], best["url"], db=db)
                sub_bytes, ext = extract_subtitle_bytes(raw_bytes)
                save_path = _save_subtitle(ep, sub_bytes, "cs", ext)

                from ..models.series import Subtitle as SubModel
                sub = SubModel(
                    episode_id=ep_id,
                    language="cs",
                    source=best["source"],
                    file_path=save_path,
                    format=ext,
                )
                db.add(sub)
                db.commit()
                # Okamžitá kontrola jazyka — opraví SK→přejmenuje, příský běh stáhne znovu
                from ..services.subtitle_langcheck import check_and_fix_subtitle
                check_and_fix_subtitle(db, sub)
                log.info(f"[scheduler] ✅ S{ep.season_number:02d}E{ep.episode_number:02d} '{ep.series.title if ep.series else '?'}' → {save_path}")
                series_search_log.setdefault(series_id, []).append({
                    "episode": ep_label,
                    "sources_tried": tried_sources,
                    "status": "downloaded",
                    "source": best["source"],
                })
            except Exception as e:
                db.rollback()  # reset PendingRollback state so next iteration has a clean session
                log.warning(f"[scheduler] ❌ ep {ep_id}: {e}")
                series_search_log.setdefault(series_id, []).append({
                    "episode": ep_label,
                    "sources_tried": tried_sources,
                    "status": "error",
                    "error": str(e),
                })

        # Write per-series audit log entries summarizing this run's searches
        if series_search_log:
            import json
            from ..services.audit import _log_event
            for sid, entries in series_search_log.items():
                downloaded = [e for e in entries if e["status"] == "downloaded"]
                not_found  = [e for e in entries if e["status"] == "not_found"]
                errors     = [e for e in entries if e["status"] == "error"]
                parts = []
                if downloaded:
                    parts.append(f"nalezeno {len(downloaded)}")
                if not_found:
                    parts.append(f"nenalezeno {len(not_found)}")
                if errors:
                    parts.append(f"chyba {len(errors)}")
                summary = ", ".join(parts) if parts else "žádný výsledek"
                message = f"Hledání titulků (denní úloha): {len(entries)} epizod — {summary}"
                try:
                    _log_event(db, sid, "subtitle_search", message, detail=json.dumps(entries, ensure_ascii=False))
                except Exception as e:
                    db.rollback()
                    log.warning(f"[scheduler] subtitle_search log series {sid}: {e}")
    finally:
        db.close()

    # New subtitles may have arrived — re-evaluate audit state
    _run_audit_recheck("download_missing")


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
    from ..utils.settings_helper import read_setting

    db = SessionLocal()
    try:
        # Respektuj nastavení langcheck_enabled (AppSetting override)
        enabled_str = read_setting("langcheck_enabled", db) or "true"
        if enabled_str.strip().lower() in ("false", "0", "no"):
            log.info("[scheduler] subtitle_langcheck přeskočen (langcheck_enabled=false)")
            return

        result = run_langcheck(
            db,
            language_filter="cs",
            dry_run=False,
            min_conf=0.80,
        )
        log.info(
            f"[scheduler] subtitle_langcheck — "
            f"total={result['total']} ok={result['ok']} fixed={result['fixed']} "
            f"skip={result['skipped']} err={result['errors']}"
        )
    finally:
        db.close()


def job_promotion_check():
    """Check all series for promotion eligibility and demote those with Seerr issues."""
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

    # Seerr issues may have changed has_issue flags — re-evaluate audit state
    _run_audit_recheck("promotion_check")


def _run_audit_recheck(trigger: str):
    """Event-driven re-audit helper — call after syncs / issue changes that
    could affect subtitle_confidence or damage_ratio. Best-effort, never
    raises into the calling job."""
    from ..database import SessionLocal
    from ..utils.settings_helper import read_setting as _rs
    from ..services.audit import audit_all

    db = SessionLocal()
    try:
        if _rs("audit_enabled", db) == "false":
            return
        results = audit_all(db)
        changed = sum(1 for r in results if r.get("changed"))
        if changed:
            log.info(f"[scheduler] audit recheck ({trigger}) → {changed}/{len(results)} stavů změněno")
    except Exception as e:
        log.warning(f"[scheduler] audit recheck ({trigger}) failed: {e}")
    finally:
        db.close()


def job_audit_check():
    """Re-run the subtitle audit / state-machine for all series."""
    from ..database import SessionLocal
    from ..services.audit import audit_all

    db = SessionLocal()
    try:
        results = audit_all(db)
        changed = sum(1 for r in results if r.get("changed"))
        log.info(f"[scheduler] audit_check done — {len(results)} seriálů, {changed} změn stavu")
    except Exception as e:
        log.error(f"[scheduler] audit_check failed: {e}")
    finally:
        db.close()


def job_seerr_sync():
    """Sync Seerr requests into local DB cache."""
    import json
    import httpx
    from datetime import datetime, timezone
    from ..database import SessionLocal

    db = SessionLocal()
    try:
        from ..models.seerr_cache import SeerrRequestCache
        try:
            from ..routers.seerr import _get_seerr_cfg
            base_url, api_key = _get_seerr_cfg(db)
        except Exception:
            log.warning("[scheduler] seerr_sync → Seerr není nakonfigurován, přeskakuji")
            return

        skip, take = 0, 50
        all_results: list[dict] = []
        max_retries = 3

        while True:
            data = None
            for attempt in range(1, max_retries + 1):
                try:
                    r = httpx.get(
                        f"{base_url}/request",
                        headers={"X-Api-Key": api_key},
                        params={"take": take, "skip": skip, "filter": "all", "sort": "modified"},
                        timeout=15,
                    )
                    r.raise_for_status()
                    data = r.json()
                    break
                except Exception as e:
                    if attempt < max_retries:
                        log.warning(
                            f"[scheduler] seerr_sync → fetch failed (attempt {attempt}/{max_retries}, skip={skip}): {e}"
                        )
                    else:
                        log.error(
                            f"[scheduler] seerr_sync → fetch failed after {max_retries} attempts (skip={skip}): {e}"
                        )

            if data is None:
                # All retries for this page failed — stop pagination but keep
                # whatever pages were already fetched.
                break

            results = data.get("results") or []
            all_results.extend(results)
            total = data.get("totalResults") or 0
            if skip + take >= total or not results:
                break
            skip += take

        now = datetime.now(timezone.utc)
        for req_data in all_results:
            media    = req_data.get("media") or {}
            requester = (req_data.get("requestedBy") or {}).get("displayName", "")
            raw       = json.dumps(req_data)

            existing = db.query(SeerrRequestCache).filter(
                SeerrRequestCache.seerr_id == req_data["id"]
            ).first()

            # TV shows: Seerr/Jellyseerr may return "name" instead of "title"
            media_title = (media.get("title") or media.get("name")
                           or media.get("originalName") or media.get("originalTitle") or "")
            poster_path = media.get("posterPath") or media.get("poster_path") or ""

            if existing:
                existing.media_title  = media_title
                existing.media_type   = media.get("mediaType", "")
                existing.poster_path  = poster_path
                existing.status       = req_data.get("status")
                existing.requested_by = requester
                existing.updated_at   = now
                existing.raw_json     = raw
                existing.synced_at    = now
            else:
                db.add(SeerrRequestCache(
                    seerr_id     = req_data["id"],
                    media_title  = media_title,
                    media_type   = media.get("mediaType", ""),
                    poster_path  = poster_path,
                    status       = req_data.get("status"),
                    requested_by = requester,
                    created_at   = now,
                    updated_at   = now,
                    raw_json     = raw,
                    synced_at    = now,
                ))

        db.commit()
        log.info(f"[scheduler] seerr_sync → {len(all_results)} požadavků synchronizováno")
    except Exception as e:
        log.error(f"[scheduler] seerr_sync failed: {e}")
    finally:
        db.close()

    # New/changed Seerr issues may affect damage_ratio — re-evaluate audit state
    _run_audit_recheck("seerr_sync")


def job_wal_checkpoint():
    """Run a SQLite WAL checkpoint to prevent unbounded WAL file growth."""
    from . import job_log as _jl
    _jl.wal_checkpoint()
    log.debug("[scheduler] WAL checkpoint done")


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
        "description": "Projde CZ titulky, detekuje slovenské a přejmenuje je — příský download_missing pak stáhne správné",
        "interval":    "daily",
        "hour":        3,
        "minute":      0,
    },
    "promotion_check": {
        "fn":          job_promotion_check,
        "name":        "Kontrola povýšení / degradace",
        "description": "Zkontroluje všechna anime — povýší dokončená (vše staženo) do anime_series složky a degraduje ta s otevřenou issue z Seerr",
        "interval":    "daily",
        "hour":        8,
        "minute":      0,
    },
    "seerr_sync": {
        "fn":          job_seerr_sync,
        "name":        "Seerr cache sync",
        "description": "Synchronizuje požadavky ze Seerr do lokální DB cache (výchozí každých 10 min)",
        "interval":    "10min",
        "hour":        None,
        "minute":      None,
    },
    "wal_checkpoint": {
        "fn":          job_wal_checkpoint,
        "name":        "WAL checkpoint",
        "description": "Provede SQLite WAL checkpoint, aby nerostl neomezeně wal soubor databáze",
        "interval":    "1h",
        "hour":        None,
        "minute":      None,
    },
    "audit_check": {
        "fn":          job_audit_check,
        "name":        "Audit titulků",
        "description": "Přehodnotí stav titulků/poškození u všech seriálů (CLEAN/PENDING/ABANDONED/DAMAGED/PARTIAL/PENDING_TRANSLATION)",
        "interval":    "1h",
        "hour":        None,
        "minute":      None,
    },
}


# ──────────────────────────────────────────
# Trigger builder
# ──────────────────────────────────────────

def _build_trigger(job_row):
    iv = job_row.interval or "daily"
    h  = job_row.hour   or 3
    m  = job_row.minute or 0

    if iv == "30s":
        return IntervalTrigger(seconds=30, start_date=datetime.now(timezone.utc))
    elif iv == "hourly" or iv == "1h":
        return IntervalTrigger(hours=1, start_date=datetime.now(timezone.utc))
    elif iv.endswith("min"):
        try:
            mins = int(iv[:-3])
            return IntervalTrigger(minutes=mins, start_date=datetime.now(timezone.utc))
        except (ValueError, AttributeError):
            pass
    elif iv.endswith("h"):
        try:
            hours = int(iv[:-1])
            return IntervalTrigger(hours=hours, start_date=datetime.now(timezone.utc))
        except (ValueError, AttributeError):
            pass
    elif iv == "daily":
        return CronTrigger(hour=h, minute=m)
    elif iv == "weekly":
        dow = job_row.day_of_week if job_row.day_of_week is not None else 0
        return CronTrigger(day_of_week=dow, hour=h, minute=m)
    elif iv == "monthly":
        dom = job_row.day_of_month or 1
        return CronTrigger(day=dom, hour=h, minute=m)
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

        # Avoid overlapping runs of the same job (e.g. manual trigger while
        # the scheduled run is still in progress).
        with _running_lock:
            if job_id in _running_jobs:
                log.info(f"[scheduler] {job_id} already running, skipping this run")
                return
            _running_jobs.add(job_id)

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
            with _running_lock:
                _running_jobs.discard(job_id)
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
    _ensure_default_settings()

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


def is_running(job_id: str) -> bool:
    """Whether the given job is currently executing."""
    with _running_lock:
        return job_id in _running_jobs


def trigger_now(job_id: str):
    """Run a job immediately (outside its normal schedule)."""
    entry = JOB_REGISTRY.get(job_id)
    if not entry:
        raise ValueError(f"Unknown job: {job_id}")
    with _running_lock:
        if job_id in _running_jobs:
            raise ValueError(f"Job '{job_id}' is already running")
    _wrap(job_id, entry["fn"])()


def _ensure_default_settings():
    """Insert default AppSetting rows for langcheck if they don't exist yet."""
    from ..database import SessionLocal
    from ..models.app_settings import AppSetting
    defaults = {
        "langcheck_enabled": "true",
        "langcheck_hour":    "3",
        # ── Subtitle audit / state-machine thresholds ──────────────────
        "audit_enabled":                 "true",
        # Logic 1 — tail-tolerance freshness windows (days)
        "audit_tail_high_tolerance_days": "7",
        "audit_tail_low_tolerance_days":  "30",
        "audit_tail_low_max_episodes":    "2",
        # Logic 4 — how often to re-check hiyori.cz for planned/revived status
        "audit_hiyori_check_interval_hours": "24",
    }
    db = SessionLocal()
    try:
        for key, value in defaults.items():
            existing = db.query(AppSetting).filter(AppSetting.key == key).first()
            if not existing:
                db.add(AppSetting(key=key, value=value))
        db.commit()
    finally:
        db.close()


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
                    description=meta.get("description"),
                    interval=meta.get("interval", "daily"),
                    hour=meta.get("hour"),
                    minute=meta.get("minute", 0),
                    day_of_week=meta.get("day_of_week"),
                    day_of_month=meta.get("day_of_month"),
                    enabled=True,
                ))
        db.commit()
    finally:
        db.close()
