"""
Seerr must resolve its connection from one place.

Regression guard: /api/seerr/status used to read the legacy flat settings while
every other call path went through the connection registry. A Seerr configured
in Připojení → Služby therefore reported "not_configured", which hid the Seerr
tab in Žádosti and made requests look broken.
"""
import os
import tempfile

_tmpdir = tempfile.mkdtemp(prefix="anisubarr-seerrcfg-test-")
os.environ.setdefault("DATABASE_URL", f"sqlite:///{_tmpdir}/test.db")
os.environ.setdefault("JWT_SECRET", "test-secret-not-for-production")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.database import SessionLocal, create_all  # noqa: E402
from app.models.app_settings import AppSetting  # noqa: E402
from app.models.service import Service  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services.auth import hash_password  # noqa: E402
from app.main import app  # noqa: E402

create_all()
client = TestClient(app)

_USERNAME = "seerrcfgtest"
_PASSWORD = "pw"


@pytest.fixture
def auth(db):
    """Temporary admin, created directly and removed afterwards.

    Test modules share one SQLite file (the engine is built on first import),
    and the smoke suite asserts on a pristine users table — so this fixture must
    leave no trace. Registering through the API wouldn't work anyway: after the
    first user exists, /register requires an admin token.
    """
    user = User(username=_USERNAME, hashed_pw=hash_password(_PASSWORD),
                is_admin=True, role="admin")
    db.add(user)
    db.commit()
    try:
        token = client.post(
            "/api/auth/token", data={"username": _USERNAME, "password": _PASSWORD}
        ).json()["access_token"]
        yield {"Authorization": f"Bearer {token}"}
    finally:
        db.query(User).filter(User.username == _USERNAME).delete()
        db.commit()


@pytest.fixture
def db():
    s = SessionLocal()
    try:
        s.query(Service).filter(Service.type == "seerr").delete()
        s.query(AppSetting).filter(
            AppSetting.key.in_(["seerr_host", "seerr_api_key"])
        ).delete(synchronize_session=False)
        s.commit()
        yield s
    finally:
        s.rollback()
        s.close()


def test_status_reports_not_configured_when_nothing_is_set(db, auth):
    r = client.get("/api/seerr/status", headers=auth)
    assert r.status_code == 200
    assert r.json() == {"connected": False, "reason": "not_configured"}


def test_status_sees_seerr_configured_in_the_registry(db, auth):
    """The bug: registry-configured Seerr was reported as not_configured."""
    db.add(Service(name="Seerr", type="seerr", host="http://seerr.invalid:5055",
                   api_key="k", enabled=True, is_default=True))
    db.commit()

    body = client.get("/api/seerr/status", headers=auth).json()
    # The host is unreachable in tests, so `connected` stays False — but the
    # reason must be a connection error, never "not_configured".
    assert body["reason"] != "not_configured", (
        "status nevidí Seerr z registru → záložka Seerr v Žádostech zmizí"
    )


def test_status_still_honours_legacy_settings(db, auth):
    """Installs that never migrated to the registry keep working."""
    db.add_all([
        AppSetting(key="seerr_host", value="http://legacy.invalid:5055"),
        AppSetting(key="seerr_api_key", value="k"),
    ])
    db.commit()

    body = client.get("/api/seerr/status", headers=auth).json()
    assert body["reason"] != "not_configured"
