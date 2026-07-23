"""
public_main.py – Separate FastAPI app for the public visitor site.

Runs on its own port (see run.py / PUBLIC_PORT), completely separate from the
authenticated admin app in main.py. Only mounts the unauthenticated public API
(routers/public.py) and the static public_site/ frontend — no admin routes,
no login screen, no internal data.
"""
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .config import get_settings
from .routers import public

settings = get_settings()

# frontend build output for the public site — see public_site/ at repo root
_PUBLIC_DIST = Path(__file__).parent.parent.parent / "public_site"

public_app = FastAPI(
    title=f"{settings.app_name} — Veřejný web",
    version=settings.app_version,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

public_app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

public_app.include_router(public.router)


@public_app.get("/api/health")
def health():
    return {"status": "ok", "version": settings.app_version}


if _PUBLIC_DIST.exists():
    @public_app.get("/{full_path:path}", include_in_schema=False)
    async def static_fallback(full_path: str):
        candidate = _PUBLIC_DIST / full_path
        if candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(_PUBLIC_DIST / "index.html")
