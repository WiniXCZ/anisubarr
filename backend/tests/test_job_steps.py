"""
The step trail under a running job.

`message` only ever holds the current line, so without a trail the detail people
actually ask about afterwards — which source answered, where the file went — is
gone the moment the next line overwrites it.
"""
import os
import tempfile

_tmpdir = tempfile.mkdtemp(prefix="anisubarr-jobsteps-test-")
os.environ.setdefault("DATABASE_URL", f"sqlite:///{_tmpdir}/test.db")
os.environ.setdefault("JWT_SECRET", "test-secret-not-for-production")

import pytest  # noqa: E402

from app.database import create_all  # noqa: E402
from app.services import job_log  # noqa: E402

create_all()


@pytest.fixture
def run():
    r = job_log.start_run("test_steps", "Testovací úloha")
    yield r
    if r.run_id in job_log._running:
        job_log.finish_run(r, "done", "")


def _texts(run_id):
    return [s["text"] for s in job_log.get_steps(run_id)]


def test_messages_become_steps(run):
    job_log.update_message(run.run_id, "hledám: Ruční složka")
    job_log.update_message(run.run_id, "stahuji: Frieren - 05.srt")
    assert _texts(run.run_id) == ["hledám: Ruční složka", "stahuji: Frieren - 05.srt"]


def test_extra_detail_does_not_replace_the_headline(run):
    job_log.update_message(run.run_id, "ukládám srt...")
    job_log.add_step(run.run_id, "→ /media/anime/Frieren/S01E05.cs.srt")

    assert job_log.get_runs(1)[0]["message"] == "ukládám srt..."
    assert "→ /media/anime/Frieren/S01E05.cs.srt" in _texts(run.run_id)


def test_a_repeated_line_is_not_logged_twice(run):
    for _ in range(3):
        job_log.update_message(run.run_id, "čekám 2s před dalším...")
    assert _texts(run.run_id) == ["čekám 2s před dalším..."]


def test_only_the_last_steps_are_kept(run):
    for i in range(job_log._MAX_STEPS + 5):
        job_log.add_step(run.run_id, f"krok {i}")
    steps = _texts(run.run_id)
    assert len(steps) == job_log._MAX_STEPS
    assert steps[-1] == f"krok {job_log._MAX_STEPS + 4}"


def test_the_trail_survives_the_job_finishing(run):
    """A failed job is exactly when someone goes looking for the detail."""
    job_log.add_step(run.run_id, "hledám: Hiyori")
    job_log.finish_run(run, "error", "nenalezeno")

    assert _texts(run.run_id) == ["hledám: Hiyori"]
    row = next(r for r in job_log.get_runs(20) if r["run_id"] == run.run_id)
    assert row["steps"] and row["status"] == "error"


def test_steps_of_a_finished_job_are_not_appended_to(run):
    job_log.finish_run(run, "done", "hotovo")
    job_log.add_step(run.run_id, "tohle už nepatří nikam")
    assert "tohle už nepatří nikam" not in _texts(run.run_id)
