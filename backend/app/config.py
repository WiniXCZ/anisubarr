import logging
import secrets
from functools import lru_cache
from pathlib import Path

from pydantic import model_validator
from pydantic_settings import BaseSettings

log = logging.getLogger("anisubarr.config")

_DEFAULT_JWT_SECRET = "change-me-in-production"


def _data_dir(database_url: str) -> Path:
    """Directory holding persistent state (the SQLite file's directory)."""
    if database_url.startswith("sqlite:///"):
        raw = database_url[len("sqlite:///"):]
        p = Path(raw)
        if not p.is_absolute():
            p = Path(__file__).parent.parent / raw  # relative to backend/
        return p.parent
    return Path(__file__).parent.parent / "data"


def _load_or_create_jwt_secret(database_url: str) -> str:
    """Persist an auto-generated JWT secret next to the DB so sessions survive
    restarts even when JWT_SECRET isn't set in the environment. Falls back to a
    per-process random secret (with a loud warning) if the dir isn't writable —
    degraded (logins reset on restart) but never a crash-loop."""
    try:
        d = _data_dir(database_url)
        d.mkdir(parents=True, exist_ok=True)
        f = d / "jwt_secret"
        if f.is_file():
            val = f.read_text(encoding="utf-8").strip()
            if val:
                return val
        val = secrets.token_urlsafe(48)
        f.write_text(val, encoding="utf-8")
        try:
            f.chmod(0o600)
        except OSError:
            pass
        log.warning("JWT_SECRET not set — generated one and stored it in %s", f)
        return val
    except Exception as exc:
        log.error(
            "JWT_SECRET not set and could not persist a generated one (%s) — "
            "using a per-process secret; sessions will reset on restart. "
            "Set JWT_SECRET in the environment to fix this permanently.", exc
        )
        return secrets.token_urlsafe(48)


class Settings(BaseSettings):

    @model_validator(mode="after")
    def _check_jwt_secret(self) -> "Settings":
        if not self.jwt_secret or self.jwt_secret == _DEFAULT_JWT_SECRET:
            self.jwt_secret = _load_or_create_jwt_secret(self.database_url)
        return self

    @model_validator(mode="after")
    def _seerr_backward_compat(self) -> "Settings":
        """Copy overseerr_* → seerr_* if seerr_* are empty (env var rename compat)."""
        if not self.seerr_host and self.overseerr_host:
            self.seerr_host = self.overseerr_host
        if not self.seerr_api_key and self.overseerr_api_key:
            self.seerr_api_key = self.overseerr_api_key
        return self

    # App
    app_name: str = "Anisubarr"
    app_version: str = "0.1.0"
    debug: bool = False

    # JWT
    jwt_secret: str = _DEFAULT_JWT_SECRET
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24 * 7  # 7 days

    # Database
    database_url: str = "sqlite:///./anisubarr.db"

    # Sonarr
    sonarr_host: str = ""           # e.g. 192.168.1.10:8989 — set in .env or Nastavení
    sonarr_api_key: str = ""

    # Ollama
    ollama_host: str = ""           # e.g. 192.168.1.10:11434 — set in .env or Nastavení
    ollama_model_translate: str = "qwen2.5:14b"
    ollama_model_agent: str = "qwen2.5:1.5b"

    # Media access mode: "smb" (network share) or "local" (plain root directory,
    # e.g. a Docker volume mount). See media_access_mode below.
    media_access_mode: str = "local"

    # SMB / media
    smb_host: str = ""
    smb_username: str = ""
    smb_password: str = ""
    media_root: str = ""  # e.g. \\192.168.1.10\data\media, /mnt/media, or a plain local path

    # Path mapping: Sonarr internal path → locally accessible path
    # Windows dev:  PATH_SONARR_PREFIX=/data  PATH_LOCAL_PREFIX=\\192.168.1.149\data
    # Docker:       PATH_SONARR_PREFIX=/data  PATH_LOCAL_PREFIX=/media
    path_sonarr_prefix: str = "/data"
    path_local_prefix: str  = ""   # must be set in .env

    # Optional fallback prefix for cache-only Unraid shares.
    # On Unraid, a share with "use cache: only" creates a relative symlink
    # <share>/<name> -> ../cache/<name> on the host. If PATH_LOCAL_PREFIX
    # (e.g. /media) is bind-mounted from /mnt/user, that symlink resolves to
    # a non-existent /cache/<name> *inside* the container. If a separate
    # /mnt/cache bind mount is exposed at PATH_CACHE_PREFIX (e.g. /cache),
    # resolve() will fall back to "<PATH_CACHE_PREFIX><rest>" when the
    # primary "<PATH_LOCAL_PREFIX><PATH_LOCAL_PREFIX><rest>" path is missing.
    path_cache_prefix: str = ""

    # FFmpeg
    ffmpeg_path: str = "ffmpeg"
    ffprobe_path: str = "ffprobe"

    # alass — subtitle timing sync (https://github.com/kaegi/alass)
    alass_path: str = "alass"

    # Subtitle scrapers
    hiyori_username: str = ""
    hiyori_password: str = ""
    hns_username: str = ""
    hns_password: str = ""
    kamui_username: str = ""
    kamui_password: str = ""
    kamui_rar_password: str = "kamui"
    gensubs_username: str = ""
    gensubs_password: str = ""

    # Ruční složka — subtitles downloaded by hand are searched before the net.
    # Empty means "<data dir>/manual-subs", which the data volume already keeps.
    local_subtitle_dir: str = ""

    # TVDB (used to enrich Discover results with TVDB IDs for Sonarr add)
    tvdb_api_key: str = ""
    tvdb_pin: str = ""

    # AniList (no key needed — public GraphQL API)
    anilist_api: str = "https://graphql.anilist.co"

    # Seerr (dříve Overseerr / Jellyseerr)
    seerr_host: str = ""           # e.g. http://192.168.1.149:5055
    seerr_api_key: str = ""
    seerr_external_url: str = ""   # veřejná adresa, e.g. https://zadosti.luni.ml
    # Backward compat aliases (přečteny při migraci DB při startu)
    overseerr_host: str = ""
    overseerr_api_key: str = ""

    # Emby / Jellyfin
    emby_host: str = ""            # e.g. http://192.168.1.149:8096
    emby_api_key: str = ""
    emby_external_url: str = ""    # e.g. https://emby.mojadomena.cz

    # Webhooks
    webhook_secret: str = ""

    # Public visitor site / newsletter (SMTP) — see public_main.py, routers/public.py
    public_site_url: str = ""      # e.g. https://anime.example.com — used in unsubscribe links
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from_email: str = ""
    smtp_use_tls: str = "true"   # stored/compared as string, matching every other bool setting in this app

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"


@lru_cache()
def get_settings() -> Settings:
    return Settings()


def data_dir() -> Path:
    """Directory holding persistent state (the SQLite file's directory)."""
    return _data_dir(get_settings().database_url)
