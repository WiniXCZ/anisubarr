"""
Subtitle providers in the connection registry.

Providers share the `services` table with service integrations, so the same
CRUD/UI works for both. What matters behaviourally:
  * credentials resolve registry → legacy flat settings,
  * a disabled provider is skipped entirely (the point of the feature after the
    Hiyori ban),
  * priority order comes from sort_order,
  * legacy flat settings get seeded into the registry once.
"""
import os
import tempfile

_tmpdir = tempfile.mkdtemp(prefix="anisubarr-provreg-test-")
os.environ.setdefault("DATABASE_URL", f"sqlite:///{_tmpdir}/test.db")
os.environ.setdefault("JWT_SECRET", "test-secret-not-for-production")

import pytest  # noqa: E402

from app.database import SessionLocal, create_all  # noqa: E402
from app.models.app_settings import AppSetting  # noqa: E402
from app.models.service import Service  # noqa: E402
from app.services import connections  # noqa: E402

create_all()


@pytest.fixture
def db():
    s = SessionLocal()
    try:
        s.query(Service).delete()
        s.query(AppSetting).delete()
        s.commit()
        yield s
    finally:
        s.rollback()
        s.close()


def test_resolve_falls_back_to_legacy_settings(db):
    db.add_all([
        AppSetting(key="hiyori_username", value="olduser"),
        AppSetting(key="hiyori_password", value="oldpass"),
    ])
    db.commit()
    assert connections.resolve_provider(db, "hiyori") == ("olduser", "oldpass", "")


def test_registry_wins_over_legacy(db):
    db.add_all([
        AppSetting(key="hiyori_username", value="olduser"),
        AppSetting(key="hiyori_password", value="oldpass"),
        Service(name="Hiyori", type="hiyori", username="newuser",
                password="newpass", enabled=True, sort_order=0),
    ])
    db.commit()
    user, pwd, _ = connections.resolve_provider(db, "hiyori")
    assert (user, pwd) == ("newuser", "newpass")


def test_kamui_rar_password_lives_in_extra(db):
    db.add(Service(name="Kamui", type="kamui", username="u", password="p",
                   extra="secretrar", enabled=True))
    db.commit()
    assert connections.resolve_provider(db, "kamui") == ("u", "p", "secretrar")


def test_order_follows_sort_order_and_skips_disabled(db):
    db.add_all([
        Service(name="Hiyori", type="hiyori", username="u", password="p",
                enabled=False, sort_order=0),   # banned → switched off
        Service(name="HnS", type="hns", username="u", password="p",
                enabled=True, sort_order=1),
        Service(name="Kamui", type="kamui", username="u", password="p",
                enabled=True, sort_order=2),
    ])
    db.commit()
    assert connections.enabled_provider_order(db) == ["hns", "kamui"]


def test_order_is_none_when_registry_empty(db):
    """No providers configured → caller keeps using the legacy order setting."""
    assert connections.enabled_provider_order(db) is None


def test_disabled_provider_yields_no_scraper(db):
    """A switched-off provider must not produce a scraper — that's what stops
    the app from touching a banned site at all."""
    from app.routers import subtitles as subs

    db.add(Service(name="Hiyori", type="hiyori", username="u", password="p",
                   enabled=False))
    db.commit()
    assert subs._hiyori(db) is None

    db.query(Service).filter(Service.type == "hiyori").update({"enabled": True})
    db.commit()
    assert subs._hiyori(db) is not None


def test_legacy_seed_creates_rows_once(db):
    db.add_all([
        AppSetting(key="hns_username", value="u"),
        AppSetting(key="hns_password", value="p"),
        AppSetting(key="kamui_username", value="ku"),
        AppSetting(key="kamui_password", value="kp"),
        AppSetting(key="kamui_rar_password", value="rar"),
    ])
    db.commit()

    assert connections.migrate_legacy_providers(db) == 2
    assert connections.migrate_legacy_providers(db) == 0  # idempotent

    kamui = db.query(Service).filter(Service.type == "kamui").one()
    assert (kamui.username, kamui.password, kamui.extra) == ("ku", "kp", "rar")
    # Providers with no stored credentials aren't created as empty rows.
    assert db.query(Service).filter(Service.type == "hiyori").count() == 0


