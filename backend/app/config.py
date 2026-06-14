import logging
from functools import lru_cache

from pydantic import model_validator
from pydantic_settings import BaseSettings

log = logging.getLogger("anisubarr.config")

_DEFAULT_JWT_SECRET = "change-me-in-production"


class Settings(BaseSettings):

    @model_validator(mode="after")
    def _check_jwt_secret(self) -> "Settings":
        if self.jwt_secret == _DEFAULT_JWT_SECRET:
            raise ValueError(
                "JWT secret is set to the insecure default value. "
                "Set JWT_SECRET in your .env file to a strong random string."
            )
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
    sonarr_host: str = "192.168.1.149:8989"
    sonarr_api_key: str = ""

    # Ollama
    ollama_host: str = "192.168.1.111:11434"
    ollama_model_translate: str = "qwen2.5:14b"
    ollama_model_agent: str = "qwen2.5:1.5b"

    # SMB / media
    smb_host: str = "192.168.1.149"
    smb_username: str = ""
    smb_password: str = ""
    media_root: str = ""  # e.g. \\192.168.1.149\data\media or /mnt/media

    # Path mapping: Sonarr internal path → locally accessible path
    # Windows dev:  PATH_SONARR_PREFIX=/data  PATH_LOCAL_PREFIX=\\192.168.1.149\data
    # Docker:       PATH_SONARR_PREFIX=/data  PATH_LOCAL_PREFIX=/media
    path_sonarr_prefix: str = "/data"
    path_local_prefix: str  = ""   # must be set in .env

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

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
