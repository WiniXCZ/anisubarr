"""
Bringing the subtitles table back in line with the disk.

Resolving a path fixes a row whose prefix is stale. It cannot fix one whose
file was converted to another format — the row points at a name nothing will
create again — and it cannot fix a row whose file is simply gone, which is the
worse case: that row tells Anisubarr the episode is covered, so no replacement
is ever downloaded.

The danger is telling those two apart from a share that isn't mounted, where
every subtitle in the library looks deleted at once.
"""
import os
import tempfile
from unittest.mock import patch

_tmpdir = tempfile.mkdtemp(prefix="anisubarr-reconcile-test-")
os.environ.setdefault("DATABASE_URL", f"sqlite:///{_tmpdir}/test.db")
os.environ.setdefault("JWT_SECRET", "test-secret-not-for-production")

import pytest  # noqa: E402

from app.database import SessionLocal, create_all  # noqa: E402
from app.models.series import Episode, Series, Subtitle  # noqa: E402
from app.services import path_resolver  # noqa: E402
from app.services.subtitle_reconcile import reconcile  # noqa: E402

create_all()

_ID_BASE = 970_000
_next_id = iter(range(_ID_BASE, _ID_BASE + 500))


@pytest.fixture
def library():
    """A season folder, an episode, and a session that cleans up after itself."""
    root = tempfile.mkdtemp(prefix="anisubarr-lib-")
    season = os.path.join(root, "Season 01")
    os.makedirs(season)

    db = SessionLocal()
    n = next(_next_id)
    series = Series(title=f"Reconcile Show {n}", sonarr_id=n)
    db.add(series)
    db.flush()
    ep = Episode(series_id=series.id, sonarr_ep_id=n, season_number=1,
                 episode_number=1, has_file=True)
    db.add(ep)
    db.commit()

    # Rows hold Sonarr's namespace; the mapping is what makes them reachable.
    rules = f'[{{"from": "/data/anime", "to": "{root}"}}]'
    try:
        with patch.object(path_resolver, "_cfg_value",
                          lambda key, default="": {"path_mappings": rules}.get(key, "")):
            yield db, ep, season
    finally:
        db.query(Subtitle).filter(Subtitle.episode_id == ep.id).delete()
        db.query(Episode).filter(Episode.id == ep.id).delete()
        db.query(Series).filter(Series.id == series.id).delete()
        db.commit()
        db.close()


def _row(db, ep, name, fmt="srt"):
    sub = Subtitle(episode_id=ep.id, language="cs", source="hns",
                   file_path=f"/data/anime/Season 01/{name}", format=fmt)
    db.add(sub)
    db.commit()
    return sub


def _drop(season, name):
    with open(os.path.join(season, name), "w", encoding="utf-8") as fh:
        fh.write("titulek")


def test_a_row_whose_file_is_there_is_left_alone(library):
    db, ep, season = library
    sub = _row(db, ep, "Show - S01E01.cs.srt")
    _drop(season, "Show - S01E01.cs.srt")

    report = reconcile(db, episode_ids=[ep.id])

    assert report["ok"] == 1 and report["repaired"] == 0
    assert sub.file_path == "/data/anime/Season 01/Show - S01E01.cs.srt"


def test_a_converted_subtitle_is_found_under_its_new_extension(library):
    """.ass converted to .srt leaves the row pointing at a name nothing will
    ever create again."""
    db, ep, season = library
    sub = _row(db, ep, "Show - S01E01.cs.ass", fmt="ass")
    _drop(season, "Show - S01E01.cs.srt")

    report = reconcile(db, episode_ids=[ep.id])

    assert report["repaired"] == 1
    assert sub.file_path.endswith("Show - S01E01.cs.srt")
    assert sub.format == "srt"


def test_a_repaired_row_keeps_the_prefix_it_came_with(library):
    """Rewriting /data/… into the container's own mount would bake today's
    volume mapping into the database and break on the next remount."""
    db, ep, season = library
    sub = _row(db, ep, "Show - S01E01.cs.ass", fmt="ass")
    _drop(season, "Show - S01E01.cs.srt")

    reconcile(db, episode_ids=[ep.id])

    assert sub.file_path.startswith("/data/anime/"), sub.file_path


def test_a_row_whose_file_is_gone_is_deleted(library):
    """It is not merely wrong — it tells Anisubarr the episode is covered, so
    nothing downloads a replacement."""
    db, ep, season = library
    sub = _row(db, ep, "Show - S01E01.cs.srt")
    sub_id = sub.id
    _drop(season, "neco-jineho.txt")      # folder readable, subtitle absent

    report = reconcile(db, episode_ids=[ep.id])

    assert report["deleted"] == 1
    assert db.query(Subtitle).filter(Subtitle.id == sub_id).first() is None


def test_deletion_can_be_switched_off(library):
    db, ep, season = library
    sub = _row(db, ep, "Show - S01E01.cs.srt")
    _drop(season, "jiny.txt")

    report = reconcile(db, delete_missing=False, episode_ids=[ep.id])

    assert report["missing"] == 1 and report["deleted"] == 0
    assert db.query(Subtitle).filter(Subtitle.id == sub.id).first() is not None


