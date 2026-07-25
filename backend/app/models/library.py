"""library.py – Library / multi-source configuration model."""
from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from ..database import Base


class Library(Base):
    """Represents a media library connected to one or more external services.

    media_type:
        "anime"   – Sonarr, AniList enrichment, subtitle scraping, translation
        "series"  – Sonarr (second instance), no AniList/translation/TD
        "movies"  – Radarr, no subtitles/translation (configurable)
    """
    __tablename__ = "libraries"

    id          = Column(Integer, primary_key=True, index=True)
    name        = Column(String, nullable=False)
    media_type  = Column(String, nullable=False, default="series")  # anime / series / movies
    sort_order  = Column(Integer, default=0, nullable=False)
    enabled     = Column(Boolean, default=True, nullable=False)

    # ── Connection registry link (preferred) ─────────────────────────────────
    # New model: a library points at a Service instance from the registry
    # instead of embedding host/api_key. The legacy embedded columns below stay
    # for backward compat during the migration and are phased out afterwards.
    sonarr_service_id = Column(Integer, nullable=True, index=True)

    # ── Sonarr (legacy embedded — deprecated) ─────────────────────────────────
    sonarr_host    = Column(String, nullable=True)
    sonarr_api_key = Column(String, nullable=True)

    # ── Radarr ───────────────────────────────────────────────────────────────
    radarr_host    = Column(String, nullable=True)
    radarr_api_key = Column(String, nullable=True)

    # ── Indexer (Prowlarr / Jackett) ─────────────────────────────────────────
    indexer_host    = Column(String, nullable=True)
    indexer_api_key = Column(String, nullable=True)
    indexer_type    = Column(String, nullable=True)  # "prowlarr" / "jackett"

    # ── Torrent downloader (qBittorrent) ─────────────────────────────────────
    torrent_host     = Column(String, nullable=True)
    torrent_username = Column(String, nullable=True)
    torrent_password = Column(String, nullable=True)

    # ── NZB downloader (NZBGet / SABnzbd) ────────────────────────────────────
    nzb_host    = Column(String, nullable=True)
    nzb_api_key = Column(String, nullable=True)
    nzb_type    = Column(String, nullable=True)   # "nzbget" / "sabnzbd"

    # ── Feature toggles ───────────────────────────────────────────────────────
    subtitles_enabled   = Column(Boolean, default=True,  nullable=False)
    translation_enabled = Column(Boolean, default=True,  nullable=False)
    anilist_enabled     = Column(Boolean, default=False, nullable=False)  # AniList enrichment

    # ── Timestamps ────────────────────────────────────────────────────────────
    created_at  = Column(DateTime(timezone=True), server_default=func.now())
    updated_at  = Column(DateTime(timezone=True), onupdate=func.now())

    # ── Relationships ─────────────────────────────────────────────────────────
    series = relationship("Series", back_populates="library", lazy="dynamic")
    movies = relationship("Movie",  back_populates="library", lazy="dynamic")
