from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .config import get_settings
from .database import create_all
from .routers import (
    auth, series, sync, video, subtitles, schedule, paths, nfo,
    jobs, users, calendar, filebrowser, subtitle_editor, seerr,
    api_keys, webhooks, emby, subtitle_sync, promotion,
    settings as settings_router,
    library, subtitle_lines, ai_translate, requests as requests_router,
    downloads, glossary, video_stream, episode_markers, logs,
    qbittorrent, search, dashboard,
    quick_add, discover, watchlist, audit,
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


@asynccontextmanager
async def lifespan(app: FastAPI):
    # -- Startup --
    create_all()
    _migrate_add_promoted_at()
    _migrate_seerr_settings()
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