# ── Ruční složka ─────────────────────────────────────────────────────────────
# A file the user already downloaded costs no request and can't get anyone
# banned, so the folder is searched before anything on the net.

def test_local_folder_is_seeded_first_and_only_once(db, tmp_path):
    assert connections.ensure_local_folder_provider(db) is True
    assert connections.ensure_local_folder_provider(db) is False  # idempotent

    row = db.query(Service).filter(Service.type == "local").one()
    assert row.enabled is True
    assert row.sort_order == -1, "ruční složka musí být před ostatními zdroji"
    assert os.path.isdir(row.host), "složka se vytvoří, ne jen zapíše do DB"


def test_local_folder_comes_first_in_the_order(db):
    db.add_all([
        Service(name="Hiyori", type="hiyori", username="u", password="p",
                enabled=True, sort_order=0),
        Service(name="Ruční složka", type="local", host="/tmp/anisubarr-drop",
                enabled=True, sort_order=-1),
    ])
    db.commit()
    assert connections.enabled_provider_order(db) == ["local", "hiyori"]


def test_installs_without_a_local_row_still_search_the_folder_first(db):
    """Upgrades shouldn't need reconfiguring to benefit from the folder."""
    from app.routers import subtitles as subs

    db.add(Service(name="Hiyori", type="hiyori", username="u", password="p",
                   enabled=True, sort_order=0))
    db.commit()
    assert subs._get_provider_order(db)[0] == "local"


def test_a_switched_off_local_folder_is_not_searched(db):
    from app.routers import subtitles as subs

    db.add_all([
        Service(name="Ruční složka", type="local", host="/tmp/anisubarr-drop",
                enabled=False, sort_order=-1),
        Service(name="Hiyori", type="hiyori", username="u", password="p",
                enabled=True, sort_order=0),
    ])
    db.commit()
    assert "local" not in subs._get_provider_order(db)
    assert subs._local(db) is None


def test_an_explicit_position_for_the_folder_is_respected(db):
    """Moved down in Připojení → Poskytovatelé means: try the net first."""
    from app.routers import subtitles as subs

    db.add_all([
        Service(name="Hiyori", type="hiyori", username="u", password="p",
                enabled=True, sort_order=0),
        Service(name="Ruční složka", type="local", host="/tmp/anisubarr-drop",
                enabled=True, sort_order=5),
    ])
    db.commit()
    assert subs._get_provider_order(db) == ["hiyori", "local"]


def test_folder_path_prefers_the_registry_over_the_default(db, tmp_path):
    from app.services import local_subs

    db.add(Service(name="Ruční složka", type="local", host=str(tmp_path),
                   enabled=True))
    db.commit()
    assert local_subs.folder_path(db) == str(tmp_path)


def test_nightly_download_defaults_off_and_migrates_once(db):
    """The library-wide nightly sweep must be off by default, and an install
    that already had it on gets it switched off exactly once."""
    from app.models.schedule import ScheduledJob
    from app.services import scheduler as sched

    assert sched.JOB_REGISTRY["download_missing"].get("enabled") is False

    db.query(ScheduledJob).delete()
    db.commit()
    sched._ensure_default_jobs()

    row = db.query(ScheduledJob).filter(ScheduledJob.job_id == "download_missing").one()
    assert row.enabled is False, "nová instalace má noční úlohu vypnutou"
    # Other jobs keep defaulting to enabled.
    assert db.query(ScheduledJob).filter(ScheduledJob.job_id == "sonarr_sync").one().enabled is True

    # Simulate an existing install that had it enabled.
    row.enabled = True
    db.commit()
    assert sched.disable_unattended_download_once() is True
    db.expire_all()
    assert db.query(ScheduledJob).filter(ScheduledJob.job_id == "download_missing").one().enabled is False

    # Runs once only — a deliberate re-enable is respected afterwards.
    db.query(ScheduledJob).filter(ScheduledJob.job_id == "download_missing").update({"enabled": True})
    db.commit()
    assert sched.disable_unattended_download_once() is False
    db.expire_all()
    assert db.query(ScheduledJob).filter(ScheduledJob.job_id == "download_missing").one().enabled is True
