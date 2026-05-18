from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.sql import func
from ..database import Base


class AnimeRequest(Base):
    __tablename__ = "anime_requests"

    id            = Column(Integer, primary_key=True, index=True)
    # Linked to existing series in our DB (optional)
    series_id     = Column(Integer, ForeignKey("series.id"), nullable=True)
    # For manual requests not yet in the DB
    custom_title  = Column(String, nullable=True)
    custom_jp     = Column(String, nullable=True)
    anilist_id    = Column(Integer, nullable=True)
    # Requester info
    user_id       = Column(Integer, ForeignKey("users.id"), nullable=True)
    username      = Column(String, nullable=False, default="unknown")
    # Status: pending / approved / rejected
    status        = Column(String, default="pending", nullable=False)
    source        = Column(String, default="manual", nullable=False)  # AniList / AniDB / manual
    note          = Column(Text, nullable=True)
    # Timestamps
    created_at    = Column(DateTime(timezone=True), server_default=func.now())
    updated_at    = Column(DateTime(timezone=True), onupdate=func.now())
