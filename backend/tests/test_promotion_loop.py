"""
The demotion that undid itself every night.

`fix_wrongly_promoted` cleared `promoted` without moving anything — it never
calls Sonarr. `check_and_promote` then looked at the folder, found the series
still sitting in anime_series and set `promoted` back "regardless of subtitle
status". So the same 25 shows were demoted again every run, each with its own
Discord notice, while on disk nothing ever changed.
"""
import os
import tempfile
from unittest.mock import patch

_tmpdir = tempfile.mkdtemp(prefix="anisubarr-promoloop-test-")
os.environ.setdefault("DATABASE_URL", f"sqlite:///{_tmpdir}/test.db")
os.environ.setdefault("JWT_SECRET", "test-secret-not-for-production")

import pytest  # noqa: E402

from app.database import SessionLocal, create_all  # noqa: E402
from app.models.series import Episode, Series  # noqa: E402
from app.services import promotion  # noqa: E402

create_all()

_ID_BASE = 960_000
_next_id = iter(range(_ID_BASE, _ID_BASE + 500))


@pytest.fixture
def promoted_series():
    """A promoted series living in the target folder, missing most subtitles."""
    db = SessionLocal()
    n = next(_next_id)
    series = Series(title=f"Loop Show {n}", sonarr_id=n, promoted=True,
                    has_issue=False, status="continuing",
                    path="/data/media/anime_series/Loop Show")
    db.add(series)
    db.flush()
    for i in range(1, 11):
        db.add(Episode(series_id=series.id, sonarr_ep_id=n * 100 + i,
                       season_number=1, episode_number=i, has_file=True))
    db.commit()
    try:
        yield db, series
    finally:
        db.query(Episode).filter(Episode.series_id == series.id).delete()
        db.query(Series).filter(Series.id == series.id).delete()
        db.commit()
        db.close()


def _sweep(db, series, notify=False):
    """Run the sweep over just this series."""
    with patch.object(promotion, "_should_demote",
                      lambda s, d, dir_cache=None: ("demote", "8 dílů bez titulků")):
        return [r for r in promotion.fix_wrongly_promoted(db, notify=notify)
                if r["series_id"] == series.id]


def test_a_db_only_sweep_does_not_clear_promoted(promoted_series):
    """Clearing it without moving the folder is what started the loop:
    check_and_promote reads the folder and sets the flag straight back."""
    db, series = promoted_series

    _sweep(db, series)

    db.refresh(series)
    assert series.promoted is True, "flag a složka si musí odpovídat"
    assert series.has_issue is True, "problém se má zaznamenat"


def test_the_notice_goes_out_once_not_every_run(promoted_series):
    """Same verdict, three runs. The user was getting this on Discord daily."""
    db, series = promoted_series

    first  = _sweep(db, series)
    second = _sweep(db, series)
    third  = _sweep(db, series)

    assert len(first) == 1 and first[0]["action"] == "issue_flagged"
    assert second == [] and third == []


def test_a_series_that_recovers_is_unflagged(promoted_series):
    db, series = promoted_series
    _sweep(db, series)

    with patch.object(promotion, "_should_demote",
                      lambda s, d, dir_cache=None: ("ok", "all_subbed")):
        promotion.fix_wrongly_promoted(db, notify=False)

    db.refresh(series)
    assert series.has_issue is False
    assert series.promoted is True
