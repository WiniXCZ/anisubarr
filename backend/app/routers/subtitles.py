"""
subtitles.py – Subtitle search, download, and management endpoints.

Endpoints:
  POST /api/subtitles/search              → search Hiyori + HnS for one episode
  POST /api/subtitles/download            → download a specific result and save
  POST /api/subtitles/download-best       → auto-pick best result and download
  GET  /api/subtitles/episode/{ep_id}     → list saved subtitles for an episode
  DELETE /api/subtitles/{sub_id}          → remove a subtitle record (not the file)
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, UploadFile, File, Form
from pydantic import BaseModel
from sqlalchemy.orm import Session, subqueryload
from typing import Optional
import os
import threading

from ..database import get_db
from ..deps import get_current_user
from ..models.series import Episode, Subtitle
from ..models.user import User
from ..config import get_settings
from ..utils import CS_LANGS
from ..utils.settings_helper import read_setting as _read_setting
from ..services.hiyori import HiyoriScraper
from ..services.hns import HnsScraper
from ..services.kamui import KamuiScraper
from ..services.gensubs import GenSubsScraper
from ..services.subtitle_utils import extract_subtitle_bytes
from ..services import path_resolver

router  = APIRouter(prefix="/api/subtitles", tags=["subtitles"])
settings = get_settings()


def _sync_after_download(episode_id: int) -> None:
    """Run alass sync for one episode in a background thread (fire-and-forget)."""
    def _run():
        from ..database import SessionLocal
        from ..routers.subtitle_sync import _run_alass
        from ..services import job_log
        db = SessionLocal()
        try:
            from ..models.series import Episode
            ep = db.query(Episode).filter(Episode.id == episode_id).first()
            if not ep:
                return
            label = f"Auto-sync S{ep.season_number:02d}E{ep.episode_number:02d} ({ep.series.title if ep.series else '?'})"
            run = job_log.start_run("subtitle_sync_one", label)
            result = _run_alass(ep)
            status = result.get("status", "error")
            job_log.finish_run(run, "done" if status == "ok" else ("skipped" if status == "skipped" else "error"), result.get("message", ""))
        except Exception as exc:
            import logging
            logging.getLogger("anisubarr.subtitles").warning("Auto-sync failed for ep %d: %s", episode_id, exc)
        finally:
            db.close()

    t = threading.Thread(target=_run, daemon=True)
    t.start()


def _auto_unmonitor_episode(ep) -> None:
    """Unmonitor episode in Sonarr after subtitle download (best-effort, fire-and-forget)."""
    import logging
    log = logging.getLogger("anisubarr.subtitles")
    if not ep or not ep.sonarr_ep_id:
        return
    try:
        from ..services import sonarr as sonarr_svc
        sonarr_svc.set_episodes_monitored([ep.sonarr_ep_id], monitored=False)
        log.info("Auto-unmonitor: episode %d (sonarr_ep_id=%d) unmonitored after subtitle download",
                 ep.id, ep.sonarr_ep_id)
    except Exception as exc:
        log.warning("Auto-unmonitor failed for episode %d: %s", ep.id, exc)


# ──────────────────────────────────────────
# Scraper factory (single instance per call – stateless enough for HTTP)
# ──────────────────────────────────────────


def _scraper_timeout(db=None) -> int:
    raw = _read_setting("scraper_timeout", db)
    try:
        return max(5, int(raw)) if raw else 30
    except (ValueError, TypeError):
        return 30


def _hiyori(db=None) -> HiyoriScraper | None:
    u = _read_setting("hiyori_username", db) or settings.hiyori_username
    p = _read_setting("hiyori_password", db) or settings.hiyori_password
    if u and p:
        return HiyoriScraper(u, p, timeout=_scraper_timeout(db))
    return None

def _hns(db=None) -> HnsScraper | None:
    u = _read_setting("hns_username", db) or settings.hns_username
    p = _read_setting("hns_password", db) or settings.hns_password
    if u and p:
        return HnsScraper(u, p, timeout=_scraper_timeout(db))
    return None

def _kamui(db=None) -> KamuiScraper | None:
    u = _read_setting("kamui_username", db) or settings.kamui_username
    p = _read_setting("kamui_password", db) or settings.kamui_password
    r = _read_setting("kamui_rar_password", db) or settings.kamui_rar_password or "kamui"
    if u and p:
        return KamuiScraper(u, p, rar_password=r, timeout=_scraper_timeout(db))
    return None

def _gensubs(db=None) -> GenSubsScraper:
    u = _read_setting("gensubs_username", db) or getattr(settings, "gensubs_username", "")
    p = _read_setting("gensubs_password", db) or getattr(settings, "gensubs_password", "")
    return GenSubsScraper(u, p)


_DEFAULT_PROVIDER_ORDER = ["hiyori", "hns", "kamui", "gensubs"]


def _get_provider_order(db=None) -> list[str]:
    """Return scraper provider order (DB > legacy setting > default).

    Reads ``scraper_provider_order`` (preferred), falling back to the legacy
    ``subtitle_provider_priority`` key, then the default order. Any known
    provider missing from the configured list is appended at the end so
    every scraper is always tried.

    If ``subtitle_preferred_provider`` is set to a specific provider (i.e.
    not "any"/empty), that provider is moved to the front of the order —
    it acts as an override for auto-download.
    """
    raw = (
        _read_setting("scraper_provider_order", db)
        or _read_setting("subtitle_provider_priority", db)
        or ",".join(_DEFAULT_PROVIDER_ORDER)
    )
    sources = [s.strip() for s in raw.split(",") if s.strip()]
    for src in _DEFAULT_PROVIDER_ORDER:
        if src not in sources:
            sources.append(src)

    preferred = (_read_setting("subtitle_preferred_provider", db) or "").strip().lower()
    if preferred and preferred != "any" and preferred in sources:
        sources = [preferred] + [s for s in sources if s != preferred]

    return sources


# ──────────────────────────────────────────
# Schemas
# ──────────────────────────────────────────

class SearchRequest(BaseModel):
    episode_id: int                  # our DB episode id
    sources: list[str] = ["hiyori", "hns", "kamui", "gensubs"]
    language: str = "cs"

class DownloadRequest(BaseModel):
    episode_id: int
    source: str                      # "hiyori" / "hns" / "kamui" / "gensubs"
    url: str
    title: str = ""
    language: str = "cs"
    auto_sync: bool = False          # run alass after download

class DownloadBestRequest(BaseModel):
    episode_id: int
    sources: list[str] = ["hiyori", "hns", "kamui", "gensubs"]
    language: str = "cs"
    auto_sync: Optional[bool] = None  # None = read from DB setting


# ──────────────────────────────────────────
# Search
# ──────────────────────────────────────────

@router.post("/search")
def search_subtitles(
    req: SearchRequest,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    from ..services import job_log
    ep = _get_episode(db, req.episode_id)
    series_title = ep.series.title
    label = f"Hledání titulků S{ep.season_number:02d}E{ep.episode_number:02d} ({series_title})"
    run = job_log.start_run("subtitle_search", label)

    logs: list[str] = []
    results: list[dict] = []

    def _log(msg: str):
        logs.append(msg)

    _SCRAPERS = {
        "hiyori": (_hiyori,  "Hiyori"),
        "hns":    (_hns,     "HnS"),
        "kamui":  (_kamui,   "Kamui"),
        "gensubs":(_gensubs, "GenSubs"),
    }

    for src in req.sources:
        factory, label = _SCRAPERS.get(src, (None, src))
        if not factory:
            _log(f"[{src}] neznámý zdroj")
            continue
        scraper = factory(db)
        if scraper is None:
            _log(f"[{label}] přihlašovací údaje nejsou nakonfigurovány")
            continue
        try:
            found = scraper.search(
                title=series_title,
                season=ep.season_number,
                episode=ep.episode_number,
                language=req.language,
                status_cb=_log,
            )
            results.extend(found)
        except Exception as e:
            _log(f"[{label}] chyba: {e}")

    # Apply per-provider max_results limit
    max_results_raw = _read_setting("scraper_max_results", db)
    try:
        max_per_provider = int(max_results_raw) if max_results_raw else 0
    except (ValueError, TypeError):
        max_per_provider = 0

    # Deduplicate by URL — same subtitle link from multiple scrapers counts once
    seen_urls: set[str] = set()
    deduped: list[dict] = []
    per_source_counts: dict[str, int] = {}
    for r in results:
        src_key = r.get("source", "")
        if max_per_provider > 0:
            if per_source_counts.get(src_key, 0) >= max_per_provider:
                continue
        url = r.get("url", "")
        # Strip our synthetic params (_ep, _season) for comparison
        from urllib.parse import urlparse as _up, parse_qs as _pq, urlencode as _ue
        _p = _up(url)
        _q = {k: v for k, v in _pq(_p.query).items() if not k.startswith("_")}
        norm_url = _p._replace(query=_ue({k: v[0] for k, v in _q.items()})).geturl()
        if norm_url not in seen_urls:
            seen_urls.add(norm_url)
            deduped.append(r)
            per_source_counts[src_key] = per_source_counts.get(src_key, 0) + 1
        else:
            _log(f"[dedup] duplicitní URL vynechána: {url[:80]}")

    job_log.finish_run(run, "done", f"{len(deduped)} výsledků (celkem {len(results)}, dedup {len(results)-len(deduped)})")
    return {"results": deduped, "log": logs}


# ──────────────────────────────────────────
# Download
# ──────────────────────────────────────────

@router.post("/download")
def download_subtitle(
    req: DownloadRequest,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    from ..services import job_log
    from ..services.subtitle_postprocess import process_subtitle_file
    from ..routers.settings import get_subtitle_postprocess_cfg
    ep = _get_episode(db, req.episode_id)
    label = f"Stažení titulku S{ep.season_number:02d}E{ep.episode_number:02d} ({ep.series.title})"
    run = job_log.start_run("subtitle_download", label)
    try:
        raw_bytes = _fetch_bytes(req.source, req.url, db)
        sub_bytes, ext = extract_subtitle_bytes(raw_bytes)
        save_path = _save_subtitle(ep, sub_bytes, req.language, ext)

        # Apply post-processing (UTF-8 encoding, tag removal, etc.)
        try:
            pp_cfg = get_subtitle_postprocess_cfg(db)
            process_subtitle_file(save_path, pp_cfg)
        except Exception:
            pass  # post-processing is best-effort

        # Prevent duplicate DB records for the same physical file
        existing = db.query(Subtitle).filter(Subtitle.file_path == save_path).first()
        if existing:
            job_log.finish_run(run, "done", f"{req.source} → {ext} (existuje)")
            return {"id": existing.id, "path": save_path, "format": ext, "language": req.language}

        sub = Subtitle(
            episode_id=ep.id,
            language=req.language,
            source=req.source,
            file_path=save_path,
            format=ext,
        )
        db.add(sub)
        db.commit()
        db.refresh(sub)
        lc = _langcheck_after_download(db, sub)   # detekce SK/EN — opraví hned po stažení
        db.refresh(sub)                            # pick up detected_lang written by langcheck
        job_log.finish_run(run, "done", f"{req.source} → {ext}")
        # Fire-and-forget promotion check for this series
        _trigger_promotion_check(ep.series_id)
        # Auto-sync if requested (explicit flag, post-download action setting, or auto_alass_on_download)
        post_action = _read_setting("subtitle_post_download_action", db) or "none"
        should_sync = (
            req.auto_sync
            or post_action == "auto_sync"
            or _read_setting("auto_alass_on_download", db) == "true"
        )
        if should_sync:
            _sync_after_download(ep.id)
        # Auto-unmonitor episode in Sonarr if setting is enabled
        if _read_setting("sonarr_auto_unmonitor_after_download", db) == "true":
            _auto_unmonitor_episode(ep)
        # Auto task: Discord notification after subtitle download
        if _read_setting("auto_discord_on_subtitles", db) != "false":
            try:
                from ..services import discord as discord_svc
                series_obj = ep.series
                ep_label = f"S{ep.season_number:02d}E{ep.episode_number:02d}"
                discord_svc.notify_subtitles_downloaded(
                    title=series_obj.title if series_obj else "?",
                    episode=ep_label,
                    source=req.source,
                    emby_id=getattr(series_obj, "emby_id", None) if series_obj else None,
                    db=db,
                )
            except Exception:
                pass
        resp: dict = {"id": sub.id, "path": save_path, "format": ext, "language": sub.language}
        if not ep.file_path:
            resp["warning"] = "Epizoda nemá cestu k souboru — titulek uložen do dočasného umístění. Po Sonarr sync bude třeba stáhnout znovu."
        if lc and lc.get("action") == "fixed":
            resp["language_warning"] = (
                f"Detekovaný jazyk je {lc['to'].upper()} (ne {lc['from'].upper()}) "
                f"— jistota {lc['conf']:.0%}. Záznam opraven."
            )
        elif sub.detected_lang and sub.detected_lang not in ("??",) and sub.detected_lang != req.language:
            # Low-confidence mismatch — warn but don't auto-correct
            resp["language_warning"] = (
                f"Upozornění: detekovaný jazyk vypadá jako {sub.detected_lang.upper()} "
                f"(očekáváno {req.language.upper()}) — nízká jistota, ponecháno."
            )
        return resp
    except HTTPException:
        raise
    except Exception as e:
        job_log.finish_run(run, "error", str(e)[:300])
        raise HTTPException(500, f"Chyba při stahování: {e}")


@router.post("/download-best")
def download_best(
    req: DownloadBestRequest,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Search and automatically download the first result found."""
    from ..services import job_log
    ep = _get_episode(db, req.episode_id)
    series_title = ep.series.title
    label = f"Auto-stažení S{ep.season_number:02d}E{ep.episode_number:02d} ({series_title})"
    run = job_log.start_run("subtitle_download_best", label)

    _FACTORIES = {"hiyori": _hiyori, "hns": _hns, "kamui": _kamui, "gensubs": _gensubs}
    try:
        results: list[dict] = []
        for source in req.sources:
            factory = _FACTORIES.get(source)
            if not factory:
                continue
            scraper = factory(db)
            if scraper is None:
                continue
            try:
                found = scraper.search(
                    title=series_title,
                    season=ep.season_number,
                    episode=ep.episode_number,
                    language=req.language,
                )
                results.extend(found)
            except Exception:
                pass
            if results:
                break

        if not results:
            job_log.finish_run(run, "error", "Žádné titulky nenalezeny")
            raise HTTPException(404, "Žádné titulky nenalezeny")

        best = results[0]
        raw_bytes = _fetch_bytes(best["source"], best["url"], db)
        sub_bytes, ext = extract_subtitle_bytes(raw_bytes)
        save_path = _save_subtitle(ep, sub_bytes, req.language, ext)

        # Apply post-processing
        try:
            from ..services.subtitle_postprocess import process_subtitle_file
            from ..routers.settings import get_subtitle_postprocess_cfg
            process_subtitle_file(save_path, get_subtitle_postprocess_cfg(db))
        except Exception:
            pass

        # Prevent duplicate DB records for the same physical file
        existing = db.query(Subtitle).filter(Subtitle.file_path == save_path).first()
        if existing:
            job_log.finish_run(run, "done", f"{best['source']} → {ext} (existuje)")
            _trigger_promotion_check(ep.series_id)
            return {"id": existing.id, "path": save_path, "format": ext, "source": best["source"]}

        sub = Subtitle(
            episode_id=ep.id,
            language=req.language,
            source=best["source"],
            file_path=save_path,
            format=ext,
        )
        db.add(sub)
        db.commit()
        db.refresh(sub)
        lc = _langcheck_after_download(db, sub)   # detekce SK
        job_log.finish_run(run, "done", f"{best['source']} → {ext}")
        # Fire-and-forget promotion check for this series
        _trigger_promotion_check(ep.series_id)
        # Auto-sync: explicit param > DB setting
        should_sync = req.auto_sync
        if should_sync is None:
            should_sync = _read_setting("subtitle_auto_sync", db) == "true"
        if should_sync:
            _sync_after_download(ep.id)
        resp: dict = {"id": sub.id, "path": save_path, "format": ext, "source": best["source"]}
        if not ep.file_path:
            resp["warning"] = "Epizoda nemá cestu k souboru — titulek uložen do dočasného umístění."
        if lc and lc.get("action") == "fixed":
            resp["language_warning"] = (
                f"Detekovaný jazyk je {lc['to'].upper()} (ne {lc['from'].upper()}) "
                f"— jistota {lc['conf']:.0%}. Záznam opraven."
            )
        return resp
    except HTTPException:
        raise
    except Exception as e:
        job_log.finish_run(run, "error", str(e)[:300])
        raise


