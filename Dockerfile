# ─────────────────────────────────────────────────────────────────────────
# anisubarr — single-container build (backend + frontend + alass)
#
# Replaces the old two-container setup (anisubarr-backend + anisubarr-frontend).
# FastAPI serves both the API and the pre-built React SPA from one process
# (see backend/app/main.py — it already mounts frontend/dist when present).
# ─────────────────────────────────────────────────────────────────────────

# ── Stage 1: build the frontend (Vite/React) ───────────────────────────────
FROM node:20-alpine AS frontend-build
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ .
RUN npm run build

# ── Stage 2: build alass from source (no prebuilt-binary version guessing) ─
FROM rust:1-slim AS alass-build
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config \
    && rm -rf /var/lib/apt/lists/*
RUN cargo install alass-cli --root /out
# Produces /out/bin/alass-cli

# ── Stage 3: final image ────────────────────────────────────────────────────
FROM python:3.12-slim

# ffmpeg: subtitle/audio extraction (used by both alass and ffsubsync fallback)
# curl: used by the Docker HEALTHCHECK
# build-essential: webrtcvad (a transitive dep of ffsubsync) ships no prebuilt
# wheel for any Python version — pip always compiles its C extension from
# source, which fails on python:3.12-slim without a compiler present.
# gosu: drops root in the entrypoint so files land owned by PUID/PGID rather
# than by root, which is what let Emby fail to rewrite its own metadata.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg curl build-essential gosu \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend

# requirements.txt includes requirements-core.txt (-r), so both must be copied
COPY backend/requirements.txt backend/requirements-core.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .

# alass binary, installed as plain "alass" to match Settings.alass_path default
COPY --from=alass-build /out/bin/alass-cli /usr/local/bin/alass
RUN chmod +x /usr/local/bin/alass

# Pre-built frontend — main.py serves this automatically when frontend/dist exists
# (path is derived from main.py's own location: backend/app/main.py -> ../../frontend/dist)
COPY --from=frontend-build /build/dist /app/frontend/dist

# Public visitor site — static, no build step (see public_site/)
COPY public_site/ /app/public_site/

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 8000
EXPOSE 8090

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD curl -f http://localhost:8000/api/health || exit 1

# run.py starts both the admin app (ANISUBARR_PORT, default 8000) and the
# public visitor site (PUBLIC_PORT, default 8090 — 8080 is left free since
# that's qBittorrent's default WebUI port) in one process.
# Set PUBLIC_PORT=0 to disable the public site entirely.
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["python", "run.py"]
