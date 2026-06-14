from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text, Float, BigInteger, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from ..database import Base


class Series(Base):
    __tablename__ = "series"

    id              = Column(Integer, primary_key=True, index=True)

    # ── Sonarr identifiers ────────────────────────────────────────────
    sonarr_id       = Column(Integer, unique=True, index=True, nullable=False)
    tvdb_id         = Column(Integer, nullable=True, index=True)
    tvmaze_id       = Column(Integer, nullable=True)
    tvrage_id       = Column(Integer, nullable=True)
    imdb_id         = Column(String,  nullable=True)

    # ── AniList identifiers ───────────────────────────────────────────
    anilist_id      = Column(Integer, nullable=True, index=True)

    # ── TMDb identifiers ──────────────────────────────────────────────
    tmdb_id         = Column(Integer, nullable=True, index=True)

    # ── Core metadata ─────────────────────────────────────────────────
    title           = Column(String, nullable=False)
    sort_title      = Column(String, nullable=True)
    title_slug      = Column(String, nullable=True)
    alternate_titles= Column(Text, nullable=True)   # JSON list

    # Titles from AniList
    title_japanese  = Column(String, nullable=True)
    title_romaji    = Column(String, nullable=True)
    title_english   = Column(String, nullable=True)

    year            = Column(Integer, nullable=True)
    first_aired     = Column(String, nullable=True)   # ISO date string

    # ── Description ───────────────────────────────────────────────────
    overview        = Column(Text, nullable=True)     # Sonarr / TVDB English
    overview_cs     = Column(Text, nullable=True)     # Ollama-translated Czech
    overview_anilist= Column(Text, nullable=True)     # AniList description (may differ)

    # ── Broadcast info ────────────────────────────────────────────────
    network         = Column(String, nullable=True)   # e.g. "Fuji TV"
    air_time        = Column(String, nullable=True)   # e.g. "23:30"
    runtime         = Column(Integer, nullable=True)  # minutes per episode
    series_type     = Column(String, nullable=True)   # standard / daily / anime
    certification   = Column(String, nullable=True)   # e.g. "TV-14"

    # ── Images ────────────────────────────────────────────────────────
    poster_url      = Column(String, nullable=True)   # Sonarr proxy URL / TMDb poster
    backdrop_url    = Column(String, nullable=True)   # TMDb backdrop
    fanart_url      = Column(String, nullable=True)
    banner_url      = Column(String, nullable=True)
    cover_url       = Column(String, nullable=True)   # AniList cover (hi-res)

    # ── Status & stats ────────────────────────────────────────────────
    status          = Column(String, nullable=True)   # continuing / ended
    monitored       = Column(Boolean, default=True)
    path            = Column(String, nullable=True)   # Sonarr root path
    quality_profile = Column(String, nullable=True)
    season_count    = Column(Integer, nullable=True)
    episode_count   = Column(Integer, nullable=True)   # monitored
    episode_file_count = Column(Integer, nullable=True)
    total_episode_count= Column(Integer, nullable=True)
    size_on_disk    = Column(BigInteger, nullable=True)  # bytes
    percent_complete= Column(Float, nullable=True)

    # ── Ratings ───────────────────────────────────────────────────────
    rating_value    = Column(Float, nullable=True)   # 0.0–10.0 from TVDB
    rating_votes    = Column(Integer, nullable=True)
    average_score   = Column(Float, nullable=True)   # AniList 0.0–10.0

    # ── Genres / tags ─────────────────────────────────────────────────
    genres          = Column(Text, nullable=True)     # JSON list (Sonarr + AniList merged)
    tags            = Column(Text, nullable=True)     # JSON list (AniList tags)
    sonarr_tags     = Column(Text, nullable=True)     # JSON list of Sonarr tag labels

    # ── Watch tracking ────────────────────────────────────────────────
    # plan_to_watch / watching / completed / on_hold / dropped
    watch_status    = Column(String, nullable=True)

    # ── Cached episode/subtitle counts (updated during sync) ──────────
    # Avoids loading all episodes + disk scanning on every list_series call
    cached_ep_monitored  = Column(Integer, default=0, nullable=False)
    cached_ep_with_file  = Column(Integer, default=0, nullable=False)
    cached_cs_sub_count  = Column(Integer, default=0, nullable=False)

    # ── Dates ─────────────────────────────────────────────────────────
    sonarr_added    = Column(String, nullable=True)   # ISO datetime when added to Sonarr

    # ── Emby integration ─────────────────────────────────────────────
    emby_id         = Column(String, nullable=True)   # Emby item ID for deep links

    # ── Promotion / issue tracking ────────────────────────────────────
    promoted        = Column(Boolean, default=False, nullable=False)
    has_issue       = Column(Boolean, default=False, nullable=False)
    promoted_at     = Column(DateTime(timezone=True), nullable=True)  # set when promoted=True

    # ── Subtitle audit / state machine ─────────────────────────────────
    # CLEAN / PENDING / ABANDONED / DAMAGED / PARTIAL / PENDING_TRANSLATION
    audit_status        = Column(String, nullable=True)
    audit_status_reason = Column(Text, nullable=True)
    audit_status_since  = Column(DateTime(timezone=True), nullable=True)
    last_hiyori_check_at = Column(DateTime(timezone=True), nullable=True)

    # ── Sync timestamps ───────────────────────────────────────────────
    synced_at       = Column(DateTime(timezone=True), nullable=True)
    created_at      = Column(DateTime(timezone=True), server_default=func.now())
    updated_at      = Column(DateTime(timezone=True), onupdate=func.now())

    episodes = relationship("Episode", back_populates="series", cascade="all, delete-orphan")


