"""
The editing operations over HTTP.

The logic is covered in ``test_subtitle_ops.py``; what matters here is that the
editor can reach it — that a cue list survives the round trip, that a rejected
edit comes back as a 400 the UI can show instead of a 500, and that none of it
is reachable without logging in.
"""
import os
import tempfile

_tmpdir = tempfile.mkdtemp(prefix="anisubarr-opsapi-test-")
os.environ.setdefault("DATABASE_URL", f"sqlite:///{_tmpdir}/test.db")
os.environ.setdefault("JWT_SECRET", "test-secret-not-for-production")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.database import SessionLocal, create_all  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services.auth import hash_password  # noqa: E402
from app.main import app  # noqa: E402

create_all()
client = TestClient(app)

_USERNAME = "opsapitest"
_PASSWORD = "pw"
_LINES = [{"start": 0, "end": 5, "text": "první"},
          {"start": 3, "end": 7, "text": "druhý"}]


@pytest.fixture
def auth():
    db = SessionLocal()
    db.add(User(username=_USERNAME, hashed_pw=hash_password(_PASSWORD),
                is_admin=True, role="admin"))
    db.commit()
    try:
        token = client.post("/api/auth/token",
                            data={"username": _USERNAME, "password": _PASSWORD}
                            ).json()["access_token"]
        yield {"Authorization": f"Bearer {token}"}
    finally:
        db.query(User).filter(User.username == _USERNAME).delete()
        db.commit()
        db.close()


def test_analyze_reports_the_overlap(auth):
    body = client.post("/api/subtitle-editor/ops/analyze",
                       headers=auth, json={"lines": _LINES}).json()
    assert body["count"] == 2
    assert body["summary"]["overlap"] == 1


def test_fix_returns_the_cues_and_what_it_did(auth):
    body = client.post("/api/subtitle-editor/ops/fix", headers=auth,
                       json={"lines": _LINES, "rules": ["overlap"]}).json()
    assert body["report"] == {"overlap": 1}
    assert body["lines"][0]["end"] < body["lines"][1]["start"]


def test_the_safe_rules_run_when_none_are_named(auth):
    body = client.post("/api/subtitle-editor/ops/fix", headers=auth,
                       json={"lines": _LINES}).json()
    assert body["report"]["overlap"] == 1
    assert "tags" not in body["report"]


def test_two_point_sync_over_http(auth):
    body = client.post("/api/subtitle-editor/ops/sync-points", headers=auth,
                       json={"lines": _LINES, "first": [0, 1], "second": [3, 5]}).json()
    assert body["lines"][0]["start"] == 1


def test_a_rejected_edit_comes_back_as_a_400(auth):
    """The UI shows the message; a 500 would just say "server error"."""
    r = client.post("/api/subtitle-editor/ops/merge", headers=auth,
                    json={"lines": _LINES, "indexes": [0]})
    assert r.status_code == 400
    assert "aspoň dva" in r.json()["detail"]


def test_a_broken_regex_is_a_400_too(auth):
    r = client.post("/api/subtitle-editor/ops/replace", headers=auth,
                    json={"lines": _LINES, "find": "(", "replace": "x", "regex": True})
    assert r.status_code == 400


@pytest.mark.parametrize("path", [
    "analyze", "fix", "shift", "scale", "sync-points",
    "replace", "split", "merge", "insert", "delete",
])
def test_the_operations_need_a_login(path):
    r = client.post(f"/api/subtitle-editor/ops/{path}", json={"lines": _LINES})
    assert r.status_code in (401, 403)


# ── hostile input ────────────────────────────────────────────────────────────

def test_a_time_that_is_not_a_number_is_a_400(auth):
    """Cue times arrive as untyped JSON. A client sending "1.5" reached the
    arithmetic and came back as a 500 naming nothing."""
    r = client.post("/api/subtitle-editor/ops/shift", headers=auth,
                    json={"lines": [{"start": "1.5", "end": "2.0", "text": "x"}], "seconds": 1})
    assert r.status_code in (400, 422)


def test_infinity_is_refused(auth):
    """NaN and infinity survive every operation and land in the file as
    00:00:00,000 — a subtitle silently rewritten to nothing. Python's own
    json.dumps emits `Infinity` happily, so this is a payload a client sends
    without meaning to."""
    r = client.post("/api/subtitle-editor/ops/analyze",
                    headers={**auth, "Content-Type": "application/json"},
                    content=b'{"lines": [{"start": 0, "end": Infinity, "text": "x"}]}')
    assert r.status_code == 400
    assert "konečné" in r.json()["detail"]


def test_a_missing_time_is_still_accepted(auth):
    """A cue with no explicit start is normal in a half-parsed file."""
    r = client.post("/api/subtitle-editor/ops/analyze", headers=auth,
                    json={"lines": [{"text": "x"}]})
    assert r.status_code == 200
