"""
The promotion notice waits until Emby actually has the show.

Promotion moves the folder and only then asks Emby to scan, so at the moment
the message used to be sent the show was typically not in the library yet —
and the "Přehrát" link had nothing to point at but the homepage.
"""
import os
import tempfile
import time
from unittest.mock import patch

_tmpdir = tempfile.mkdtemp(prefix="anisubarr-notifywait-test-")
os.environ.setdefault("DATABASE_URL", f"sqlite:///{_tmpdir}/test.db")
os.environ.setdefault("JWT_SECRET", "test-secret-not-for-production")

import pytest  # noqa: E402

from app.database import SessionLocal, create_all  # noqa: E402
from app.models.app_settings import AppSetting  # noqa: E402
from app.models.series import Series  # noqa: E402
from app.services import discord as discord_svc  # noqa: E402
from app.services import emby as emby_svc  # noqa: E402

create_all()

_ITEM = {"Id": "abc123", "Name": "86 EIGHTY-SIX", "ServerId": "srv77"}
_next_id = iter(range(8000, 8100))


@pytest.fixture
def series():
    n = next(_next_id)
    db = SessionLocal()
    row = Series(title=f"Promo Show {n}", sonarr_id=n, tvdb_id=n)
    db.add(row)
    db.add_all([
        AppSetting(key="emby_external_url", value="https://filmy.example.cz"),
        AppSetting(key="discord_webhook_url", value="https://discord.example/hook"),
        AppSetting(key="discord_wait_for_emby_seconds", value="3"),
    ])
    db.commit()
    emby_svc._server_kind_cache = "emby"
    try:
        yield row.id, row.tvdb_id
    finally:
        db.query(Series).filter(Series.id == row.id).delete()
        db.query(AppSetting).filter(AppSetting.key.in_([
            "emby_external_url", "discord_webhook_url", "emby_server_id",
            "discord_wait_for_emby", "discord_wait_for_emby_seconds",
            f"_notif_promoted_{row.id}",
        ])).delete(synchronize_session=False)
        db.commit()
        db.close()
        emby_svc._server_kind_cache = None


class _Json:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self._payload


def _library(present: dict, tvdb_id):
    """Emby that only knows the show once `present["yes"]` flips — that is what
    a library scan finishing looks like from the outside."""
    def _get(url, params=None, timeout=None, **kw):
        if url.endswith("/System/Info/Public"):
            return _Json({"ProductName": "Emby Server"})
        if not present["yes"]:
            return _Json({"Items": []})
        wanted = (params or {}).get("AnyProviderIdEquals")
        if wanted and wanted != f"tvdb.{tvdb_id}":
            return _Json({"Items": []})
        return _Json({"Items": [_ITEM]})
    return _get


def _sent_messages(sent):
    def _post(url, **kw):
        sent.append(kw.get("json"))
        return _Json({})
    return _post


def _wait_for(predicate, seconds=5.0):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.05)
    return False


def _play_link(message):
    return message["embeds"][0]["description"].splitlines()[-1]


def test_the_notice_waits_for_the_show_to_appear(series):
    series_id, tvdb_id = series
    present = {"yes": False}
    sent = []

    with patch.object(emby_svc, "_get_config", lambda: ("http://emby.test", "k")), \
         patch("httpx.get", _library(present, tvdb_id)), \
         patch("httpx.post", _sent_messages(sent)):
        discord_svc.notify_promoted_when_ready(series_id)
        time.sleep(0.3)
        assert not sent, "zpráva odešla dřív, než Emby seriál mělo"

        present["yes"] = True          # library scan finished
        assert _wait_for(lambda: sent), "zpráva nedorazila ani po objevení v Emby"

    assert "#!/item?id=abc123" in _play_link(sent[0])


def test_a_show_that_never_appears_is_still_announced(series):
    """A late notice beats none — it just links to the homepage."""
    series_id, tvdb_id = series
    sent = []

    with patch.object(emby_svc, "_get_config", lambda: ("http://emby.test", "k")), \
         patch("httpx.get", _library({"yes": False}, tvdb_id)), \
         patch("httpx.post", _sent_messages(sent)):
        discord_svc.notify_promoted_when_ready(series_id)
        assert _wait_for(lambda: sent, seconds=10), "po vypršení čekání se nic neodeslalo"

    assert _play_link(sent[0]).endswith("https://filmy.example.cz)")


def test_waiting_can_be_switched_off(series):
    series_id, tvdb_id = series
    db = SessionLocal()
    db.add(AppSetting(key="discord_wait_for_emby", value="false"))
    db.commit()
    db.close()

    sent = []
    with patch.object(emby_svc, "_get_config", lambda: ("http://emby.test", "k")), \
         patch("httpx.get", _library({"yes": False}, tvdb_id)), \
         patch("httpx.post", _sent_messages(sent)):
        discord_svc.notify_promoted_when_ready(series_id)
        assert _wait_for(lambda: sent, seconds=3), "bez čekání má zpráva odejít hned"


def test_the_server_id_from_the_library_ends_up_in_the_link(series):
    series_id, tvdb_id = series
    sent = []

    with patch.object(emby_svc, "_get_config", lambda: ("http://emby.test", "k")), \
         patch("httpx.get", _library({"yes": True}, tvdb_id)), \
         patch("httpx.post", _sent_messages(sent)):
        discord_svc.notify_promoted_when_ready(series_id)
        assert _wait_for(lambda: sent)

    assert "serverId=srv77" in _play_link(sent[0])


def test_the_id_is_stored_so_later_messages_skip_the_lookup(series):
    series_id, tvdb_id = series
    sent = []

    with patch.object(emby_svc, "_get_config", lambda: ("http://emby.test", "k")), \
         patch("httpx.get", _library({"yes": True}, tvdb_id)), \
         patch("httpx.post", _sent_messages(sent)):
        discord_svc.notify_promoted_when_ready(series_id)
        assert _wait_for(lambda: sent)

    db = SessionLocal()
    try:
        assert db.query(Series).filter(Series.id == series_id).one().emby_id == "abc123"
    finally:
        db.close()
