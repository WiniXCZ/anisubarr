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
    jobs, users, calendar, filebrowser, subtitle_editor, overseerr,
    api_keys, webhooks, emby, subtitle_sync, promotion,
    settings as settings_router,
    library, subtitle_lines, ai_translate, requests as requests_router,
    downloads, glossary,
)

settings = get_settings()

# Path to the pre-built frontend (created by `npm run build`)
_DIST = Path(__file__).parent.parent.parent / "frontend" / "dist"


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Startup ─────────────────────────
    create_all()
    from .services import scheduler as sched
    sched.start()
    mode = "production (serving frontend)" if _DIST.exists() else "API-only (Vite dev server expected)"
    print(f"[OK] {settings.app_name} v{settings.app_version} started - {mode}")
    yield
    # ── Shutdown ────────────────────────
    from .services import scheduler as sched
    sched.stop()


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    lifespan=lifespan,
)

# CORS – allow any HTTP/HTTPS origin (needed for Vite dev + external access)
# Using allow_origin_regex instead of "*" so it works correctly with allow_credentials=True
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── API routers (must be registered BEFORE the SPA catch-all) ──────────────
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
app.include_router(overseerr.router)
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


@app.get("/api/health")
def health():
    return {"status": "ok", "version": settings.app_version}


# ── Production: serve the built React SPA ──────────────────────────────────
# When `frontend/dist` exists (i.e. after `npm run build`), FastAPI serves
# the complete app so you only need one port (8000) open externally.
if _DIST.exists():
    # Static assets (hashed filenames — long cache is fine)
    app.mount("/assets", StaticFiles(directory=_DIST / "assets"), name="assets")

    # SPA fallback: every non-API path returns index.html so React Router works
    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str):
        # Serve index.html directly from dist root for favicon, manifest, etc.
        candidate = _DIST / full_path
        if candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(_DIST / "index.html")
