from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from .config import get_settings

settings = get_settings()

engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False},  # SQLite only
)

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
    from .models import user, series, schedule, job_run, api_key, app_settings, request, glossary  # noqa: F401 – register models
    Base.metadata.create_all(bind=engine)
    _migrate_add_columns()


def _migrate_add_columns():
    """Safe ALTER TABLE for columns added after initial schema."""
    from sqlalchemy import text
    migrations = [
        "ALTER TABLE series   ADD COLUMN watch_status          VARCHAR",
        "ALTER TABLE series   ADD COLUMN sonarr_added          VARCHAR",
        "ALTER TABLE episodes ADD COLUMN watched               BOOLEAN DEFAULT 0",
        # Cached counters — avoid full episode/subtitle scan on every list request
        "ALTER TABLE series   ADD COLUMN cached_ep_monitored  INTEGER DEFAULT 0",
        "ALTER TABLE series   ADD COLUMN cached_ep_with_file  INTEGER DEFAULT 0",
        "ALTER TABLE series   ADD COLUMN cached_cs_sub_count  INTEGER DEFAULT 0",
        "ALTER TABLE series   ADD COLUMN title_english        VARCHAR",
        "ALTER TABLE series   ADD COLUMN promoted             BOOLEAN DEFAULT 0",
        "ALTER TABLE series   ADD COLUMN has_issue            BOOLEAN DEFAULT 0",
        # Lang detection
        "ALTER TABLE subtitles ADD COLUMN detected_lang       VARCHAR",
    ]
    with engine.connect() as conn:
        for sql in migrations:
            try:
                conn.execute(text(sql))
                conn.commit()
            except Exception:
                pass  # column already exists — ignore
