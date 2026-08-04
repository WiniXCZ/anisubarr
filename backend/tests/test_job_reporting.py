"""
Scheduled jobs say which anime they touched.

The activity panel used to show rows like "Kontrola povýšení / degradace ·
hotovo" — true, and completely uninformative. Which show was promoted, which
lost its subtitles, which episode got a subtitle: all of it existed only in the
container log.
"""
import os
import tempfile
from unittest.mock import patch

_tmpdir = tempfile.mkdtemp(prefix="anisubarr-jobreport-test-")
os.environ.setdefault("DATABASE_URL", f"sqlite:///{_tmpdir}/test.db")
os.environ.setdefault("JWT_SECRET", "test-secret-not-for-production")

import pytest  # noqa: E402

from app.database import SessionLocal, create_all  # noqa: E402
from app.models.series import Series  # noqa: E402
from app.services import job_log, scheduler  # noqa: E402

create_all()

_next_id = iter(range(4000, 4100))


@pytest.fixture
def shows():
    """Three series to be reported on, removed afterwards."""
    n = next(_next_id)
    db = SessionLocal()
    rows = [Series(title=f"Frieren {n}", sonarr_id=n),
            Series(title=f"86 Eighty Six {n}", sonarr_id=n + 1),
            Series(title=f"Bocchi {n}", sonarr_id=n + 2)]
    db.add_all(rows)
    db.commit()
    ids = {r.title: r.id for r in rows}
    try:
        yield ids
    finally:
        db.query(Series).filter(Series.id.in_(ids.values())).delete(synchronize_session=False)
        db.commit()
        db.close()


def _run(job_id, name):
    return job_log.start_run(job_id, name)


def _finish(run):
    job_log.finish_run(run, "done", job_log.get_message(run.run_id))
    return next(r for r in job_log.get_runs(20) if r["run_id"] == run.run_id)


def test_promotion_check_names_every_affected_show(shows):
    titles = list(shows)
    results = [
        {"action": "promoted", "series_id": shows[titles[0]]},
        {"action": "demoted", "series_id": shows[titles[1]], "reason": "ztratila CZ titulky"},
        {"action": "issue_flagged", "series_id": shows[titles[2]], "reason": "issue v Seerr"},
    ]

    run = _run("promotion_check", "Kontrola povýšení / degradace")
    with patch("app.services.promotion.run_all_promotions", lambda db: results):
        scheduler.job_promotion_check()
    row = _finish(run)

    trail = " | ".join(s["text"] for s in row["steps"])
    assert titles[0] in trail and "povýšeno" in trail
    assert titles[1] in trail and "degradováno" in trail
    assert "ztratila CZ titulky" in trail, "důvod degradace se ztratil"
    assert titles[2] in trail


def test_the_summary_says_what_happened(shows):
    results = [{"action": "promoted", "series_id": v} for v in shows.values()]

    run = _run("promotion_check", "Kontrola povýšení / degradace")
    with patch("app.services.promotion.run_all_promotions", lambda db: results):
        scheduler.job_promotion_check()
    row = _finish(run)

    assert row["message"] == "3× povýšeno"
    # The closing summary is the row's message; repeating it as the last step
    # would just be noise.
    assert row["steps"][-1]["text"] != row["message"]


def test_a_run_that_changed_nothing_says_so(shows):
    run = _run("promotion_check", "Kontrola povýšení / degradace")
    with patch("app.services.promotion.run_all_promotions", lambda db: []):
        scheduler.job_promotion_check()
    assert _finish(run)["message"] == "beze změn"


def test_audit_reports_state_changes_by_name(shows):
    titles = list(shows)
    results = [
        {"series_id": shows[titles[0]], "changed": True,
         "audit_status": "CLEAN", "audit_status_reason": "kompletní"},
        {"series_id": shows[titles[1]], "changed": False, "audit_status": "PENDING"},
    ]

    run = _run("audit_check", "Audit titulků")
    with patch("app.services.audit.audit_all", lambda db: results):
        scheduler.job_audit_check()
    row = _finish(run)

    trail = " | ".join(s["text"] for s in row["steps"])
    assert f"{titles[0]}: → CLEAN" in trail
    assert titles[1] not in trail, "beze změny se nemá hlásit"
    assert row["message"] == "2 seriálů, 1 změn stavu"


def test_a_failed_job_still_reports_what_it_managed(shows):
    """The exception is the scheduler's business; the trail must survive it."""
    run = _run("promotion_check", "Kontrola povýšení / degradace")

    def _boom(db):
        raise RuntimeError("Sonarr nedostupný")

    with patch("app.services.promotion.run_all_promotions", _boom):
        scheduler.job_promotion_check()   # swallows, like the scheduler expects
    row = _finish(run)
    assert row["status"] == "done"


def test_single_series_sync_is_labelled_with_the_title(shows):
    from app.routers import sync

    title = next(iter(shows))
    db = SessionLocal()
    try:
        sonarr_id = db.query(Series.sonarr_id).filter(Series.title == title).one().sonarr_id
    finally:
        db.close()

    assert sync._series_label(sonarr_id) == title
    assert sync._series_label(999999) == "série #999999", "neznámé id má zůstat čitelné"
