"""service.py – Connection registry model.

A single row per external service instance (Sonarr, Radarr, Prowlarr,
qBittorrent, Emby, Seerr, …). This is the one place connections live; libraries
reference services from here instead of embedding host/api_key of their own, and
the backend resolves "which Sonarr" through this table rather than reading the
global settings in eight different spots.

Multiple instances of the same type are allowed (e.g. two Sonarrs). Exactly one
instance per type may be marked ``is_default`` — that's the one used when nothing
scopes the request to a specific instance (dashboards, quick-add, path probing).
"""
from sqlalchemy import Column, Integer, String, Boolean, DateTime
from sqlalchemy.sql import func

from ..database import Base

# Known service types. Kept permissive (plain string column) so adding a new
# type later doesn't need a migration, but this list drives UI/validation.
SERVICE_TYPES = (
    # Integrations (host + api_key)
    "sonarr", "radarr", "prowlarr", "jackett", "qbittorrent", "emby", "seerr",
    # Subtitle providers (username + password; no host — the site is fixed)
    "hiyori", "hns", "kamui", "gensubs",
)

# Types that are subtitle sources rather than service integrations. They share
# this table so the registry, CRUD and UI stay one mechanism instead of two.
SUBTITLE_PROVIDER_TYPES = ("hiyori", "hns", "kamui", "gensubs")


class Service(Base):
    __tablename__ = "services"

    id         = Column(Integer, primary_key=True, index=True)
    name       = Column(String, nullable=False)                 # user-facing label
    type       = Column(String, nullable=False, index=True)     # see SERVICE_TYPES
    host       = Column(String, nullable=True)                  # base url / host:port
    api_key    = Column(String, nullable=True)
    username   = Column(String, nullable=True)                  # qBittorrent etc.
    password   = Column(String, nullable=True)
    enabled    = Column(Boolean, default=True,  nullable=False)
    is_default = Column(Boolean, default=False, nullable=False)  # default instance of its type
    sort_order = Column(Integer, default=0, nullable=False)      # provider priority (lower = tried first)
    extra      = Column(String, nullable=True)                   # provider-specific extra (e.g. Kamui RAR password)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
