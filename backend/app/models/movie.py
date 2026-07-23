"""movie.py – Movie model for Radarr-sourced content."""
from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text, Float, BigInteger, ForeignKey
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from ..database import Base


class Movie(Base):
    __tablename__ = "movies"

    id          = Column(Integer, primary_key=True, index=True)
    library_id  = Column(Integer, ForeignKey("libraries.id"), nullable=True, index=True)

    # ── Radarr identifiers ────────────────────────────────────────────────────
    radarr_id   = Column(Integer, unique=True, index=True, nullable=False)
    tmdb_id     = Column(Integer, nullable=True, index=True)
    imdb_id     = Column(String, nullable=True)

    # ── Core metadata ─────────────────────────────────────────────────────────
    title           = Column(String, nullable=False)
    original_title  = Column(String, nullable=True)
    sort_title      = Column(String, nullable=True)
    year            = Column(Integer, nullable=True)
    overview        = Column(Text, nullable=True)
    overview_cs     = Column(Text, nullable=True)   # AI-translated Czech (optional)

    # ── Broadcast / release ───────────────────────────────────────────────────
    in_cinemas       = Column(String, nullable=True)   # ISO date
    physical_release = Column(String, nullable=True)   # ISO date
    digital_release  = Column(String, nullable=True)   # ISO date
    runtime          = Column(Integer, nullable=True)  # minutes
    certification    = Column(String, nullable=True)   # "PG-13" etc.

    # ── Images ────────────────────────────────────────────────────────────────
    poster_url   = Column(String, nullable=True)
    backdrop_url = Column(String, nullable=True)
    fanart_url   = Column(String, nullable=True)

    # ── Status & availability ─────────────────────────────────────────────────
    status      = Column(String, nullable=True)   # "released" / "announced" / "inCinemas"
    monitored   = Column(Boolean, default=True)
    has_file    = Column(Boolean, default=False)
    path        = Column(String, nullable=True)   # Radarr root path

    # ── File info ─────────────────────────────────────────────────────────────
    file_path       = Column(String, nullable=True)
    file_size       = Column(BigInteger, nullable=True)  # bytes
    quality_name    = Column(String, nullable=True)
    video_codec     = Column(String, nullable=True)
    audio_codec     = Column(String, nullable=True)
    resolution      = Column(String, nullable=True)
    date_added      = Column(String, nullable=True)

    # ── Ratings ───────────────────────────────────────────────────────────────
    rating_value    = Column(Float, nullable=True)
    rating_votes    = Column(Integer, nullable=True)

    # ── Genres / tags ─────────────────────────────────────────────────────────
    genres          = Column(Text, nullable=True)   # JSON list
    studio          = Column(String, nullable=True)

    # ── Watch tracking ────────────────────────────────────────────────────────
    watch_status    = Column(String, nullable=True)  # plan_to_watch / watching / completed
    watched         = Column(Boolean, default=False)

    # ── Emby ──────────────────────────────────────────────────────────────────
    emby_id         = Column(String, nullable=True)

    # ── Timestamps ────────────────────────────────────────────────────────────
    radarr_added    = Column(String, nullable=True)
    synced_at       = Column(DateTime(timezone=True), nullable=True)
    created_at      = Column(DateTime(timezone=True), server_default=func.now())
    updated_at      = Column(DateTime(timezone=True), onupdate=func.now())

    # ── Relationships ─────────────────────────────────────────────────────────
    library = relationship("Library", back_populates="movies")
