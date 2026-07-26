from contextlib import asynccontextmanager
import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .config import get_settings
from .database import create_all

# ── Logging setup ────────────────────────────────────────────────────────────
# Write to /app/backend.log inside Docker (Path(__file__).parent.parent == /app)
_LOG_FILE = Path(__file__).parent.parent / "backend.log"
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(_LOG_FILE, encoding="utf-8"),
    ],
)
from .routers import (
    auth, series, sync, video, subtitles, schedule, paths, nfo,
    jobs, users, calendar, filebrowser, subtitle_editor, seerr,
    api_keys, webhooks, emby, subtitle_sync, promotion,
    settings as settings_router,
    library, subtitle_lines, ai_translate, requests as requests_router,
    downloads, glossary, video_stream, episode_markers, logs,
    qbittorrent, search, dashboard,
    quick_add, discover, watchlist, audit,
    libraries, public, newsletter_admin, backup, services, system,
)

settings = get_settings()

# Path to the pre-built frontend (created by `npm run build`)
_DIST = Path(__file__).parent.parent.parent / "frontend" / "dist"


def _migrate_add_promoted_at() -> None:
    """Add promoted_at column to series table if it doesn't exist (one-time migration)."""
    try:
        from .database import engine
        with engine.connect() as conn:
            result = conn.execute(
                __import__("sqlalchemy").text("PRAGMA table_info(series)")
            )
            cols = [row[1] for row in result]
            if "promoted_at" not in cols:
                conn.execute(__import__("sqlalchemy").text(
                    "ALTER TABLE series ADD COLUMN promoted_at DATETIME"
                ))
                conn.commit()
                print("[migrate] Added promoted_at column to series table")
    except Exception as exc:
        print(f"[WARN] promoted_at migration skipped: {exc}")


def _migrate_seerr_settings() -> None:
    """Copy overseerr_* DB rows -> seerr_* if seerr_* are not yet set (one-time migration)."""
    try:
        from .database import SessionLocal
        from .models.app_settings import AppSetting
        db = SessionLocal()
        try:
            for old_key, new_key in [("overseerr_host", "seerr_host"), ("overseerr_api_key", "seerr_api_key")]:
                new_row = db.query(AppSetting).filter(AppSetting.key == new_key).first()
                if new_row and new_row.value:
                    continue
                old_row = db.query(AppSetting).filter(AppSetting.key == old_key).first()
                if old_row and old_row.value:
                    if new_row:
                        new_row.value = old_row.value
                    else:
                        db.add(AppSetting(key=new_key, value=old_row.value))
            db.commit()
        finally:
            db.close()
    except Exception as exc:
        print(f"[WARN] Seerr migration skipped: {exc}")


def _seed_service_registry() -> None:
    """Seed the connection registry (services table) from existing global config
    on first run so a pre-registry install keeps working without manual setup."""
    try:
        from .database import SessionLocal
        from .services.connections import migrate_legacy_config
        db = SessionLocal()
        try:
            n = migrate_legacy_config(db)
            if n:
                print(f"[migrate] Seeded {n} service(s) into the connection registry")
        finally:
            db.close()
    except Exception as exc:
        print(f"[WARN] Service registry seed skipped: {exc}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # -- Startup --
    create_all()
    _migrate_add_promoted_at()
    _migrate_seerr_settings()
    _seed_service_registry()
    # settings.yaml (editable config mirror) + startup self-heal
    try:
        from .database import SessionLocal as _SL2
        from .services.config_file import import_settings_if_changed
        from .services.selfheal import run_startup_checks
        from .routers import system as _system_router
        _db2 = _SL2()
        try:
            n_yaml = import_settings_if_changed(_db2)
            if n_yaml:
                print(f"[config] settings.yaml: {n_yaml} keys imported")
            _system_router.last_selfheal = run_startup_checks(_db2)
        finally:
            _db2.close()
    except Exception as _exc:
        print(f"[WARN] settings.yaml/selfheal startup pass skipped: {_exc}")
    from .services import job_log as _jl
    _jl.cleanup_stale_running()
    _jl.wal_checkpoint()
    from .services import scheduler as sched
    sched.start()
    import threading
    def _run_fix_promoted():
        try:
            from .database import SessionLocal as _SL
            from .services import promotion as _promo
            _db = _SL()
            _promo.fix_wrongly_promoted(_db, notify=False)
            _db.close()
        except Exception as _exc:
            print(f"[WARN] fix_wrongly_promoted at startup failed: {_exc}")
    threading.Thread(target=_run_fix_promoted, daemon=True).start()
    mode = "production (serving frontend)" if _DIST.exists() else "API-only (Vite dev server expected)"
    print(f"[OK] {settings.app_name} v{settings.app_version} started - {mode} ✓")
    if not settings.webhook_secret:
        print(
            "[WARN] WEBHOOK_SECRET is not set — /api/webhooks/sonarr accepts "
            "unauthenticated requests from anyone who can reach it. "
            "Set WEBHOOK_SECRET in .env and configure the same value as the "
            "X-Webhook-Token header (or ?token=) in Sonarr's webhook settings."
        )
    yield
    # -- Shutdown --
    from .services import scheduler as sched
    sched.stop()


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# -- API routers --
app.include_router(auth.router)
app.include_router(series.router)
app.include_router(sync.router)
app.include_router(video.router)
app.include_router(subtitles.router)
app.include_router(schedule.router)
app.include_router(paths.router)
app.include_router(nfo.router)
app.include_router(jobs.router)
app.include_router(users.router)
app.include_router(calendar.router)
app.include_router(filebrowser.router)
app.include_router(subtitle_editor.router)
app.include_router(seerr.router)
app.include_router(api_keys.router)
app.include_router(webhooks.router)
app.include_router(emby.router)
app.include_router(subtitle_sync.router)
app.include_router(settings_router.router)
app.include_router(promotion.router)
app.include_router(library.router)
app.include_router(subtitle_lines.router)
app.include_router(ai_translate.router)
app.include_router(requests_router.router)
app.include_router(downloads.router)
app.include_router(glossary.router)
app.include_router(video_stream.router)
app.include_router(episode_markers.router)
app.include_router(logs.router)
app.include_router(qbittorrent.router)
app.include_router(search.router)
app.include_router(dashboard.router)
app.include_router(quick_add.router)
app.include_router(discover.router)
app.include_router(watchlist.router)
app.include_router(audit.router)
app.include_router(libraries.router)
app.include_router(public.router)
app.include_router(newsletter_admin.router)
app.include_router(backup.router)
app.include_router(system.router)
app.include_router(services.router)


@app.get("/api/health")
def health():
    return {"status": "ok", "version": settings.app_version}


# -- Production: serve the built React SPA --
if _DIST.exists():
    app.mount("/assets", StaticFiles(directory=_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str):
        candidate = _DIST / full_path
        if candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(_DIST / "index.html")
