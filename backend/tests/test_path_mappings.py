"""
One path rule per Sonarr root.

A single prefix pair only works for a library that lives under one root. This
Sonarr has both ``/data/media/anime_series/…`` and ``/data/nekompatibilní
anime/…``, and mapping ``/data/media`` → ``/media`` would fix the first while
leaving the second unreachable — a subtitle "missing" for a reason nothing in
the app could explain.
"""
import json
import os
import tempfile
from unittest.mock import patch

_tmpdir = tempfile.mkdtemp(prefix="anisubarr-pathmap-test-")
os.environ.setdefault("DATABASE_URL", f"sqlite:///{_tmpdir}/test.db")
os.environ.setdefault("JWT_SECRET", "test-secret-not-for-production")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.database import SessionLocal, create_all  # noqa: E402
from app.models.app_settings import AppSetting  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services import path_resolver  # noqa: E402
from app.services.auth import hash_password  # noqa: E402
from app.main import app  # noqa: E402

create_all()
client = TestClient(app)

_USERNAME = "pathmaptest"
_PASSWORD = "pw"


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
        db.query(AppSetting).filter(AppSetting.key == "path_mappings").delete()
        db.commit()
        db.close()
        path_resolver._cfg_cache_clear()


def _with_rules(rules, **extra):
    """Configuration as the resolver sees it, without touching the database."""
    values = {"path_mappings": json.dumps(rules), **extra}
    return patch.object(path_resolver, "_cfg_value",
                        lambda key, default="": values.get(key, ""))


# ── resolving ────────────────────────────────────────────────────────────────

def test_each_root_gets_its_own_rule():
    rules = [{"from": "/data/media", "to": "/media"},
             {"from": "/data", "to": "/media/ostatni"}]
    with _with_rules(rules):
        assert path_resolver.resolve("/data/media/anime_series/Show/x.mkv") \
            == "/media/anime_series/Show/x.mkv"
        assert path_resolver.resolve("/data/nekompatibilní anime/Show/x.mkv") \
            == "/media/ostatni/nekompatibilní anime/Show/x.mkv"


def test_the_most_specific_rule_wins_whatever_the_order():
    """Rules are written in whatever order they were added; /data must not
    swallow paths that /data/media describes better."""
    rules = [{"from": "/data", "to": "/wrong"},
             {"from": "/data/media", "to": "/right"}]
    with _with_rules(rules):
        assert path_resolver.resolve("/data/media/x.mkv") == "/right/x.mkv"


def test_a_path_no_rule_covers_is_left_alone():
    with _with_rules([{"from": "/data", "to": "/media"}]):
        assert path_resolver.resolve("/jinde/x.mkv") == "/jinde/x.mkv"


def test_the_old_single_pair_still_works():
    """Installs that never used the list must keep resolving as before."""
    with _with_rules([], path_sonarr_prefix="/data", path_local_prefix="/media"):
        assert path_resolver.resolve("/data/anime/x.mkv") == "/media/anime/x.mkv"


def test_the_old_pair_is_the_last_resort():
    """An explicit rule beats the legacy pair for the paths it covers."""
    with _with_rules([{"from": "/data/media", "to": "/right"}],
                     path_sonarr_prefix="/data", path_local_prefix="/fallback"):
        assert path_resolver.resolve("/data/media/x.mkv") == "/right/x.mkv"
        assert path_resolver.resolve("/data/jine/x.mkv") == "/fallback/jine/x.mkv"


def test_broken_json_does_not_break_resolving():
    with patch.object(path_resolver, "_cfg_value",
                      lambda key, default="": {"path_mappings": "{tohle není json",
                                               "path_sonarr_prefix": "/data",
                                               "path_local_prefix": "/media"}.get(key, "")):
        assert path_resolver.resolve("/data/x.mkv") == "/media/x.mkv"


# ── adding rules through the API ─────────────────────────────────────────────

def test_adding_a_rule_keeps_the_previous_ones(auth):
    client.post("/api/settings/path-mapping", headers=auth,
                json={"sonarr_prefix": "/data/media", "local_prefix": "/media"})
    body = client.post("/api/settings/path-mapping", headers=auth,
                       json={"sonarr_prefix": "/data/jine", "local_prefix": "/cache"}).json()

    assert body["mappings"] == [{"from": "/data/media", "to": "/media"},
                                {"from": "/data/jine", "to": "/cache"}]


def test_adding_the_same_root_twice_replaces_it(auth):
    client.post("/api/settings/path-mapping", headers=auth,
                json={"sonarr_prefix": "/data", "local_prefix": "/stara"})
    body = client.post("/api/settings/path-mapping", headers=auth,
                       json={"sonarr_prefix": "/data/", "local_prefix": "/nova"}).json()

    assert body["mappings"] == [{"from": "/data", "to": "/nova"}]


def test_an_empty_path_is_refused(auth):
    r = client.post("/api/settings/path-mapping", headers=auth,
                    json={"sonarr_prefix": "  ", "local_prefix": "/media"})
    assert r.status_code == 400