def _download_best_for_episode(ep, db) -> str | None:
    """Download best subtitle for an episode (used by webhook auto-download). Returns source or None."""
    from ..utils.settings_helper import read_setting as _rs
    from ..utils import CS_LANGS
    lang = _rs("subtitle_preferred_language", db) or "cs"

    # Skip search/download entirely if a matching subtitle already exists —
    # avoids wasted scraper requests/rate-limit usage and unnecessary disk writes.
    norm_lang = "cs" if lang in CS_LANGS else lang
    existing = (
        db.query(Subtitle)
        .filter(Subtitle.episode_id == ep.id, Subtitle.language.in_(CS_LANGS if norm_lang == "cs" else [lang]))
        .first()
    )
    if existing or (norm_lang == "cs" and _cs_subtitle_on_disk(ep)):
        return existing.source if existing else None

    sources = _get_provider_order(db)

    _FACTORIES = {"hiyori": _hiyori, "hns": _hns, "kamui": _kamui, "gensubs": _gensubs}
    results: list[dict] = []
    for source in sources:
        factory = _FACTORIES.get(source)
        if not factory:
            continue
        scraper = factory(db)
        if scraper is None:
            continue
        try:
            found = scraper.search(
                title=ep.series.title if ep.series else "",
                season=ep.season_number,
                episode=ep.episode_number,
                language=lang,
            )
            results.extend(found)
        except Exception:
            pass
        if results:
            break

    if not results:
        return None

    best = results[0]
    raw_bytes = _fetch_bytes(best["source"], best["url"], db)
    sub_bytes, ext = extract_subtitle_bytes(raw_bytes)
    save_path = _save_subtitle(ep, sub_bytes, lang, ext)

    try:
        from ..services.subtitle_postprocess import process_subtitle_file
        from ..routers.settings import get_subtitle_postprocess_cfg
        process_subtitle_file(save_path, get_subtitle_postprocess_cfg(db))
    except Exception:
        pass

    existing = db.query(Subtitle).filter(Subtitle.file_path == save_path).first()
    if existing:
        _trigger_promotion_check(ep.series_id)
        return best["source"]

    sub = Subtitle(episode_id=ep.id, language=lang, source=best["source"], file_path=save_path, format=ext)
    db.add(sub)
    db.commit()
    _langcheck_after_download(db, sub)
    _trigger_promotion_check(ep.series_id)
    # Post-download action
    post_action = _read_setting("subtitle_post_download_action", db) or "none"
    if post_action == "auto_sync" or _read_setting("subtitle_auto_sync", db) == "true":
        _sync_after_download(ep.id)
    if _read_setting("sonarr_auto_unmonitor_after_download", db) == "true":
        _auto_unmonitor_episode(ep)
    return best["source"]


