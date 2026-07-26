"""
Provider fallback: one banned/exhausted source must not disable the rest.

This is the exact situation after the Hiyori ban — Hiyori is first in the
default provider order, so if a block on it aborted the whole run, bulk
download would stop before ever reaching HnS/Kamui/GenSubs.
"""
import os
import tempfile
from unittest.mock import MagicMock, patch

_tmpdir = tempfile.mkdtemp(prefix="anisubarr-fallback-test-")
os.environ.setdefault("DATABASE_URL", f"sqlite:///{_tmpdir}/test.db")
os.environ.setdefault("JWT_SECRET", "test-secret-not-for-production")

import pytest  # noqa: E402

from app.database import SessionLocal, create_all  # noqa: E402
from app.models.series import Episode, Series, Subtitle  # noqa: E402
from app.services import scraper_limiter as lim  # noqa: E402

create_all()


_next_id = iter(range(7000, 8000))


@pytest.fixture
def episode_id():
    """A fresh series+episode per test — sonarr_id is unique-constrained."""
    n = next(_next_id)
    db = SessionLocal()
    try:
        s = Series(title=f"Fallback Show {n}", sonarr_id=n)
        db.add(s)
        db.flush()
        ep = Episode(series_id=s.id, sonarr_ep_id=n, season_number=1,
                     episode_number=1, has_file=True,
                     file_path=f"/data/Fallback Show {n}/S01E01.mkv")
        db.add(ep)
        db.commit()
        return ep.id
    finally:
        db.close()


def _scraper_returning(results):
    m = MagicMock()
    m.search.return_value = results
    return m


def _scraper_blocked():
    m = MagicMock()
    m.search.side_effect = lim.AuthBlocked("hiyori: přihlášení nedávno selhalo")
    return m


def test_blocked_first_provider_falls_through_to_next(episode_id):
    """Hiyori blocked → HnS still gets used and the subtitle is saved."""
    from app.routers import subtitles as subs

    hit = {"source": None}

    def _fake_save(ep, data, language, ext):
        return f"/tmp/fallback-{ep.id}.{language}.{ext}"

    def _fake_fetch(source, url, db=None):
        hit["source"] = source
        return b"1\n00:00:01,000 --> 00:00:02,000\nahoj\n"

    with patch.object(subs, "_hiyori", lambda db=None: _scraper_blocked()), \
         patch.object(subs, "_hns", lambda db=None: _scraper_returning(
             [{"source": "hns", "url": "http://hns/x.srt", "title": "x"}])), \
         patch.object(subs, "_kamui", lambda db=None: None), \
         patch.object(subs, "_gensubs", lambda db=None: None), \
         patch.object(subs, "_fetch_bytes", _fake_fetch), \
         patch.object(subs, "_save_subtitle", _fake_save), \
         patch.object(subs, "_get_provider_order",
                      lambda db=None: ["hiyori", "hns", "kamui", "gensubs"]):
        subs._download_all_task(0, [episode_id], "Fallback Show")

    assert hit["source"] == "hns", "fallback na další zdroj neproběhl"

    db = SessionLocal()
    try:
        saved = db.query(Subtitle).filter(Subtitle.episode_id == episode_id).all()
        assert len(saved) == 1 and saved[0].source == "hns"
    finally:
        db.close()


def test_all_providers_blocked_stops_the_run(episode_id):
    """When every source is unavailable there's nothing left to try — the run
    stops instead of grinding through the remaining episodes."""
    from app.routers import subtitles as subs

    with patch.object(subs, "_hiyori", lambda db=None: _scraper_blocked()), \
         patch.object(subs, "_hns", lambda db=None: _scraper_blocked()), \
         patch.object(subs, "_kamui", lambda db=None: None), \
         patch.object(subs, "_gensubs", lambda db=None: None), \
         patch.object(subs, "_get_provider_order",
                      lambda db=None: ["hiyori", "hns"]):
        subs._download_all_task(0, [episode_id], "Fallback Show")

    db = SessionLocal()
    try:
        assert db.query(Subtitle).filter(Subtitle.episode_id == episode_id).count() == 0
    finally:
        db.close()
