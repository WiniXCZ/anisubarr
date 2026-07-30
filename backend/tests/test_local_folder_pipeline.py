"""
End-to-end: a file dropped in the ruční složka gets used, and it gets used first.

The unit tests cover the matching rules; this one covers the wiring — that the
bulk download path really reads the bytes off the disk and records the subtitle
as coming from the folder, without any provider on the net being touched.
"""
import os
import tempfile
from unittest.mock import MagicMock, patch

_tmpdir = tempfile.mkdtemp(prefix="anisubarr-localpipe-test-")
os.environ.setdefault("DATABASE_URL", f"sqlite:///{_tmpdir}/test.db")
os.environ.setdefault("JWT_SECRET", "test-secret-not-for-production")

import pytest  # noqa: E402

from app.database import SessionLocal, create_all  # noqa: E402
from app.models.series import Episode, Series, Subtitle  # noqa: E402
from app.services import local_subs  # noqa: E402

create_all()

_SRT = b"1\n00:00:01,000 --> 00:00:02,000\nz rucni slozky\n"
_next_id = iter(range(9000, 9100))


@pytest.fixture
def episode():
    """A series + episode named so the folder matcher can recognise it."""
    n = next(_next_id)
    db = SessionLocal()
    try:
        series = Series(title=f"Local Show {n}", sonarr_id=n)
        db.add(series)
        db.flush()
        ep = Episode(series_id=series.id, sonarr_ep_id=n, season_number=1,
                     episode_number=1, has_file=True,
                     file_path=f"/data/Local Show {n}/S01E01.mkv")
        db.add(ep)
        db.commit()
        yield ep.id, series.title
    finally:
        db.close()


@pytest.fixture
def drop_folder():
    root = tempfile.mkdtemp(prefix="anisubarr-drop-")
    local_subs.invalidate_cache()
    yield root
    local_subs.invalidate_cache()


def _saved_subtitles(episode_id: int) -> list[Subtitle]:
    db = SessionLocal()
    try:
        return db.query(Subtitle).filter(Subtitle.episode_id == episode_id).all()
    finally:
        db.close()


def test_a_dropped_file_is_used_and_recorded_as_local(episode, drop_folder):
    from app.routers import subtitles as subs
    episode_id, title = episode

    with open(os.path.join(drop_folder, f"{title} S01E01.cs.srt"), "wb") as fh:
        fh.write(_SRT)

    written: dict = {}

    def _fake_save(ep, data, language, ext):
        written["data"], written["ext"] = data, ext
        return f"/tmp/local-{ep.id}.{language}.{ext}"

    with patch.object(local_subs, "folder_path", lambda db=None: drop_folder), \
         patch.object(subs, "_save_subtitle", _fake_save), \
         patch.object(subs, "_get_provider_order", lambda db=None: ["local"]):
        subs._download_all_task(0, [episode_id], title)

    assert written.get("data") == _SRT, "obsah nepřišel ze souboru na disku"
    assert written.get("ext") == "srt"

    saved = _saved_subtitles(episode_id)
    assert len(saved) == 1
    assert saved[0].source == "local"


def test_the_folder_is_searched_before_the_net(episode, drop_folder):
    """The whole point: with a usable local file, no site is contacted."""
    from app.routers import subtitles as subs
    episode_id, title = episode

    with open(os.path.join(drop_folder, f"{title} - 01.srt"), "wb") as fh:
        fh.write(_SRT)

    hiyori = MagicMock()
    hiyori.search.return_value = [{"source": "hiyori", "url": "http://x/1.srt", "title": "x"}]

    with patch.object(local_subs, "folder_path", lambda db=None: drop_folder), \
         patch.object(subs, "_hiyori", lambda db=None: hiyori), \
         patch.object(subs, "_save_subtitle",
                      lambda ep, data, language, ext: f"/tmp/local-{ep.id}.{ext}"), \
         patch.object(subs, "_get_provider_order", lambda db=None: ["local", "hiyori"]):
        subs._download_all_task(0, [episode_id], title)

    hiyori.search.assert_not_called()
    assert [s.source for s in _saved_subtitles(episode_id)] == ["local"]


def test_the_net_still_runs_when_the_folder_has_nothing(episode, drop_folder):
    """An empty folder must not shadow the providers behind it."""
    from app.routers import subtitles as subs
    episode_id, title = episode

    with patch.object(local_subs, "folder_path", lambda db=None: drop_folder), \
         patch.object(subs, "_hiyori", lambda db=None: _returning_scraper()), \
         patch.object(subs, "_fetch_bytes", lambda source, url, db=None: _SRT), \
         patch.object(subs, "_save_subtitle",
                      lambda ep, data, language, ext: f"/tmp/net-{ep.id}.{ext}"), \
         patch.object(subs, "_get_provider_order", lambda db=None: ["local", "hiyori"]):
        subs._download_all_task(0, [episode_id], title)

    assert [s.source for s in _saved_subtitles(episode_id)] == ["hiyori"]


def _returning_scraper():
    m = MagicMock()
    m.search.return_value = [{"source": "hiyori", "url": "http://x/1.srt", "title": "x"}]
    return m