# ──────────────────────────────────────────
# Bulk download for a whole series
# ──────────────────────────────────────────

@router.post("/download-all/{series_id}", status_code=202)
def download_all_series(
    series_id: int,
    background_tasks: BackgroundTasks,
    force: bool = False,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Queue background download of missing CZ subtitles for every episode in a series.

    force=True: include episodes that already have subtitles (re-search all).
    """
    from ..models.series import Series

    s = db.query(Series).filter(Series.id == series_id).first()
    if not s:
        raise HTTPException(404, "Series not found")

    if force:
        candidates = [
            ep.id for ep in s.episodes
            if ep.season_number > 0 and ep.has_file
        ]
    else:
        already_subbed = _already_subbed_ids(db, "cs")
        candidates = [
            ep.id for ep in s.episodes
            if ep.season_number > 0 and ep.has_file
            and ep.id not in already_subbed
            and not _cs_subtitle_on_disk(ep)
        ]

    if not candidates:
        raise HTTPException(400, "Žádné epizody se souborem")

    background_tasks.add_task(_download_all_task, series_id, candidates, s.title)
    return {"status": "queued", "count": len(candidates)}


def _download_all_task(series_id: int, episode_ids: list[int], series_title: str):
    import time
    from ..database import SessionLocal
    from ..services import job_log
    from .subtitles import _hiyori, _hns, _kamui, _gensubs, _read_setting, _fetch_bytes, _save_subtitle, _get_provider_order
    from ..services.subtitle_utils import extract_subtitle_bytes
    from ..config import get_settings
    from ..models.app_settings import AppSetting

    settings = get_settings()
    label = f"Hromadné stažení titulků ({series_title}, {len(episode_ids)} epizod)"
    run = job_log.start_run(f"bulk_download_{series_id}", label)

    ok = fail = 0
    error_lines: list[str] = []   # per-episode error details for the final summary
    db = SessionLocal()

    # Read download delay from DB settings (default 2 s to avoid 429)
    try:
        db_row = db.query(AppSetting).filter(AppSetting.key == "subtitle_download_delay").first()
        download_delay = float(db_row.value) if db_row and db_row.value else 2.0
    except Exception:
        download_delay = 2.0

    # Provider priority — read from DB (scraper_provider_order > legacy subtitle_provider_priority),
    # fallback to hiyori→hns→kamui→gensubs. Missing providers are appended automatically.
    sources = _get_provider_order(db)

    # Whether to skip "direct" (cross-site) download links in search results
    skip_ext_row = db.query(AppSetting).filter(AppSetting.key == "subtitle_skip_external_links").first()
    skip_external_links = (skip_ext_row.value if skip_ext_row and skip_ext_row.value else "true") == "true"

    total = len(episode_ids)

    def _msg(text: str) -> None:
        job_log.update_message(run.run_id, text)

    def _prog(current: int, detail: str = "") -> None:
        job_log.update_progress(run.run_id, current, total, detail)

    try:
        for i, ep_id in enumerate(episode_ids):
            ep = db.query(Episode).filter(Episode.id == ep_id).first()
            if not ep:
                error_lines.append(f"ep#{ep_id}: nenalezena v DB")
                fail += 1
                _prog(i + 1)
                continue

            ep_label = f"S{ep.season_number:02d}E{ep.episode_number:02d} {ep.series.title}"
            _prog(i, f"({i+1}/{total}) {ep_label}")
            _msg(f"({i+1}/{total}) {ep_label} — hledám...")

            try:
                results = []
                _FACTORIES_BULK = {"hiyori": _hiyori, "hns": _hns,
                                   "kamui": _kamui, "gensubs": _gensubs}
                found_src = None
                for src in sources:
                    factory = _FACTORIES_BULK.get(src)
                    if not factory:
                        continue
                    scraper = factory(db)
                    if scraper is None:
                        continue
                    _msg(f"({i+1}/{total}) {ep_label} — hledám na {src}...")
                    found = scraper.search(
                        title=ep.series.title,
                        season=ep.season_number,
                        episode=ep.episode_number,
                        language="cs",
                    )
                    results.extend(found)
                    if found:
                        found_src = src
                        break

                # Filter out cross-site "direct" links if setting is enabled
                if skip_external_links:
                    results = [r for r in results if r.get("source") != "direct"]

                if not results:
                    fail += 1
                    error_lines.append(f"{ep_label}: nenalezen titulek")
                    _msg(f"✗ ({i+1}/{total}) {ep_label} — nenalezen na žádném zdroji")
                    _prog(i + 1)
                    continue

                best = results[0]
                _msg(f"({i+1}/{total}) {ep_label} — stahuji z {best['source']}...")
                raw_bytes = _fetch_bytes(best["source"], best["url"], db)
                sub_bytes, ext = extract_subtitle_bytes(raw_bytes)
                _msg(f"({i+1}/{total}) {ep_label} — ukládám {ext}...")
                save_path = _save_subtitle(ep, sub_bytes, "cs", ext)

                # Post-processing (best-effort)
                try:
                    from ..services.subtitle_postprocess import process_subtitle_file
                    from ..routers.settings import get_subtitle_postprocess_cfg
                    process_subtitle_file(save_path, get_subtitle_postprocess_cfg(db))
                except Exception:
                    pass

                # Prevent duplicate DB records for the same physical file
                existing_sub = db.query(Subtitle).filter(Subtitle.file_path == save_path).first()
                if not existing_sub:
                    sub = Subtitle(
                        episode_id=ep.id,
                        language="cs",
                        source=best["source"],
                        file_path=save_path,
                        format=ext,
                    )
                    db.add(sub)
                    db.commit()
                    lc = _langcheck_after_download(db, sub)   # detekce SK
                else:
                    lc = None
                ok += 1
                if lc and lc.get("action") == "fixed":
                    _prog(i + 1, f"⚠ {ep_label} — jazyk: {lc['from']}→{lc['to']}")
                    _msg(
                        f"⚠ ({i+1}/{total}) {ep_label} — detekován {lc['to'].upper()} "
                        f"místo CS ({lc['conf']:.0%}) — soubor přejmenován"
                    )
                else:
                    _prog(i + 1, f"✓ {ep_label} ({best['source']})")
                    _msg(f"✓ ({i+1}/{total}) {ep_label} — {ext} z {best['source']}")

                # Auto-sync after bulk download (check setting)
                if _read_setting("subtitle_auto_sync", db) == "true":
                    from ..routers.subtitle_sync import _run_alass
                    _msg(f"({i+1}/{total}) {ep_label} — synchronizuji alass...")
                    try:
                        sync_result = _run_alass(ep)
                        if sync_result.get("status") == "ok":
                            _msg(f"✓ ({i+1}/{total}) {ep_label} — sync OK")
                        elif sync_result.get("status") == "error":
                            _msg(f"⚠ ({i+1}/{total}) {ep_label} — sync: {sync_result.get('message','')[:80]}")
                    except Exception as sync_exc:
                        _msg(f"⚠ ({i+1}/{total}) {ep_label} — sync chyba: {str(sync_exc)[:80]}")
            except Exception as exc:
                fail += 1
                err_msg = str(exc)[:120]
                error_lines.append(f"{ep_label}: {err_msg}")
                _msg(f"✗ ({i+1}/{total}) {ep_label} — {err_msg}")
                _prog(i + 1)
                # Reset the session so subsequent episodes aren't affected
                try:
                    db.rollback()
                except Exception:
                    pass

            # Rate limit — pause between episodes to avoid 429
            if download_delay > 0 and i < len(episode_ids) - 1:
                _msg(f"({i+1}/{total}) {ep_label} ✓ — čekám {download_delay:.0f}s před dalším...")
                time.sleep(download_delay)

        # Build final summary — show first few error lines so they're visible in the log
        summary_parts = [f"{ok} staženo, {fail} chyb"]
        if error_lines:
            # Show up to 5 error details in the summary message
            shown = error_lines[:5]
            if len(error_lines) > 5:
                shown.append(f"… a {len(error_lines) - 5} dalších")
            summary_parts.append(" | ".join(shown))
        summary = " — ".join(summary_parts)

        if fail == 0:
            status = "done"
        elif ok == 0:
            status = "error"
        else:
            status = "done"  # partial success — still "done" but message shows chyb count
        job_log.finish_run(run, status, summary)
    finally:
        db.close()


# ──────────────────────────────────────────
# Bulk download for multiple series
# ──────────────────────────────────────────

class DownloadAllBulkSeriesRequest(BaseModel):
    series_ids: list[int]


@router.post("/download-all-bulk-series", status_code=202)
def download_all_bulk_series(
    req: DownloadAllBulkSeriesRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Queue background download of missing CZ subtitles for multiple series."""
    from ..models.series import Series

    if not req.series_ids:
        raise HTTPException(400, "series_ids is empty")

    already_subbed = _already_subbed_ids(db, "cs")
    candidates = []
    for s in (
        db.query(Series)
        .options(subqueryload(Series.episodes))
        .filter(Series.id.in_(req.series_ids))
        .all()
    ):
        for ep in s.episodes:
            if (ep.season_number > 0 and ep.has_file
                    and ep.id not in already_subbed
                    and not _cs_subtitle_on_disk(ep)):
                candidates.append(ep.id)

    if not candidates:
        raise HTTPException(400, "Všechny epizody vybraných anime již mají CZ titulky")

    background_tasks.add_task(
        _download_all_task, 0, candidates, f"{len(req.series_ids)} vybraných anime"
    )
    return {"status": "queued", "count": len(candidates)}


# ──────────────────────────────────────────
# Bulk download for specific episodes
# ──────────────────────────────────────────

class DownloadBulkRequest(BaseModel):
    episode_ids: list[int]


@router.post("/download-best-bulk", status_code=202)
def download_best_bulk(
    req: DownloadBulkRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Queue background download of CZ subtitles for specific episode IDs."""
    if not req.episode_ids:
        raise HTTPException(400, "episode_ids is empty")

    already_subbed = _already_subbed_ids(db, "cs")
    candidates = []
    for eid in req.episode_ids:
        if eid in already_subbed:
            continue
        ep = db.query(Episode).filter(Episode.id == eid).first()
        if ep and _cs_subtitle_on_disk(ep):
            continue
        candidates.append(eid)
    if not candidates:
        raise HTTPException(400, "Všechny vybrané epizody již mají CZ titulky")

    background_tasks.add_task(_download_all_task, 0, candidates, f"{len(candidates)} vybraných epizod")
    return {"status": "queued", "count": len(candidates)}


# ──────────────────────────────────────────
# List / Delete
# ──────────────────────────────────────────

@router.get("/episode/{episode_id}")
def list_subtitles(
    episode_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    subs = db.query(Subtitle).filter(Subtitle.episode_id == episode_id).all()
    return [
        {
            "id":          s.id,
            "language":    s.language,
            "source":      s.source,
            "file_path":   s.file_path,
            "format":      s.format,
            "is_embedded": s.is_embedded,
            "downloaded_at": s.downloaded_at.isoformat() if s.downloaded_at else None,
        }
        for s in subs
    ]


@router.post("/upload", status_code=201)
async def upload_subtitle(
    episode_id: int = Form(...),
    language: str = Form("cs"),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Upload a subtitle file from the client and save it next to the episode file."""
    from ..services import job_log
    ep = _get_episode(db, episode_id)
    label = f"Nahrání titulku S{ep.season_number:02d}E{ep.episode_number:02d} ({ep.series.title})"
    run = job_log.start_run("subtitle_upload", label)
    try:
        data = await file.read()
        _, dot_ext = os.path.splitext(file.filename or "")
        ext = dot_ext.lstrip(".").lower() or "srt"
        save_path = _save_subtitle(ep, data, language, ext)

        sub = Subtitle(
            episode_id=ep.id,
            language=language,
            source="upload",
            file_path=save_path,
            format=ext,
        )
        db.add(sub)
        db.commit()
        db.refresh(sub)
        job_log.finish_run(run, "done", f"upload → {ext}")
        return {"id": sub.id, "path": save_path, "format": ext, "language": language}
    except HTTPException:
        job_log.finish_run(run, "error", "HTTP error")
        raise
    except Exception as e:
        job_log.finish_run(run, "error", str(e)[:300])
        raise HTTPException(500, f"Chyba při nahrávání titulku: {e}")


# ──────────────────────────────────────────
# Bulk delete by subtitle IDs
# ──────────────────────────────────────────

class BulkDeleteRequest(BaseModel):
    subtitle_ids: list[int]


@router.delete("/bulk", status_code=204)
def delete_subtitles_bulk(
    req: BulkDeleteRequest,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Delete multiple subtitle records (and their files) by ID."""
    from .subtitle_sync import _unc_to_local
    subs = db.query(Subtitle).filter(Subtitle.id.in_(req.subtitle_ids)).all()
    for sub in subs:
        if sub.file_path and not sub.is_embedded:
            try:
                local_path = _unc_to_local(sub.file_path)
                if os.path.isfile(local_path):
                    os.remove(local_path)
            except Exception:
                pass
        db.delete(sub)
    db.commit()


# ──────────────────────────────────────────
# Language alias expansion
# ──────────────────────────────────────────

# Some subtitle sources store Czech as "cze", "ces", or "cz" instead of "cs".
# When filtering by language we expand these aliases so nothing gets missed.
_LANG_ALIASES: dict[str, set[str]] = {
    "cs": {"cs", "cze", "ces", "cz"},
    "en": {"en", "eng"},
    "ja": {"ja", "jpn"},
    "de": {"de", "ger", "deu"},
    "fr": {"fr", "fre", "fra"},
    "pl": {"pl", "pol"},
    "sk": {"sk", "slk", "slo"},
    "hu": {"hu", "hun"},
    "ru": {"ru", "rus"},
    "zh": {"zh", "chi", "zho"},
    "ko": {"ko", "kor"},
}


def _lang_variants(lang: str) -> list[str]:
    """Return all DB variants for a given language code (e.g. 'cs' → ['cs','cze','ces','cz'])."""
    lower = lang.lower()
    return list(_LANG_ALIASES.get(lower, {lower}))


def _apply_lang_filter(query, language: Optional[str]):
    """Apply a language filter to a Subtitle query, expanding aliases."""
    if not language:
        return query
    variants = _lang_variants(language)
    if len(variants) == 1:
        return query.filter(Subtitle.language == variants[0])
    return query.filter(Subtitle.language.in_(variants))


def _delete_subs(db, subs) -> int:
    """Delete subtitle records and their files from disk. Returns count deleted."""
    from .subtitle_sync import _unc_to_local
    deleted = 0
    for sub in subs:
        if sub.file_path and not sub.is_embedded:
            try:
                local_path = _unc_to_local(sub.file_path)
                if os.path.isfile(local_path):
                    os.remove(local_path)
            except Exception:
                pass
        db.delete(sub)
        deleted += 1
    db.commit()
    return deleted


# ──────────────────────────────────────────
# Bulk delete by episode IDs
# ──────────────────────────────────────────

class DeleteByEpisodesRequest(BaseModel):
    episode_ids: list[int]
    language: Optional[str] = None  # None = all languages


@router.post("/delete-by-episodes", status_code=200)
def delete_subtitles_by_episodes(
    req: DeleteByEpisodesRequest,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Delete all subtitle records (and files) for the given episode IDs.
    Language filter expands aliases (cs → cs/cze/ces/cz, en → en/eng, …).
    """
    from ..services import job_log
    lang_label = req.language.upper() if req.language else "všechny jazyky"
    run = job_log.start_run(
        "subtitle_bulk_delete",
        f"Hromadné mazání titulků ({len(req.episode_ids)} epizod, {lang_label})",
    )
    try:
        query = db.query(Subtitle).filter(Subtitle.episode_id.in_(req.episode_ids))
        query = _apply_lang_filter(query, req.language)
        deleted = _delete_subs(db, query.all())
        job_log.finish_run(run, "done", f"{deleted} titulků smazáno")
        return {"deleted": deleted}
    except Exception as e:
        job_log.finish_run(run, "error", str(e)[:300])
        raise


class DeleteBySeriesRequest(BaseModel):
    series_ids: list[int]
    language: Optional[str] = None


@router.post("/delete-by-series", status_code=200)
def delete_subtitles_by_series(
    req: DeleteBySeriesRequest,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Delete all subtitles for every episode in the given series IDs.
    Language filter expands aliases (cs → cs/cze/ces/cz, …).
    """
    from ..services import job_log
    from ..models.series import Series

    lang_label = req.language.upper() if req.language else "všechny jazyky"
    run = job_log.start_run(
        "subtitle_bulk_delete",
        f"Hromadné mazání titulků ({len(req.series_ids)} anime, {lang_label})",
    )
    try:
        from ..models.series import Episode as _Episode
        ep_ids = [
            row[0]
            for row in db.query(_Episode.id)
            .filter(_Episode.series_id.in_(req.series_ids))
            .all()
        ]
        query = db.query(Subtitle).filter(Subtitle.episode_id.in_(ep_ids))
        query = _apply_lang_filter(query, req.language)
        deleted = _delete_subs(db, query.all())
        job_log.finish_run(run, "done", f"{deleted} titulků smazáno")
        return {"deleted": deleted}
    except Exception as e:
        job_log.finish_run(run, "error", str(e)[:300])
        raise


@router.delete("/{sub_id}", status_code=204)
def delete_subtitle(
    sub_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    sub = db.query(Subtitle).filter(Subtitle.id == sub_id).first()
    if not sub:
        raise HTTPException(404, "Titulek nenalezen")
    # Delete the actual file from disk (UNC → drive letter on Windows)
    if sub.file_path and not sub.is_embedded:
        try:
            from .subtitle_sync import _unc_to_local
            local_path = _unc_to_local(sub.file_path)
            if os.path.isfile(local_path):
                os.remove(local_path)
        except Exception:
            pass  # Don't fail DB delete if file removal fails
    db.delete(sub)
    db.commit()


# ──────────────────────────────────────────
# External subtitle file browser
# ──────────────────────────────────────────

SUBTITLE_EXTENSIONS = {".srt", ".ass", ".ssa", ".vtt", ".sub", ".smi", ".idx", ".sup"}

@router.get("/files/episode/{episode_id}")
def list_subtitle_files(
    episode_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Return external subtitle files found on disk for this episode.

    Returns:
      files_with_lang: [{path: str (local absolute), lang: str}]
      languages:       [str]  (kept for backwards compat)
    """
    import os

    ep = _get_episode(db, episode_id)
    if not ep.file_path:
        return {"files_with_lang": [], "languages": []}

    try:
        local_video = path_resolver.resolve(ep.file_path)
    except Exception:
        return {"files_with_lang": [], "languages": []}

    directory  = os.path.dirname(local_video)
    video_stem = os.path.splitext(os.path.basename(local_video))[0]

    if not os.path.isdir(directory):
        return {"files_with_lang": [], "languages": []}

    files_with_lang: list[dict] = []
    seen_langs: list[str] = []
    try:
        for fname in sorted(os.listdir(directory)):
            full_path = os.path.join(directory, fname)
            if not os.path.isfile(full_path):
                continue
            _, ext = os.path.splitext(fname)
            if ext.lower() not in SUBTITLE_EXTENSIONS:
                continue
            if not fname.startswith(video_stem):
                continue
            # Extract language: Show.S01E01.cs.srt → cs
            stem  = os.path.splitext(fname)[0]          # Show.S01E01.cs
            parts = stem.rsplit(".", 1)
            lang  = "?"
            if len(parts) == 2 and 2 <= len(parts[1]) <= 3 and parts[1].isalpha():
                lang = parts[1].lower()
            files_with_lang.append({"path": full_path, "lang": lang})
            if lang not in seen_langs:
                seen_langs.append(lang)
    except PermissionError:
        pass

    return {"files_with_lang": files_with_lang, "languages": seen_langs}


class DeleteFileBody(BaseModel):
    file_path: str


@router.post("/delete-file", status_code=204)
def delete_subtitle_file(
    body: DeleteFileBody,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Delete a physical subtitle file from disk (not necessarily in DB).
    Accepts both local paths and UNC paths (converted via _unc_to_local).
    """
    file_path = body.file_path
    if not file_path:
        raise HTTPException(400, "file_path required")
    try:
        from .subtitle_sync import _unc_to_local
        local_path = _unc_to_local(file_path)
    except Exception:
        local_path = file_path

    if not os.path.isfile(local_path):
        raise HTTPException(404, f"Soubor nenalezen: {local_path}")
    try:
        os.remove(local_path)
    except Exception as e:
        raise HTTPException(500, str(e))


def _human_size(size: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if size < 1024:
            return f"{size:.0f} {unit}"
        size /= 1024
    return f"{size:.1f} TB"


# ──────────────────────────────────────────
# Internal helpers
# ──────────────────────────────────────────

def _trigger_promotion_check(series_id: int) -> None:
    """Fire-and-forget: refresh cached counts + check promotion for *series_id*."""
    def _task():
        from ..database import SessionLocal
        from ..services import promotion as promo_svc
        from ..models.series import Series as _Series
        from .series import refresh_series_counts
        db = SessionLocal()
        try:
            s = (
                db.query(_Series)
                .filter(_Series.id == series_id)
                .first()
            )
            if s:
                # Refresh cached episode/subtitle counts so the library view updates
                try:
                    refresh_series_counts(db, s, use_disk=True)
                except Exception:
                    pass
                promo_svc.check_and_promote(db, s)
        except Exception:
            pass  # always best-effort — never break subtitle downloads
        finally:
            db.close()

    threading.Thread(target=_task, daemon=True).start()


_CS_DISK_CODES = ("cs", "cz", "cze", "ces")
_SUB_DISK_EXTS  = (".srt", ".ass", ".ssa", ".vtt")


def _cs_subtitle_on_disk(ep) -> bool:
    """Return True if a CS subtitle file already exists on disk next to the episode video.

    Checks for patterns like: Show.S01E01.cs.srt / .cz.ass / .cze.srt etc.
    Skips silently on any path-resolution error (network unavailable etc.).
    """
    if not getattr(ep, "file_path", None):
        return False
    try:
        from ..services import path_resolver
        local_video = path_resolver.unc_to_local(path_resolver.resolve(ep.file_path))
        base = os.path.splitext(local_video)[0]
        for code in _CS_DISK_CODES:
            for ext in _SUB_DISK_EXTS:
                if os.path.isfile(f"{base}.{code}{ext}"):
                    return True
    except Exception:
        pass
    return False


def _already_subbed_ids(db: Session, language: str = "cs") -> set[int]:
    """
    Return episode IDs that are considered "already subtitled" for *language*.

    Always includes episodes with a non-embedded subtitle record.
    When `subtitle_treat_embedded_as_dl` is True, also includes episodes whose
    embedded tracks qualify (respecting the ignore_embedded_* format flags).
    """
    from ..routers.settings import get_subtitle_behavior_cfg, _get_setting
    from ..models.series import Subtitle as _Sub

    lang_filter = list(CS_LANGS) if language == "cs" else [language]

    # 1) Always trust non-embedded subtitle DB records
    ids: set[int] = {
        sub.episode_id
        for sub in db.query(_Sub)
        .filter(_Sub.language.in_(lang_filter), _Sub.is_embedded == False)  # noqa: E712
        .all()
    }

    # 2) Optionally count embedded tracks
    cfg = get_subtitle_behavior_cfg(db)
    if cfg["treat_embedded_as_dl"]:
        # Which embedded formats to ignore (they don't count even if treat_as_dl is on)
        ignore_formats: set[str] = set()
        if cfg["ignore_embedded_pgs"]:
            ignore_formats.add("pgs")
        if cfg["ignore_embedded_vobsub"]:
            ignore_formats.update({"vobsub", "idx", "sub"})
        if cfg["ignore_embedded_ass"]:
            ignore_formats.update({"ass", "ssa"})

        embedded_q = (
            db.query(_Sub)
            .filter(_Sub.language.in_(lang_filter), _Sub.is_embedded == True)  # noqa: E712
            .all()
        )
        for sub in embedded_q:
            fmt = (sub.format or "").lower()
            if fmt not in ignore_formats:
                ids.add(sub.episode_id)

    return ids


def _get_episode(db: Session, episode_id: int) -> Episode:
    ep = db.query(Episode).filter(Episode.id == episode_id).first()
    if not ep:
        raise HTTPException(404, "Epizoda nenalezena")
    return ep


def _fetch_bytes(source: str, url: str, db=None) -> bytes:
    if source == "hiyori":
        scraper = _hiyori(db)
        if not scraper:
            raise HTTPException(400, "Hiyori přihlašovací údaje nejsou nakonfigurovány")
        return scraper.download(url)
    elif source == "hns":
        scraper = _hns(db)
        if not scraper:
            return _direct_download(url)
        return scraper.download(url)
    elif source == "kamui":
        scraper = _kamui(db)
        if not scraper:
            raise HTTPException(400, "Kamui přihlašovací údaje nejsou nakonfigurovány (nastav kamui_username/password v nastavení)")
        return scraper.download(url)
    elif source == "gensubs":
        scraper = _gensubs(db)
        return scraper.download(url)
    elif source == "direct":
        return _direct_download(url)
    else:
        raise HTTPException(400, f"Neznámý zdroj: {source}")


def _direct_download(url: str) -> bytes:
    """Plain HTTP download — no authentication."""
    import httpx as _httpx
    _UA = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    )
    try:
        r = _httpx.get(url, headers={"User-Agent": _UA}, follow_redirects=True, timeout=30)
        r.raise_for_status()
        ct = r.headers.get("content-type", "")
        if "text/html" in ct:
            raise HTTPException(400, f"Server vrátil HTML místo souboru — URL možná vyžaduje přihlášení: {url}")
        return r.content
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Přímé stažení selhalo: {e}")


def _save_subtitle(ep: Episode, data: bytes, language: str, ext: str) -> str:
    """Write subtitle bytes to disk next to the episode file. Returns save path.

    When episode has no file_path (Sonarr hasn't matched the file yet), saves to
    a fallback temp directory so the download is not blocked.
    """
    if not data or len(data) < 10:
        raise HTTPException(400, "Stažený soubor titulku je prázdný — zkus jiný zdroj")

    if ep.file_path:
        dest = path_resolver.subtitle_path_for(ep.file_path, language, ext)
        try:
            path_resolver.write_subtitle(dest, data)
        except PermissionError as e:
            raise HTTPException(403, str(e))
        except Exception as e:
            raise HTTPException(500, f"Chyba při ukládání titulku: {e}")
        return dest

    # No file path yet — try series root, fall back to temp dir
    import re as _re, tempfile as _tmp
    safe_title = _re.sub(r'[\\/:*?"<>|]', '_', ep.series.title or 'unknown')
    series_path = ep.series.path if ep.series else None
    if series_path:
        # Build a Sonarr-style path so path_resolver can translate it
        sep = "/" if "/" in series_path else "\\"
        season_folder = f"Season {ep.season_number:02d}"
        clean_path = series_path.rstrip("/\\")
        fake_ep = (
            f"{clean_path}{sep}{season_folder}{sep}"
            f"{safe_title}.S{ep.season_number:02d}E{ep.episode_number:02d}.mkv"
        )
        dest = path_resolver.subtitle_path_for(fake_ep, language, ext)
        try:
            path_resolver.write_subtitle(dest, data)
            return dest
        except Exception:
            pass  # fall through to temp-dir if series-path write fails
    fallback_dir = os.path.join(_tmp.gettempdir(), "anisubarr_subs", safe_title)
    os.makedirs(fallback_dir, exist_ok=True)
    dest = os.path.join(
        fallback_dir,
        f"S{ep.season_number:02d}E{ep.episode_number:02d}.{language}.{ext}",
    )
    with open(dest, "wb") as f:
        f.write(data)
    return dest


# ─────────────────────────────────────────────────────────────────────────────
# Lang-check hook — volej po každém uložení subtitlu do DB
# ─────────────────────────────────────────────────────────────────────────────

def _langcheck_after_download(db, sub) -> dict | None:
    """
    Okamžitě zkontroluje jazyk čerstvě staženého titulku.
    Pokud detekuje SK/EN (s dostatečnou jistotou), přejmenuje soubor
    a změní language v DB — příští download_missing pak stáhne znovu.
    Spouští se synchronně ale je rychlé (~20 ms čtení souboru).
    Vrátí dict s výsledkem (action, from, to, conf) nebo None při chybě.
    """
    try:
        from ..services.subtitle_langcheck import check_and_fix_subtitle
        result = check_and_fix_subtitle(db, sub)
        if result.get("action") == "fixed":
            import logging
            logging.getLogger("anisubarr.subtitles").warning(
                "[langcheck] EP %s: staženo jako %s, detekováno %s (%.0f%%) — soubor přejmenován, DB opravena",
                sub.episode_id, result["from"], result["to"], result["conf"] * 100,
            )
        return result
    except Exception as e:
        import logging
        logging.getLogger("anisubarr.subtitles").warning(
            f"[langcheck] hook selhal pro sub {sub.id}: {e}"
        )
        return None


# ─────────────────────────────────────────────────────────────────────────────
# API endpoint — hromadná kontrola jazyka
# ─────────────────────────────────────────────────────────────────────────────

class LangCheckRequest(BaseModel):
    language_filter: str = "cs"
    dry_run: bool = False
    min_conf_pct: int = 80   # 0–100


@router.post("/langcheck")
def run_langcheck_endpoint(
    req: LangCheckRequest,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """
    Hromadná kontrola jazyka titulků.

    Projde všechny titulky uložené pod `language_filter` (default 'cs'),
    detekuje jejich skutečný jazyk a pokud je rozdíl:
      - přejmenuje soubor (cs→sk v názvu)
      - aktualizuje language + detected_lang v DB
      - příští download_missing pak epizodu opět označí jako bez CZ titulku

    dry_run=true jen hlásí co by udělal, nic nepřejmenovává.
    """
    from ..services.subtitle_langcheck import run_langcheck

    results = run_langcheck(
        db=db,
        language_filter=req.language_filter,
        dry_run=req.dry_run,
        min_conf=req.min_conf_pct / 100.0,
    )
    return results