class Episode(Base):
    __tablename__ = "episodes"

    id              = Column(Integer, primary_key=True, index=True)
    series_id       = Column(Integer, ForeignKey("series.id"), nullable=False)

    # ── Sonarr identifiers ────────────────────────────────────────────
    sonarr_ep_id    = Column(Integer, unique=True, index=True, nullable=False)
    sonarr_file_id  = Column(Integer, nullable=True)
    tvdb_ep_id      = Column(Integer, nullable=True)

    # ── Episode numbering ─────────────────────────────────────────────
    season_number       = Column(Integer, nullable=False)
    episode_number      = Column(Integer, nullable=False)
    absolute_episode_number = Column(Integer, nullable=True)  # important for anime
    scene_episode_number    = Column(Integer, nullable=True)
    scene_season_number     = Column(Integer, nullable=True)

    # ── Metadata ──────────────────────────────────────────────────────
    title           = Column(String, nullable=True)
    title_cs        = Column(String, nullable=True)   # translated
    overview        = Column(Text, nullable=True)
    overview_cs     = Column(Text, nullable=True)     # AI-translated Czech
    air_date        = Column(String, nullable=True)
    air_date_utc    = Column(String, nullable=True)
    runtime         = Column(Integer, nullable=True)  # minutes (from episodeFile mediaInfo)

    # ── File info ─────────────────────────────────────────────────────
    has_file        = Column(Boolean, default=False)
    monitored       = Column(Boolean, default=True)
    file_path       = Column(String, nullable=True)   # full path from Sonarr
    relative_path   = Column(String, nullable=True)
    file_size       = Column(BigInteger, nullable=True)  # bytes
    date_added      = Column(String, nullable=True)
    release_group   = Column(String, nullable=True)
    scene_name      = Column(String, nullable=True)

    # ── Quality ───────────────────────────────────────────────────────
    quality_name    = Column(String, nullable=True)   # e.g. "Bluray-1080p"
    quality_source  = Column(String, nullable=True)   # web / bluray / hdtv …
    quality_resolution = Column(Integer, nullable=True)  # 1080 / 720 / 2160

    # ── Media info (from Sonarr episodeFile.mediaInfo) ────────────────
    resolution      = Column(String, nullable=True)   # "1920x1080"
    video_codec     = Column(String, nullable=True)   # "x264" / "x265" / "AV1"
    video_bitrate   = Column(Integer, nullable=True)  # kbps
    video_fps       = Column(Float, nullable=True)
    video_dynamic_range = Column(String, nullable=True)  # "HDR" / "DV" / ""
    audio_codec     = Column(String, nullable=True)   # "AAC" / "EAC3" / "FLAC"
    audio_channels  = Column(Float, nullable=True)    # 2.0 / 5.1 / 7.1
    audio_bitrate   = Column(Integer, nullable=True)  # kbps
    audio_languages = Column(String, nullable=True)   # "jpn" / "jpn / eng"
    subtitles_in_file = Column(String, nullable=True) # comma-sep language codes
    run_time        = Column(String, nullable=True)   # "00:23:40" from mediaInfo

    # ── Watch tracking ────────────────────────────────────────────────
    watched         = Column(Boolean, default=False)

    # ── Sync ──────────────────────────────────────────────────────────
    created_at      = Column(DateTime(timezone=True), server_default=func.now())
    updated_at      = Column(DateTime(timezone=True), onupdate=func.now())

    series    = relationship("Series", back_populates="episodes")
    subtitles = relationship("Subtitle", back_populates="episode", cascade="all, delete-orphan")


class Subtitle(Base):
    __tablename__ = "subtitles"

    id              = Column(Integer, primary_key=True, index=True)
    episode_id      = Column(Integer, ForeignKey("episodes.id"), nullable=False)
    language        = Column(String, nullable=False)
    source          = Column(String, nullable=True)    # "hiyori" / "hns" / "embedded" / "manual"
    file_path       = Column(String, nullable=True)
    track_index     = Column(Integer, nullable=True)
    is_embedded     = Column(Boolean, default=False)
    is_hearing_imp  = Column(Boolean, default=False)
    format          = Column(String, nullable=True)    # "srt" / "ass" / "sup"
    detected_lang   = Column(String, nullable=True)    # skutecny detekovany jazyk ("cs"/"sk"/None)
    downloaded_at   = Column(DateTime(timezone=True), default=None, nullable=True)

    episode = relationship("Episode", back_populates="subtitles")