# ── the share is not mounted ─────────────────────────────────────────────────

def test_an_unreadable_folder_is_reported_not_judged(library):
    """An unmounted share makes every subtitle look deleted at once."""
    db, ep, _ = library
    sub = _row(db, ep, "Show - S01E01.cs.srt")
    sub.file_path = "/data/anime/Season 99/Show - S99E01.cs.srt"   # no such folder
    db.commit()

    report = reconcile(db, episode_ids=[ep.id])

    assert report["unreachable"] == 1
    assert report["missing"] == 0 and report["deleted"] == 0
    assert db.query(Subtitle).filter(Subtitle.id == sub.id).first() is not None


def test_nothing_is_deleted_when_most_of_the_library_looks_gone(library):
    """Half the rows missing is a storage problem, not 700 deletions. The guard
    needs enough rows to mean anything — one missing out of one is 100 %."""
    db, ep, season = library
    _drop(season, "jediny.cs.srt")
    present = _row(db, ep, "jediny.cs.srt")
    gone = [_row(db, ep, f"chybi-{i}.cs.srt") for i in range(15)]

    report = reconcile(db, episode_ids=[ep.id])

    assert report.get("aborted") is True
    assert report["deleted"] == 0
    for sub in gone:
        assert db.query(Subtitle).filter(Subtitle.id == sub.id).first() is not None
    assert present is not None


def test_deleting_a_phantom_recounts_the_series(library):
    """The series list, the dashboard and the promotion rules read the cached
    count rather than counting episodes. Deleting a phantom without recounting
    would leave the series still claiming the episode is covered — the exact
    state this job exists to end."""
    db, ep, season = library
    series = db.query(Series).filter(Series.id == ep.series_id).first()
    series.cached_cs_sub_count = 1
    db.commit()

    _row(db, ep, "Show - S01E01.cs.srt")
    _drop(season, "jiny.txt")             # folder readable, subtitle absent

    report = reconcile(db, episode_ids=[ep.id])

    assert report["deleted"] == 1
    db.refresh(series)
    assert series.cached_cs_sub_count == 0


# ── the series moved between library roots ───────────────────────────────────

def test_a_row_follows_its_series_to_the_new_root(library):
    """A promoted series moves out of incomplete_anime and its subtitle rows
    keep pointing at the old root. The folder there is gone, so the rows were
    written off as unreachable and skipped forever — 100 false "has subtitles"
    that nothing would ever replace."""
    db, ep, season = library
    sub = _row(db, ep, "Show - S01E01.cs.srt")
    sub.file_path = "/data/incomplete/Season 01/Show - S01E01.cs.srt"
    ep.file_path = "/data/anime/Season 01/Show - S01E01.mkv"
    db.commit()
    _drop(season, "Show - S01E01.cs.srt")

    report = reconcile(db, episode_ids=[ep.id])

    assert report["repaired"] == 1 and report["followed_move"] == 1
    assert report["unreachable"] == 0
    assert sub.file_path == "/data/anime/Season 01/Show - S01E01.cs.srt"


def test_the_move_also_finds_a_converted_file(library):
    db, ep, season = library
    sub = _row(db, ep, "Show - S01E01.cs.ass", fmt="ass")
    sub.file_path = "/data/incomplete/Season 01/Show - S01E01.cs.ass"
    ep.file_path = "/data/anime/Season 01/Show - S01E01.mkv"
    db.commit()
    _drop(season, "Show - S01E01.cs.srt")

    reconcile(db, episode_ids=[ep.id])

    assert sub.file_path == "/data/anime/Season 01/Show - S01E01.cs.srt"
    assert sub.format == "srt"


def test_gone_from_the_new_home_too_counts_as_missing(library):
    """The video is reachable and the subtitle is not beside it. That is a real
    answer, not a mount problem — 75 of the 100 were this."""
    db, ep, season = library
    sub = _row(db, ep, "Show - S01E01.cs.srt")
    sub.file_path = "/data/incomplete/Season 01/Show - S01E01.cs.srt"
    ep.file_path = "/data/anime/Season 01/Show - S01E01.mkv"
    db.commit()
    _drop(season, "neco-jineho.txt")

    report = reconcile(db, episode_ids=[ep.id])

    assert report["moved_missing"] == 1 and report["deleted"] == 1
    assert db.query(Subtitle).filter(Subtitle.id == sub.id).first() is None


def test_without_a_video_to_ask_the_row_is_still_left_alone(library):
    """No episode path means no authority on where it moved — and an unmounted
    share must not read as a deletion."""
    db, ep, _ = library
    sub = _row(db, ep, "Show - S01E01.cs.srt")
    sub.file_path = "/data/anime/Season 99/Show - S99E01.cs.srt"
    ep.file_path = None
    db.commit()

    report = reconcile(db, episode_ids=[ep.id])

    assert report["unreachable"] == 1 and report["deleted"] == 0
    assert db.query(Subtitle).filter(Subtitle.id == sub.id).first() is not None
