from __future__ import annotations

from datetime import datetime

from sqlalchemy import Column, DateTime, Integer, String, UniqueConstraint

from ..database import Base


class WatchlistItem(Base):
    __tablename__ = "watchlist"
    __table_args__ = (UniqueConstraint("user_id", "anilist_id", name="uq_watchlist_user_anime"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, nullable=False, index=True)
    anilist_id = Column(Integer, nullable=False)
    title = Column(String, nullable=True)
    poster_url = Column(String, nullable=True)
    added_at = Column(DateTime, default=datetime.utcnow, nullable=False)
