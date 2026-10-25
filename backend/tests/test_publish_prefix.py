"""
Publish and demote by the same question: can the show be started in Czech?

On 22.–25. 10. 2026 the morning promotion check "demoted" the same shows every
other day — One Piece, Slime, Black Clover and others, because a new season
without subtitles yet pushed them over the 10 % threshold. Nothing moved on
disk: the flag went down, the coverage-free Seerr check cleared the issue the
next morning, the folder put `promoted` back, and the morning after that the
same Discord notice went out again.
"""
import os
import tempfile
from unittest.mock import patch

_tmpdir = tempfile.mkdtemp(prefix="anisubarr-prefix-test-")
os.environ.setdefault("DATABASE_URL", f"sqlite:///{_tmpdir}/test.db")
os.environ.setdefault("JWT_SECRET", "test-secret-not-for-production")

import pytest  # noqa: E402

from app.database import SessionLocal, create_all  # noqa: E402
from app.models.series import Episode, Series  # noqa: E402
from app.services import promotion  # noqa: E402

create_all()

_ID_BASE = 970_000
_next_id = iter(range(_ID_BASE, _ID_BASE + 500))

ANIME_SERIES = "/data/media/anime_series"
INCOMPLETE   = "/data/media/incomplete_anime"


def _make(db, czech, status="continuing", folder=ANIME_SERIES, promoted=True):
    """A series whose episodes have Czech where *czech* says so (S01E01 first)."""
    n = next(_next_id)
    s = Series(title=f"Prefix Show {n}", sonarr_id=n, promoted=promoted,
               has_issue=False, status=status, path=f"{folder}/Prefix Show {n}")
    db.add(s)
    db.flush()
    for i, cs in enumerate(czech, start=1):
        db.add(Episode(series_id=s.id, sonarr_ep_id=n * 100 + i, season_number=1,
                       episode_number=i, has_file=True,
                       subtitles_in_file="cze" if cs else None))
    db.commit()
    db.refresh(s)
    return s


@pytest.fixture
def db():
    session = SessionLocal()
    made = []
    session.make = lambda *a, **kw: made.append(_make(session, *a, **kw)) or made[-1]
    try:
        yield session
    finally:
        for s in made:
            session.query(Episode).filter(Episode.series_id == s.id).delete()
            session.query(Series).filter(Series.id == s.id).delete()
        session.commit()
        session.close()


def _settings(**values):
    return patch("app.utils.settings_helper.read_setting",
                 lambda key, db=None: values.get(key))


def _folders():
    return patch.object(promotion, "_find_root_folder",
                     lambda frag: ANIME_SERIES if "anime" in frag and "incomplete" not in frag
                     else INCOMPLETE if "incomplete" in frag else None)


# ── The rule ──────────────────────────────────────────────────────────────────

def test_a_new_season_without_subtitles_does_not_demote(db):
    """Spare Me, Great Lord!: 24 of 30 in Czech, the new season isn't yet."""
    s = db.make([True] * 24 + [False] * 6)
    with _settings():
        assert promotion._should_demote(s, db)[0] == "ok"


def test_a_hole_in_the_middle_does_not_demote(db):
    s = db.make([True, True, False, True, False, True])
    with _settings():
        assert promotion._should_demote(s, db)[0] == "ok"


def test_without_the_first_episode_it_is_demoted(db):
    """From Overshadowed to Overpowered: you can't start it in Czech."""
    s = db.make([False, False, False] + [True] * 9, status="ended")
    with _settings():
        verdict, reason = promotion._should_demote(s, db)
    assert verdict == "demote"
    assert reason == "missing_cs_start:S01E01"


def test_promotion_and_demotion_agree(db):
    """A show that qualifies is never demoted by the same rule, and back."""
    good = db.make([True, False, False])
    bad  = db.make([False, True, True])
    with _settings():
        assert promotion._qualifies_for_promotion(db, good)["ok"] is True
        assert promotion._should_demote(good, db)[0] == "ok"
        assert promotion._qualifies_for_promotion(db, bad)["ok"] is False
        assert promotion._should_demote(bad, db)[0] == "demote"


def test_the_prefix_is_configurable(db):
    s = db.make([True, True, False, True])
    with _settings(promo_min_prefix="3"):
        assert promotion._qualifies_for_promotion(db, s)["ok"] is False
        assert promotion._should_demote(s, db) == ("demote", "missing_cs_start:S01E03")
    with _settings(promo_min_prefix="2"):
        assert promotion._qualifies_for_promotion(db, s)["ok"] is True


def test_a_show_shorter_than_the_prefix_needs_all_it_has(db):
    s = db.make([True, True])
    with _settings(promo_min_prefix="5"):
        assert promotion._qualifies_for_promotion(db, s)["ok"] is True


# ── The loop ──────────────────────────────────────────────────────────────────

def _morning(db, **settings):
    """One promotion_check run, Seerr reachable with no open issues."""
    with _settings(**settings), _folders(), \
         patch.object(promotion, "_seerr_config", lambda d: ("http://seerr", "k")), \
         patch("httpx.get") as get, \
         patch.object(promotion.sonarr_svc, "update_series") as move, \
         patch("app.services.discord.notify_demoted") as demoted, \
         patch("app.services.discord.notify_issue_flagged") as flagged:
        get.return_value.json.return_value = {"results": [], "pageInfo": {"pages": 1}}
        get.return_value.raise_for_status.return_value = None
        promotion.run_all_promotions(db)
        return move, demoted.call_count + flagged.call_count


def test_flag_only_mode_reports_once_and_keeps_promoted(db):
    """demote_on_episode_error=flag_only (the default) never moves the folder,
    so the show must stay promoted and the notice must not repeat."""
    s = db.make([False, True, True])

    notices = [_morning(db)[1] for _ in range(4)]
    db.refresh(s)

    assert notices == [1, 0, 0, 0]
    assert s.promoted is True, "složka zůstala v anime_series"
    assert s.has_issue is True


def test_a_real_demotion_moves_the_folder_once(db):
    s = db.make([False, True, True])

    move, notices = _morning(db, demote_on_episode_error="after_x_episodes")
    db.refresh(s)

    assert move.call_count == 1
    assert move.call_args.kwargs["rootFolderPath"] == INCOMPLETE
    assert notices == 1
    assert s.promoted is False and s.has_issue is True


def test_the_flag_clears_when_czech_returns(db):
    s = db.make([False, True, True])
    _morning(db)

    s.episodes[0].subtitles_in_file = "cze"
    db.commit()
    _morning(db)
    db.refresh(s)

    assert s.has_issue is False
    assert s.promoted is True


def test_no_notice_at_all_for_a_show_that_can_be_started(db):
    """The 15 shows from the October loop: every morning, nothing to say."""
    db.make([True] * 10 + [False] * 4)
    assert [_morning(db)[1] for _ in range(3)] == [0, 0, 0]
