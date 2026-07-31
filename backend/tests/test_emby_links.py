"""
The "Přehrát" link in notifications has to open the show, not the homepage.

Two independent ways it degraded to the homepage in production:
  * the series had no emby_id, because the lookup searched only by the Sonarr
    title — "86: Eighty Six" finds nothing in a library that spells the show
    "86 EIGHTY-SIX";
  * the deep link was built in Emby's shape for a Jellyfin server, which routes
    its web client differently and quietly lands on the homepage.
"""
import os
import re
import tempfile
from unittest.mock import patch

_tmpdir = tempfile.mkdtemp(prefix="anisubarr-embylink-test-")
os.environ.setdefault("DATABASE_URL", f"sqlite:///{_tmpdir}/test.db")
os.environ.setdefault("JWT_SECRET", "test-secret-not-for-production")

import pytest  # noqa: E402

from app.services import discord as discord_svc  # noqa: E402
from app.services import emby as emby_svc  # noqa: E402

LIBRARY = [{"Id": "abc123", "Name": "86 EIGHTY-SIX"}]


def _norm(text):
    return re.sub(r"[^0-9a-z]+", " ", (text or "").lower()).strip()


class _Response:
    def __init__(self, items):
        self._items = items

    def raise_for_status(self):
        pass

    def json(self):
        return {"Items": self._items}


def _fake_search(tvdb_id=None, calls=None):
    """Stands in for Emby: matches provider ids exactly and search terms the way
    a real search engine does — ignoring punctuation."""
    def _get(url, params=None, timeout=None):
        params = params or {}
        if calls is not None:
            calls.append(params)
        wanted = params.get("AnyProviderIdEquals")
        if wanted:
            return _Response(LIBRARY if (tvdb_id and wanted == f"tvdb.{tvdb_id}") else [])
        term = _norm(params.get("searchTerm"))
        return _Response([i for i in LIBRARY if term and term in _norm(i["Name"])])
    return _get


class Series:
    """Only the attributes the lookup reads."""
    title = "86: Eighty Six"
    year = 2021
    tvdb_id = tmdb_id = imdb_id = None
    title_romaji = title_english = title_japanese = None
    alternate_titles = None
    emby_id = None


@pytest.fixture(autouse=True)
def _emby_configured():
    emby_svc._server_kind_cache = None
    with patch.object(emby_svc, "_get_config", lambda: ("http://emby.test", "k")):
        yield
    emby_svc._server_kind_cache = None


# ── finding the series ───────────────────────────────────────────────────────

def test_provider_id_finds_it_regardless_of_naming():
    calls = []
    with patch("httpx.get", _fake_search(tvdb_id=386190, calls=calls)):
        series = Series()
        series.tvdb_id = 386190
        assert emby_svc.ensure_emby_id(series) == "abc123"
    assert calls[0]["AnyProviderIdEquals"] == "tvdb.386190", "id se má zkusit první"


def test_punctuation_does_not_prevent_a_match():
    """"86: Eighty Six" vs "86 EIGHTY-SIX" — the same show."""
    with patch("httpx.get", _fake_search()):
        assert emby_svc.ensure_emby_id(Series()) == "abc123"


def test_an_alternate_title_is_tried_too():
    with patch("httpx.get", _fake_search()):
        series = Series()
        series.title = "Eighty Six (2021)"
        series.title_english = "86 Eighty Six"
        assert emby_svc.ensure_emby_id(series) == "abc123"


def test_a_show_that_is_not_in_the_library_stays_unmatched():
    with patch("httpx.get", _fake_search()):
        series = Series()
        series.title = "Nic Takového Neexistuje"
        assert emby_svc.ensure_emby_id(series) is None


def test_an_id_already_known_costs_no_request():
    def _boom(*a, **kw):
        raise AssertionError("Emby se nemá volat, když id už známe")

    with patch("httpx.get", _boom):
        series = Series()
        series.emby_id = "known"
        assert emby_svc.ensure_emby_id(series) == "known"


def test_a_lookup_failure_is_not_fatal():
    def _down(*a, **kw):
        raise OSError("connection refused")

    with patch("httpx.get", _down):
        assert emby_svc.ensure_emby_id(Series()) is None


# ── shaping the link ─────────────────────────────────────────────────────────

def _play_url(emby_id, kind):
    emby_svc._server_kind_cache = kind
    with patch.object(discord_svc, "_get_db_setting",
                      lambda key, db=None: "https://filmy.example.cz"
                      if key == "emby_external_url" else None):
        return discord_svc._emby_play_url(None, emby_id)


def test_emby_and_jellyfin_get_their_own_link_shape():
    assert _play_url("abc123", "emby") == \
        "https://filmy.example.cz/web/index.html#!/item?id=abc123"
    assert _play_url("abc123", "jellyfin") == \
        "https://filmy.example.cz/web/index.html#/details?id=abc123"


def test_without_an_id_the_link_can_only_be_the_homepage():
    assert _play_url(None, "emby") == "https://filmy.example.cz"


def test_no_configured_url_means_no_link_at_all():
    with patch.object(discord_svc, "_get_db_setting", lambda key, db=None: None):
        assert discord_svc._emby_play_url(None, "abc123") is None


def test_the_server_kind_is_probed_once():
    probes = []

    class _Info:
        def raise_for_status(self):
            pass

        def json(self):
            return {"ProductName": "Jellyfin Server"}

    def _get(url, timeout=None, **kw):
        probes.append(url)
        return _Info()

    emby_svc._server_kind_cache = None
    with patch("httpx.get", _get):
        assert emby_svc.server_kind() == "jellyfin"
        assert emby_svc.server_kind() == "jellyfin"
    assert len(probes) == 1, "typ serveru se má zjišťovat jednou, ne u každé zprávy"
