"""
Read-only listing of accounts on the connected services.

The endpoint must normalise two very different payload shapes into one list and
degrade gracefully: one unreachable service may not hide the other's users.
"""
import os
import tempfile
from unittest.mock import patch

_tmpdir = tempfile.mkdtemp(prefix="anisubarr-svcusers-test-")
os.environ.setdefault("DATABASE_URL", f"sqlite:///{_tmpdir}/test.db")
os.environ.setdefault("JWT_SECRET", "test-secret-not-for-production")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.database import SessionLocal, create_all  # noqa: E402
from app.models.user import User  # noqa: E402
from app.routers import service_users as su  # noqa: E402
from app.services.auth import hash_password  # noqa: E402
from app.main import app  # noqa: E402

create_all()
client = TestClient(app)

_USERNAME = "svcuserstest"
_PASSWORD = "pw"


@pytest.fixture
def auth():
    """Temporary admin removed afterwards — test modules share one SQLite file
    and the smoke suite asserts on a pristine users table."""
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


# Already-normalised shape: these fixtures stand in for _seerr_users/_emby_users,
# which do the mapping themselves (that mapping is covered separately below).
SEERR_PAYLOAD = ([
    {"source": "seerr", "id": 1, "name": "Alice", "email": "a@x.cz", "avatar": None,
     "is_admin": True, "requests": 7, "last_seen": None},
], {"ok": True, "count": 1})

EMBY_PAYLOAD = ([
    {"source": "emby", "id": "e1", "name": "Bob", "email": None, "avatar": None,
     "is_admin": False, "disabled": True, "last_seen": None},
], {"ok": True, "count": 1})


def test_merges_both_services(auth):
    async def fake_seerr(db):
        return SEERR_PAYLOAD

    async def fake_emby(db):
        return EMBY_PAYLOAD

    with patch.object(su, "_seerr_users", fake_seerr), \
         patch.object(su, "_emby_users", fake_emby):
        body = client.get("/api/service-users", headers=auth).json()

    names = [u["name"] for u in body["users"]]
    assert names == ["Alice", "Bob"], "seřazeno podle jména napříč zdroji"
    assert body["sources"]["seerr"]["ok"] and body["sources"]["emby"]["ok"]


def test_one_failing_service_does_not_hide_the_other(auth):
    async def ok_seerr(db):
        return SEERR_PAYLOAD

    async def dead_emby(db):
        return [], {"ok": False, "reason": "Connection refused"}

    with patch.object(su, "_seerr_users", ok_seerr), \
         patch.object(su, "_emby_users", dead_emby):
        body = client.get("/api/service-users", headers=auth).json()

    assert [u["name"] for u in body["users"]] == ["Alice"]
    assert body["sources"]["emby"]["ok"] is False
    assert "refused" in body["sources"]["emby"]["reason"]


def test_unconfigured_services_report_cleanly(auth):
    """Nothing connected → empty list, and a reason the UI can stay quiet about."""
    body = client.get("/api/service-users", headers=auth).json()
    assert body["users"] == []
    assert body["sources"]["seerr"]["reason"] == "not_configured"
    assert body["sources"]["emby"]["reason"] == "not_configured"


def test_seerr_payload_is_normalised(auth):
    """Relative avatars get absolutised and the admin bit is decoded."""
    from app.models.service import Service

    db = SessionLocal()
    try:
        db.add(Service(name="Seerr", type="seerr", host="http://seerr.test:5055",
                       api_key="k", enabled=True, is_default=True))
        db.commit()

        class _Resp:
            status_code = 200
            def raise_for_status(self): pass
            def json(self): return {"results": [
                {"id": 1, "displayName": "Alice", "email": "a@x.cz",
                 "permissions": 2, "requestCount": 7, "avatar": "/avatarproxy/abc"},
                {"id": 2, "username": "bob", "permissions": 0, "requestCount": 0},
            ]}

        class _Client:
            async def __aenter__(self): return self
            async def __aexit__(self, *a): return False
            async def get(self, *a, **kw): return _Resp()

        with patch.object(su.httpx, "AsyncClient", lambda **kw: _Client()):
            users, state = client.get("/api/service-users", headers=auth).json(), None
        rows = [u for u in users["users"] if "seerr" in u["sources"]]

        alice = next(u for u in rows if u["name"] == "Alice")
        assert alice["is_admin"] is True
        assert alice["requests"] == 7
        assert alice["avatar"] == "http://seerr.test:5055/avatarproxy/abc"
        # Falls back to username when displayName is missing.
        assert any(u["name"] == "bob" and u["is_admin"] is False for u in rows)
    finally:
        db.query(Service).filter(Service.type == "seerr").delete()
        db.commit()
        db.close()


# ── Deduplication ────────────────────────────────────────────────────────────
# The same person usually has an account on both services; listing them twice
# (as seen in production: "AMP3R1X" and "Anetka" appeared once per service) is
# noise, so entries are merged into one row carrying both source badges.

def _seerr(name, **kw):
    base = {"source": "seerr", "id": 1, "name": name, "email": None, "avatar": None,
            "is_admin": False, "requests": 0, "last_seen": None}
    base.update(kw)
    return base


def _emby(name, **kw):
    base = {"source": "emby", "id": "e1", "name": name, "email": None, "avatar": None,
            "is_admin": False, "disabled": False, "last_seen": None}
    base.update(kw)
    return base


def test_same_person_on_both_services_becomes_one_row():
    merged = su._merge([_seerr("Anetka"), _emby("anetka")])  # case-insensitive
    assert len(merged) == 1
    assert sorted(merged[0]["sources"]) == ["emby", "seerr"]
    assert merged[0]["ids"] == {"seerr": 1, "emby": "e1"}


def test_merge_keeps_the_richer_details():
    merged = su._merge([
        _seerr("Ann", email="ann@x.cz", requests=5, last_seen="2026-01-01T00:00:00Z"),
        _emby("Ann", avatar="http://emby/a.jpg", is_admin=True,
              last_seen="2026-06-01T00:00:00Z"),
    ])[0]
    assert merged["email"] == "ann@x.cz"        # only Seerr has it
    assert merged["avatar"] == "http://emby/a.jpg"  # only Emby has it
    assert merged["requests"] == 5
    assert merged["is_admin"] is True            # admin anywhere counts
    assert merged["last_seen"] == "2026-06-01T00:00:00Z"  # most recent wins


def test_email_matches_across_differing_names():
    merged = su._merge([
        _seerr("bob_the_admin", email="bob@x.cz"),
        _emby("Bob", email="BOB@X.CZ"),
    ])
    assert len(merged) == 1, "shodný e-mail má přednost před jménem"


def test_two_accounts_on_the_same_service_stay_separate():
    """Same name twice within one service really is two different people."""
    merged = su._merge([_seerr("Alex", id=1), _seerr("Alex", id=2)])
    assert len(merged) == 2


def test_disabled_only_when_every_source_says_so():
    both_off = su._merge([_emby("X", disabled=True), _emby("X", disabled=True)])
    assert len(both_off) == 2  # same service → not merged

    mixed = su._merge([_seerr("Y"), _emby("Y", disabled=True)])[0]
    assert mixed["disabled"] is False, "aktivní v jedné službě → není zakázán"

    off = su._merge([_emby("Z", disabled=True)])[0]
    assert off["disabled"] is True


def test_distinct_people_are_not_merged():
    merged = su._merge([_seerr("Anna"), _emby("Baret")])
    assert len(merged) == 2
