from __future__ import annotations

from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, DateTime, Text

from ..database import Base


class SeerrRequestCache(Base):
    __tablename__ = "seerr_request_cache"

    id           = Column(Integer, primary_key=True, autoincrement=True)
    seerr_id     = Column(Integer, unique=True, nullable=False, index=True)
    media_title  = Column(String)
    media_type   = Column(String)
    poster_path  = Column(String)
    status       = Column(Integer)
    requested_by = Column(String)
    created_at   = Column(DateTime(timezone=True))
    updated_at   = Column(DateTime(timezone=True))
    raw_json     = Column(Text)
    synced_at    = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
