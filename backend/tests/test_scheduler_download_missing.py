"""
The nightly sweep must use the same sources as everything else.

It used to carry its own hardcoded hiyori+hns list read straight from the legacy
settings. Two consequences, both seen in production: the ruční složka was never
searched, and a provider switched off in the UI kept being hammered anyway.

It also built a fresh scraper per episode, so a 10 000-episode run meant 10 000
logins — the exact pattern that got the Hiyori account banned.
"""
import os
import tempfile
from unittest.mock import MagicMock, patch

_tmpdir = tempfile.mkdtemp(prefix="anisubarr-sched-test-")
os.environ.setdefault("DATABASE_URL", f"sqlite:///{_tmpdir}/test.db")
os.environ.setdefault("JWT_SECRET", "test-secret-not-for-production")

import pytest  # noqa: E402

from app.database import SessionLocal, create_all  # noqa: E402
from app.models.series import Episode, Series, Subtitle  # noqa: E402
from app.models.service import Service  # noqa: E402
from app.services import local_subs, scheduler  # noqa: E402

create_all()

_SRT = b"1\n00:00:01,000 --> 00:00:02,000\nz rucni slozky\n"
_next_id = iter(range(6000, 6100))


@pytest.fixture
def library():
    """Two episodes with files and no subtitles — what the sweep looks for."""
    n = next(_next_id)
    db = SessionLocal()
    series = Series(title=f"Sweep Show {n}", sonarr_id=n)
    db.add(series)
    db.flush()
    for offset in (0, 1):
        db.add(Episode(series_id=series.id, sonarr_ep_id=n + 500 + offset,
                       season_number=1, episode_number=1 + offset,
                       has_file=True, monitored=True,
                       file_path=f"/data/Sweep Show {n}/S01E0{1 + offset}.mkv"))
    db.commit()
    try:
        yield series.id, series.title
    finally:
        db.query(Subtitle).filter(
            Subtitle.episode_id.in_(
                db.query(Episode.id).filter(Episode.series_id == series.id))
        ).delete(synchronize_session=False)
        db.query(Episode).filter(Episode.series_id == series.id).delete()
        db.query(Series).filter(Series.id == series.id).delete()
        db.query(Service).delete()
        db.commit()
        db.close()


@pytest.fixture
def drop_folder():
    root = tempfile.mkdtemp(prefix="anisubarr-drop-")
    local_subs.invalidate_cache()
    yield root
    local_subs.invalidate_cache()


def _web_scraper(results=()):
    m = MagicMock()
    m.search.return_value = list(results)
    return m


def _saved(series_id):
    db = SessionLocal()
    try:
        return (
            db.query(Subtitle)
            .join(Episode, Subtitle.episode_id == Episode.id)
            .filter(Episode.series_id == series_id)
            .all()
        )
    finally:
        db.close()


def test_the_nightly_sweep_searches_the_manual_folder(library, drop_folder):
    series_id, title = library
    for episode in (1, 2):
        with open(os.path.join(drop_folder, f"{title} - 0{episode}.cs.srt"), "wb") as fh:
            fh.write(_SRT)

    # The job imports these inside its body, so the source module is what has
    # to be patched.
    with patch.object(local_subs, "folder_path", lambda db=None: drop_folder), \
         patch("app.routers.subtitles._save_subtitle",
               lambda ep, data, language, ext: f"/tmp/sweep-{ep.id}.{language}.{ext}"):
        scheduler.job_download_missing()

    assert sorted(s.source for s in _saved(series_id)) == ["local", "local"]


def test_one_scraper_per_run_not_per_episode(library, drop_folder):
    """A fresh instance logs in again; per-episode instances are how an account
    gets banned."""
    series_id, _ = library
    db = SessionLocal()
    db.add(Service(name="HnS", type="hns", username="u", password="p",
                   enabled=True, sort_order=1))
    db.commit()
    db.close()

    built = {"n": 0}

    def factory(db=None):
        built["n"] += 1
        return _web_scraper()

    from app.routers import subtitles as subs
    with patch.object(local_subs, "folder_path", lambda db=None: drop_folder), \
         patch.dict(subs._PROVIDER_FACTORIES, {"hns": factory}):
        scheduler.job_download_missing()

    assert built["n"] == 1, "scraper se staví znovu pro každou epizodu"


def test_a_disabled_provider_is_not_used_by_the_sweep(library, drop_folder):
    """Switching a banned source off has to stop the nightly job too."""
    series_id, _ = library
    db = SessionLocal()
    db.add(Service(name="HnS", type="hns", username="u", password="p",
                   enabled=False, sort_order=1))
    db.commit()
    db.close()

    from app.routers import subtitles as subs
    used = {"n": 0}

    def factory(db=None):
        used["n"] += 1
        return _web_scraper()

    with patch.object(local_subs, "folder_path", lambda db=None: drop_folder), \
         patch.dict(subs._PROVIDER_FACTORIES, {"hns": factory}):
        scheduler.job_download_missing()

    assert used["n"] == 0


def test_the_download_reuses_the_scraper_that_found_it(library, drop_folder):
    """A second instance doesn't hold the session the link was issued for —
    that's why HnS downloads came back as the login page."""
    series_id, _ = library
    db = SessionLocal()
    db.add(Service(name="HnS", type="hns", username="u", password="p",
                   enabled=True, sort_order=1))
    db.commit()
    db.close()

    scraper = _web_scraper([{"source": "hns", "url": "http://hns/x.srt", "title": "x"}])
    scraper.download.return_value = _SRT

    from app.routers import subtitles as subs
    with patch.object(local_subs, "folder_path", lambda db=None: drop_folder), \
         patch.dict(subs._PROVIDER_FACTORIES, {"hns": lambda db=None: scraper}), \
         patch("app.routers.subtitles._save_subtitle",
               lambda ep, data, language, ext: f"/tmp/sweep-{ep.id}.{language}.{ext}"), \
         patch("app.routers.subtitles._fetch_bytes") as fetch:
        scheduler.job_download_missing()

    assert scraper.download.called, "stahovalo se přes nový scraper místo toho, co hledal"
    assert not fetch.called


def test_the_heavy_sweep_does_not_re_fire_after_a_restart():
    """misfire_grace_time is an hour for light jobs; for the library-wide sweep
    that means a container update re-triggers thousands of requests."""
    assert scheduler._grace("download_missing") <= 300
    assert scheduler._grace("sonarr_sync") == scheduler._DEFAULT_GRACE
