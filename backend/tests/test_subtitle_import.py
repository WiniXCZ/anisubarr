"""
Recording the subtitles that were already on the disk.

The table held 564 rows while the library held 13 533 Czech subtitle files.
Coverage looked catastrophic in the database and was in fact 86 % — and every
decision built on the table (promotion, the dashboard, what to download next)
was reading the 4 %.
"""
import os
import tempfile
from unittest.mock import patch

_tmpdir = tempfile.mkdtemp(prefix="anisubarr-import-test-")
os.environ.setdefault("DATABASE_URL", f"sqlite:///{_tmpdir}/test.db")
os.environ.setdefault("JWT_SECRET", "test-secret-not-for-production")

import pytest  # noqa: E402

from app.database import SessionLocal, create_all  # noqa: E402
from app.models.series import Episode, Series, Subtitle  # noqa: E402
from app.services import path_resolver  # noqa: E402
from app.services.subtitle_import import import_from_disk  # noqa: E402

create_all()

_ID_BASE = 950_000
_next_id = iter(range(_ID_BASE, _ID_BASE + 500))
_VIDEO = "Show - S01E01.mkv"


@pytest.fixture
def library():
    """A season folder with one episode whose video is really there."""
    root = tempfile.mkdtemp(prefix="anisubarr-implib-")
    season = os.path.join(root, "Season 01")
    os.makedirs(season)
    open(os.path.join(season, _VIDEO), "w").close()

    db = SessionLocal()
    n = next(_next_id)
    series = Series(title=f"Import Show {n}", sonarr_id=n)
    db.add(series)
    db.flush()
    ep = Episode(series_id=series.id, sonarr_ep_id=n, season_number=1,
                 episode_number=1, has_file=True,
                 file_path=f"/data/anime/Season 01/{_VIDEO}")
    db.add(ep)
    db.commit()

    rules = f'[{{"from": "/data/anime", "to": "{root}"}}]'
    try:
        with patch.object(path_resolver, "_cfg_value",
                          lambda key, default="": {"path_mappings": rules}.get(key, "")):
            yield db, series, ep, season
    finally:
        db.query(Subtitle).filter(Subtitle.episode_id == ep.id).delete()
        db.query(Episode).filter(Episode.id == ep.id).delete()
        db.query(Series).filter(Series.id == series.id).delete()
        db.commit()
        db.close()


def _drop(season, name):
    with open(os.path.join(season, name), "w", encoding="utf-8") as fh:
        fh.write("titulek")


def _rows(db, ep):
    return db.query(Subtitle).filter(Subtitle.episode_id == ep.id).all()


def test_a_subtitle_on_disk_gets_a_row(library):
    db, series, ep, season = library
    _drop(season, "Show - S01E01.cs.srt")

    report = import_from_disk(db, series_ids=[series.id])

    assert report["added"] == 1
    row = _rows(db, ep)[0]
    assert row.language == "cs" and row.format == "srt" and row.source == "disk"


def test_the_row_keeps_the_episode_s_namespace(library):
    """An absolute local path would bake today's volume mapping into the
    database and break on the next remount."""
    db, series, ep, season = library
    _drop(season, "Show - S01E01.cs.srt")

    import_from_disk(db, series_ids=[series.id])

    assert _rows(db, ep)[0].file_path == "/data/anime/Season 01/Show - S01E01.cs.srt"


def test_running_it_twice_adds_nothing_the_second_time(library):
    db, series, ep, season = library
    _drop(season, "Show - S01E01.cs.srt")

    import_from_disk(db, series_ids=[series.id])
    second = import_from_disk(db, series_ids=[series.id])

    assert second["added"] == 0 and second["already_known"] == 1
    assert len(_rows(db, ep)) == 1


def test_every_tagged_language_is_recorded(library):
    db, series, ep, season = library
    for name in ("Show - S01E01.cs.srt", "Show - S01E01.sk.srt", "Show - S01E01.en.ass"):
        _drop(season, name)

    report = import_from_disk(db, series_ids=[series.id])

    assert report["added"] == 3
    assert {r.language for r in _rows(db, ep)} == {"cs", "sk", "en"}


def test_an_untagged_sidecar_is_counted_not_guessed(library):
    """Probably Czech is not good enough to write into the row that decides
    whether this episode still needs a download."""
    db, series, ep, season = library
    _drop(season, "Show - S01E01.srt")

    report = import_from_disk(db, series_ids=[series.id])

    assert report["added"] == 0 and report["untagged"] == 1
    assert _rows(db, ep) == []


def test_the_language_filter_narrows_what_is_recorded(library):
    db, series, ep, season = library
    _drop(season, "Show - S01E01.cs.srt")
    _drop(season, "Show - S01E01.en.srt")

    report = import_from_disk(db, series_ids=[series.id], languages={"cs"})

    assert report["added"] == 1
    assert [r.language for r in _rows(db, ep)] == ["cs"]


def test_a_file_the_table_already_knows_is_left_alone(library):
    """Matching is by file name, so a row written by a scraper is not
    duplicated by the sweep that finds the same file."""
    db, series, ep, season = library
    _drop(season, "Show - S01E01.cs.srt")
    db.add(Subtitle(episode_id=ep.id, language="cs", source="hns",
                    file_path="/data/anime/Season 01/Show - S01E01.cs.srt",
                    format="srt"))
    db.commit()

    report = import_from_disk(db, series_ids=[series.id])

    assert report["added"] == 0 and report["already_known"] == 1
    assert len(_rows(db, ep)) == 1


def test_an_unreadable_folder_adds_nothing(library):
    db, series, ep, season = library
    ep.file_path = "/data/anime/Season 99/Show - S99E01.mkv"
    db.commit()

    report = import_from_disk(db, series_ids=[series.id])

    assert report["added"] == 0 and report["unreachable"] == 1


def test_the_series_count_catches_up(library):
    """The grid and the promotion rules read the cached count, not the rows."""
    db, series, ep, season = library
    _drop(season, "Show - S01E01.cs.srt")

    import_from_disk(db, series_ids=[series.id])

    db.refresh(series)
    assert series.cached_cs_sub_count == 1
