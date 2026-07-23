"""
backup.py – Database backup & restore.

Anisubarr's entire state (series, episodes, subtitles, settings, users,
newsletter subscribers, job history — everything except the media files
themselves, which live on the Sonarr-managed share) is one SQLite file, so
"backup" here means "a consistent snapshot of that file".

Snapshots are taken with `VACUUM INTO`, which SQLite guarantees is a
consistent, point-in-time copy even while the live database is being written
to (unlike a plain file copy, which can race a writer and produce a corrupt
snapshot) — safe to run while the app is serving requests.

Restore replaces the live DB file and then exits the process. This relies on
the container's restart policy (`restart: unless-stopped` in docker-compose.yml)
to come back up against the new file with fresh connections — SQLite files
can't safely be swapped out from under an open SQLAlchemy engine/WAL setup
while the process keeps running.
"""
from __future__ import annotations

import logging
import re
import shutil
import sqlite3
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

log = logging.getLogger("anisubarr.backup")

_FILENAME_RE = re.compile(r"^anisubarr_backup_[0-9TZ]+(?:_[a-zA-Z0-9_-]+)?\.db$")

# Tables that must exist for an uploaded file to be considered a real Anisubarr DB.
_REQUIRED_TABLES = {"series", "users", "app_settings"}


def _db_path() -> Path:
    """Resolve the live SQLite file path from settings.database_url."""
    from ..config import get_settings
    url = get_settings().database_url
    # sqlite:///relative/path.db  or  sqlite:////absolute/path.db
    if not url.startswith("sqlite:///"):
        raise RuntimeError(f"backup.py only supports SQLite; DATABASE_URL is '{url}'")
    raw_path = url[len("sqlite:///"):]
    path = Path(raw_path)
    if not path.is_absolute():
        # Relative paths in DATABASE_URL are relative to the backend/ working dir
        backend_dir = Path(__file__).parent.parent.parent
        path = (backend_dir / raw_path).resolve()
    return path


def _backup_dir() -> Path:
    d = _db_path().parent / "backups"
    d.mkdir(parents=True, exist_ok=True)
    return d


def create_backup(label: str = "") -> dict:
    """Create a consistent snapshot of the live DB. Returns its metadata."""
    db_path = _db_path()
    if not db_path.exists():
        raise RuntimeError(f"Databáze nenalezena: {db_path}")

    safe_label = re.sub(r"[^a-zA-Z0-9_-]", "", label)[:40]
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    filename = f"anisubarr_backup_{ts}" + (f"_{safe_label}" if safe_label else "") + ".db"
    dest = _backup_dir() / filename

    conn = sqlite3.connect(str(db_path))
    try:
        conn.execute("VACUUM INTO ?", [str(dest)])
    finally:
        conn.close()

    log.info("[backup] created %s (%d bytes)", filename, dest.stat().st_size)
    return _describe(dest)


def _describe(path: Path) -> dict:
    stat = path.stat()
    return {
        "filename":  path.name,
        "size":      stat.st_size,
        "created_at": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
    }


def list_backups() -> list[dict]:
    rows = [_describe(p) for p in _backup_dir().glob("anisubarr_backup_*.db")]
    rows.sort(key=lambda r: r["created_at"], reverse=True)
    return rows


def _resolve_safe(filename: str) -> Path:
    """Validate filename against the expected pattern and resolve it strictly
    inside the backups dir — rejects path traversal (../, absolute paths, etc.)."""
    if not _FILENAME_RE.match(filename):
        raise ValueError("Neplatný název souboru zálohy")
    path = (_backup_dir() / filename).resolve()
    if path.parent != _backup_dir().resolve():
        raise ValueError("Neplatná cesta k záloze")
    return path


def get_backup_path(filename: str) -> Path:
    path = _resolve_safe(filename)
    if not path.is_file():
        raise FileNotFoundError("Záloha nenalezena")
    return path


def delete_backup(filename: str) -> None:
    path = _resolve_safe(filename)
    if path.is_file():
        path.unlink()
        log.info("[backup] deleted %s", filename)


def prune_backups(keep: int) -> int:
    """Delete oldest backups beyond `keep`. Returns how many were deleted."""
    backups = list_backups()
    to_delete = backups[keep:]
    for b in to_delete:
        try:
            delete_backup(b["filename"])
        except Exception as exc:
            log.warning("[backup] prune failed for %s: %s", b["filename"], exc)
    return len(to_delete)


def validate_backup_file(path: Path) -> None:
    """Raise ValueError if `path` doesn't look like a real Anisubarr SQLite DB."""
    try:
        conn = sqlite3.connect(str(path))
        try:
            rows = conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
        finally:
            conn.close()
    except sqlite3.DatabaseError as exc:
        raise ValueError(f"Soubor není platná SQLite databáze: {exc}")

    table_names = {r[0] for r in rows}
    missing = _REQUIRED_TABLES - table_names
    if missing:
        raise ValueError(f"Soubor nevypadá jako záloha Anisubarru (chybí tabulky: {', '.join(missing)})")


def restore_from_path(source: Path, *, restart_delay_sec: float = 1.5) -> dict:
    """
    Validate `source`, safety-copy the current live DB, then replace it and
    schedule a process exit so the container restarts against the new file.

    Returns metadata about the safety copy so the caller can tell the admin
    where their pre-restore state was preserved, in case of a mistake.
    """
    validate_backup_file(source)

    db_path = _db_path()
    safety = create_backup(label="pre_restore")

    shutil.copyfile(source, db_path)
    log.warning("[backup] RESTORE applied from %s — safety copy: %s. Restarting in %.1fs.",
                source, safety["filename"], restart_delay_sec)

    def _delayed_exit():
        time.sleep(restart_delay_sec)
        import os
        os._exit(0)  # let the container's restart policy bring the app back up cleanly

    threading.Thread(target=_delayed_exit, daemon=True).start()
    return {"safety_backup": safety["filename"]}
