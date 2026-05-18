from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # App
    app_name: str = "Anisubarr"
    app_version: str = "0.1.0"
    debug: bool = False

    # JWT
    jwt_secret: str = "change-me-in-production"
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

    # AniList (no key needed — public GraphQL API)
    anilist_api: str = "https://graphql.anilist.co"

    # Overseerr / Jellyseerr
    overseerr_host: str = ""       # e.g. http://192.168.1.149:5055
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


@lru_cache()
def get_settings() -> Settings:
    return Settings()
