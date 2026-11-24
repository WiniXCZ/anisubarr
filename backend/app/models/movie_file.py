"""movie_file.py – one video file of a movie on disk, as the movie scan saw it.

Filled by services/movie_scan.py straight from the disk (ffprobe), independent
of Radarr: the table must show what is really in the file — resolution, HDR,
every audio track with its language and channel count, embedded and external
subtitles — and whether the file is actually playable (verification).
"""
from sqlalchemy import Column, Integer, String, BigInteger, Float, DateTime, Text
from ..database import Base


class MovieFile(Base):
    __tablename__ = "movie_files"

    id          = Column(Integer, primary_key=True, index=True)
    path        = Column(String, unique=True, index=True, nullable=False)
    root        = Column(String, nullable=True)          # scanned root it lives under
    title       = Column(String, nullable=True)          # from the folder name "Title (Year)"
    year        = Column(Integer, nullable=True)
    size        = Column(BigInteger, nullable=True)
    mtime       = Column(Float, nullable=True)            # change detection: size + mtime

    # ── Probe ────────────────────────────────────────────────────────────────
    duration    = Column(Float, nullable=True)            # seconds
    container   = Column(String, nullable=True)
    video_codec = Column(String, nullable=True)
    width       = Column(Integer, nullable=True)
    height      = Column(Integer, nullable=True)
    resolution  = Column(String, nullable=True)           # "4K" / "1080p" / "720p" / "SD"
    hdr         = Column(String, nullable=True)           # "SDR" / "HDR10" / "HDR10+" / "DV" / "DV HDR10" / "HLG"
    bitrate     = Column(Integer, nullable=True)          # overall kb/s
    audio_json  = Column(Text, nullable=True)             # [{lang, codec, channels, layout, title, default}]
    subs_json   = Column(Text, nullable=True)             # [{lang, codec, forced, default, title, external, file}]
    probe_error = Column(String, nullable=True)
    scanned_at  = Column(DateTime(timezone=True), nullable=True)

    # ── Verification ─────────────────────────────────────────────────────────
    verify_status = Column(String, nullable=True)         # None (not yet) / "ok" / "warn" / "error"
    verify_msg    = Column(String, nullable=True)
    verified_at   = Column(DateTime(timezone=True), nullable=True)
    verified_mtime = Column(Float, nullable=True)         # mtime the verification belongs to
