from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from .config import get_settings

settings = get_settings()

engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False},
)


if settings.database_url.startswith("sqlite"):
    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_conn, _connection_record):
        """Enable WAL + a busy timeout on every SQLite connection.

        WAL lets readers and a writer proceed concurrently (the app runs a
        background scheduler, fire-and-forget threads, and — since the public
        site — a second uvicorn process over the same file). busy_timeout makes
        a connection wait for a lock instead of instantly raising
        'database is locked'. Set per-connection because these PRAGMAs don't
        persist across connections (journal_mode does persist in the file, but
        re-asserting it is harmless)."""
        cur = dbapi_conn.cursor()
        try:
            cur.execute("PRAGMA journal_mode=WAL")
            cur.execute("PRAGMA busy_timeout=10000")
            cur.execute("PRAGMA synchronous=NORMAL")
        finally:
            cur.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def create_all():
    """Create all tables. Called on startup."""
    from .models import user, series, schedule, job_run, api_key, app_settings, request, glossary, episode_markers, seerr_cache, watchlist, audit_log, library, movie, newsletter  # noqa: F401
    Base.metadata.create_all(bind=engine)
    _migrate_add_columns()


def _migrate_add_columns():
    """Safe ALTER TABLE for columns added after initial schema."""
    from sqlalchemy import text
    migrations = [
        "ALTER TABLE series   ADD COLUMN watch_status          VARCHAR",
        "ALTER TABLE series   ADD COLUMN sonarr_added          VARCHAR",
        "ALTER TABLE episodes ADD COLUMN watched               BOOLEAN DEFAULT 0",
        "ALTER TABLE series   ADD COLUMN cached_ep_monitored  INTEGER DEFAULT 0",
        "ALTER TABLE series   ADD COLUMN cached_ep_with_file  INTEGER DEFAULT 0",
        "ALTER TABLE series   ADD COLUMN cached_cs_sub_count  INTEGER DEFAULT 0",
        "ALTER TABLE series   ADD COLUMN title_english        VARCHAR",
        "ALTER TABLE series   ADD COLUMN promoted             BOOLEAN DEFAULT 0",
        "ALTER TABLE series   ADD COLUMN has_issue            BOOLEAN DEFAULT 0",
        "ALTER TABLE subtitles ADD COLUMN detected_lang       VARCHAR",
        "CREATE INDEX IF NOT EXISTS idx_episodes_series_id     ON episodes (series_id)",
        "CREATE INDEX IF NOT EXISTS idx_episodes_season        ON episodes (series_id, season_number)",
        "CREATE INDEX IF NOT EXISTS idx_subtitles_episode_id   ON subtitles (episode_id)",
        "CREATE INDEX IF NOT EXISTS idx_subtitles_language     ON subtitles (episode_id, language)",
        "ALTER TABLE users ADD COLUMN role        VARCHAR DEFAULT 'viewer'",
        "ALTER TABLE users ADD COLUMN permissions VARCHAR",
        "UPDATE users SET role = 'admin' WHERE is_admin = 1 AND (role IS NULL OR role = 'viewer')",
        "ALTER TABLE series ADD COLUMN emby_id VARCHAR",
        "ALTER TABLE episodes ADD COLUMN overview_cs TEXT",
        "ALTER TABLE series ADD COLUMN tmdb_id INTEGER",
        "ALTER TABLE series ADD COLUMN backdrop_url VARCHAR",
        "ALTER TABLE series ADD COLUMN audit_status VARCHAR",
        "ALTER TABLE series ADD COLUMN audit_status_reason TEXT",
        "ALTER TABLE series ADD COLUMN audit_status_since DATETIME",
        "ALTER TABLE series ADD COLUMN last_hiyori_check_at DATETIME",
        "CREATE INDEX IF NOT EXISTS idx_audit_log_series_id ON series_audit_log (series_id)",
        "CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON series_audit_log (series_id, created_at)",
        "ALTER TABLE series ADD COLUMN library_id INTEGER REFERENCES libraries(id)",
        "CREATE INDEX IF NOT EXISTS idx_series_library_id ON series (library_id)",
        "CREATE INDEX IF NOT EXISTS idx_movies_library_id ON movies (library_id)",
    ]
    with engine.connect() as conn:
        for sql in migrations:
            try:
                conn.execute(text(sql))
                conn.commit()
            except Exception:
                pass
