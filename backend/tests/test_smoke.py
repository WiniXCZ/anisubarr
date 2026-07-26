"""
Smoke tests — import the app, run migrations against a throw-away SQLite file,
and exercise the critical request paths end-to-end (health, first-run setup,
auth, service registry, settings). Anything that breaks app import or basic
routing fails here instead of after deploy.

Run:  cd backend && python -m pytest -q tests
"""
import os
import tempfile

# Must be set before the app (and its lru_cached Settings) is imported.
_tmpdir = tempfile.mkdtemp(prefix="anisubarr-test-")
os.environ["DATABASE_URL"] = f"sqlite:///{_tmpdir}/test.db"
os.environ.setdefault("JWT_SECRET", "test-secret-not-for-production")

from fastapi.testclient import TestClient  # noqa: E402

from app.database import create_all  # noqa: E402
from app.main import app  # noqa: E402

create_all()
# TestClient without a `with` block does not run the lifespan — deliberate:
# no scheduler, no network calls, just the wiring under test.
client = TestClient(app)

_token: str | None = None


def _auth() -> dict:
    return {"Authorization": f"Bearer {_token}"}


def test_health():
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json().get("status") == "ok"


def test_setup_status_fresh_db():
    r = client.get("/api/auth/setup-status")
    assert r.status_code == 200
    assert r.json() == {"needs_setup": True}


def test_first_register_and_login():
    global _token
    r = client.post("/api/auth/register", json={"username": "admin", "password": "test123"})
    assert r.status_code == 201, r.text
    assert r.json()["is_admin"] is True

    r = client.post("/api/auth/token", data={"username": "admin", "password": "test123"})
    assert r.status_code == 200, r.text
    _token = r.json()["access_token"]
    assert _token

    # Setup is done now — and anonymous registration must be closed.
    assert client.get("/api/auth/setup-status").json() == {"needs_setup": False}
    r = client.post("/api/auth/register", json={"username": "intruder", "password": "x"})
    assert r.status_code == 401


def test_me():
    r = client.get("/api/auth/me", headers=_auth())
    assert r.status_code == 200
    assert r.json()["username"] == "admin"


def test_services_crud_and_default():
    r = client.post("/api/services", headers=_auth(),
                    json={"name": "Sonarr", "type": "sonarr", "host": "sonarr:8989",
                          "api_key": "k", "is_default": True})
    assert r.status_code == 201, r.text
    svc = r.json()
    assert svc["is_default"] is True
    assert svc["api_key"] == "••••"  # masked in responses

    # A second default of the same type steals the flag from the first.
    r2 = client.post("/api/services", headers=_auth(),
                     json={"name": "Sonarr 2", "type": "sonarr", "host": "sonarr2:8989",
                           "api_key": "k2", "is_default": True})
    assert r2.status_code == 201
    listing = client.get("/api/services", headers=_auth()).json()
    defaults = [s for s in listing if s["type"] == "sonarr" and s["is_default"]]
    assert len(defaults) == 1 and defaults[0]["name"] == "Sonarr 2"

    r = client.post("/api/services", headers=_auth(),
                    json={"name": "X", "type": "not-a-type"})
    assert r.status_code == 400


def test_library_linked_to_service():
    svc_id = client.get("/api/services", headers=_auth()).json()[0]["id"]
    r = client.post("/api/libraries", headers=_auth(),
                    json={"name": "Anime", "media_type": "anime", "sonarr_service_id": svc_id})
    assert r.status_code == 201, r.text
    assert r.json()["sonarr_service_id"] == svc_id


def test_settings_roundtrip():
    r = client.put("/api/settings", headers=_auth(), json={"scraper_timeout": "45"})
    assert r.status_code == 200, r.text
    r = client.get("/api/settings", headers=_auth())
    assert r.status_code == 200
    assert r.json().get("scraper_timeout") == "45"

    r = client.put("/api/settings", headers=_auth(), json={"definitely_unknown_key": "1"})
    assert r.status_code == 400


def test_settings_yaml_export_and_import():
    from app.database import SessionLocal
    from app.services.config_file import _yaml_path, export_settings, import_settings_if_changed

    db = SessionLocal()
    try:
        export_settings(db)
        path = _yaml_path()
        assert path.is_file()
        content = path.read_text(encoding="utf-8")
        assert "scraper_timeout" in content          # non-secret exported
        assert "api_key" not in content.lower() or "tvdb_api_key" not in content  # secrets stay out

        # Hand-edit the file → import picks it up.
        path.write_text(content.replace('scraper_timeout: \'45\'', 'scraper_timeout: \'60\'')
                        .replace('scraper_timeout: "45"', 'scraper_timeout: "60"'), encoding="utf-8")
        os.utime(path)  # bump mtime past the stored marker
        applied = import_settings_if_changed(db)
        assert applied >= 1
    finally:
        db.close()
    assert client.get("/api/settings", headers=_auth()).json().get("scraper_timeout") == "60"


def test_selfheal_fixes_orphan_library():
    from app.database import SessionLocal
    from app.models.library import Library
    from app.services.selfheal import run_startup_checks

    db = SessionLocal()
    try:
        db.add(Library(name="Broken", media_type="anime", sonarr_service_id=99999))
        db.commit()
        summary = run_startup_checks(db)
        assert summary["orphaned_library_links"] >= 1
        broken = db.query(Library).filter(Library.name == "Broken").first()
        assert broken.sonarr_service_id is None
    finally:
        db.close()


def test_system_diag():
    r = client.get("/api/system/diag", headers=_auth())
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["database"]["exists"] is True
    assert isinstance(body["services"], list)
