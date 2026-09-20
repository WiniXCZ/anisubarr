"""
Findings from a scan of the running instance, each pinned by a test.

The numbers came from production: 11 184 hiyori rows for a provider switched
off, 43 MB of 82 MB spent on nightly "found nothing", 1640 identical warnings
in 90 seconds, and a login that reported success while every search that
followed ran anonymously.
"""
import os
import tempfile
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

_tmpdir = tempfile.mkdtemp(prefix="anisubarr-prod-test-")
os.environ.setdefault("DATABASE_URL", f"sqlite:///{_tmpdir}/test.db")
os.environ.setdefault("JWT_SECRET", "test-secret-not-for-production")

import pytest  # noqa: E402

from app.database import SessionLocal, create_all  # noqa: E402
from app.models.audit_log import SeriesAuditLog  # noqa: E402
from app.models.series import Series  # noqa: E402
from app.models.service import Service  # noqa: E402

create_all()


# ── a provider switched off is not talked to ─────────────────────────────────

# The suite shares one SQLite file, so every module has to clean up after
# itself and stay out of the id ranges the others use.
_ID_BASE = 990_000
_next_id = iter(range(_ID_BASE, _ID_BASE + 500))


@pytest.fixture
def db():
    session = SessionLocal()
    mine: list[int] = []
    try:
        yield session, mine
    finally:
        session.rollback()
        if mine:
            session.query(SeriesAuditLog).filter(
                SeriesAuditLog.series_id.in_(mine)).delete(synchronize_session=False)
            session.query(Series).filter(Series.id.in_(mine)).delete(synchronize_session=False)
        session.query(Service).filter(Service.name == "Hiyori (test)").delete()
        session.commit()
        session.close()


def _series(bundle):
    session, mine = bundle
    s = Series(title="Test Show", sonarr_id=next(_next_id))
    session.add(s)
    session.commit()
    mine.append(s.id)
    return s


def test_the_audit_leaves_hiyori_alone_when_it_is_switched_off(db):
    """The audit asks hiyori "is this planned or revived" for its own reasons
    and built its scraper straight from the credentials, so the switch that
    turns hiyori off as a subtitle source never reached it — leaving it calling
    the one provider whose rate limits already cost an account."""
    from app.services import audit

    session, _ = db
    session.add(Service(name="Hiyori (test)", type="hiyori", enabled=False))
    session.commit()

    assert audit._hiyori_check_due(_series(db), session) is False


def test_an_enabled_hiyori_is_still_checked(db):
    from app.services import audit

    session, _ = db
    session.add(Service(name="Hiyori (test)", type="hiyori", enabled=True))
    session.commit()

    assert audit._hiyori_check_due(_series(db), session) is True


def test_no_registry_row_keeps_the_old_behaviour(db):
    """An install that predates the registry must not go quiet."""
    from app.services import audit

    session, _ = db
    assert audit._hiyori_check_due(_series(db), session) is True


# ── the audit log stops growing forever ──────────────────────────────────────

def test_pruning_drops_old_rows_and_frees_the_detail_of_recent_ones(db):
    """575 rows a day with no retention, most of them a nightly "found nothing"
    carrying 1.8 kB of per-episode detail, grew to half the database — and
    every backup copied the weight again."""
    from app.services.scheduler import job_prune_audit_log

    session, _ = db
    s = _series(db)
    now = datetime.now(timezone.utc)
    rows = [
        ("ancient", now - timedelta(days=200), "subtitle_search", "{}"),
        ("stale-detail", now - timedelta(days=30), "subtitle_search", "{}"),
        ("recent", now - timedelta(days=1), "subtitle_search", "{}"),
        ("state", now - timedelta(days=30), "state_change", None),
    ]
    for message, when, kind, detail in rows:
        session.add(SeriesAuditLog(series_id=s.id, event_type=kind,
                                   message=message, detail=detail, created_at=when))
    session.commit()

    job_prune_audit_log()
    session.expire_all()

    left = {r.message: r for r in
            session.query(SeriesAuditLog).filter(SeriesAuditLog.series_id == s.id).all()}
    assert "ancient" not in left, "řádek za hranicí uchování měl zmizet"
    assert left["stale-detail"].detail is None, "objemný detail měl být zahozen"
    assert left["recent"].detail == "{}", "čerstvý detail se má nechat"
    assert "state" in left, "změna stavu není hledání — nemá se zahazovat"


# ── a login that failed is not a login that worked ───────────────────────────

def _kamui_with(login_html, response_html, response_url):
    from app.services.kamui import KamuiScraper

    scraper = KamuiScraper("uzivatel", "heslo")
    client = MagicMock()
    posted = {}

    get_resp = MagicMock(text=login_html, url="https://kamui-subs.cz/login/")
    get_resp.raise_for_status = lambda: None

    def _post(self, _c, url, data=None, **kw):
        posted["url"] = url
        r = MagicMock(text=response_html, url=response_url)
        r.raise_for_status = lambda: None
        return r

    return scraper, client, posted, get_resp, _post


_FORM = ('<form action="" method="post">'
         '<input name="user_login"><input name="user_password" type="password">'
         '</form>')


def test_an_empty_form_action_posts_back_to_the_login_page():
    """action="" means "post to this same page". `.get(key, default)` only falls
    back when the attribute is absent, so an empty one came through as "" and
    urljoin turned it into the site root — where the login is never handled."""
    from app.services import kamui as kamui_mod

    scraper, client, posted, get_resp, post = _kamui_with(
        _FORM, "<a>Odhlásit</a>", "https://kamui-subs.cz/")

    with patch.object(kamui_mod.KamuiScraper, "_make_client",
                      lambda self: MagicMock(__enter__=lambda s: client,
                                             __exit__=lambda *a: None)), \
         patch.object(kamui_mod.KamuiScraper, "_get", lambda self, c, url, **kw: get_resp), \
         patch.object(kamui_mod.KamuiScraper, "_post", post), \
         patch.object(kamui_mod.time, "sleep", lambda *_: None):
        scraper._login_impl()

    assert posted["url"] != "https://kamui-subs.cz"
    assert "login" in posted["url"]


def test_a_rejected_login_is_not_reported_as_success():
    """It used to fall through to the success log whenever the response URL
    mentioned neither "login" nor "prihlaseni" — so a rejected login was
    recorded as OK and every later search ran anonymously and found nothing."""
    from app.services import kamui as kamui_mod

    scraper, client, posted, get_resp, post = _kamui_with(
        _FORM, "<p>invalid_nonce</p>", "https://kamui-subs.cz/")

    with patch.object(kamui_mod.KamuiScraper, "_make_client",
                      lambda self: MagicMock(__enter__=lambda s: client,
                                             __exit__=lambda *a: None)), \
         patch.object(kamui_mod.KamuiScraper, "_get", lambda self, c, url, **kw: get_resp), \
         patch.object(kamui_mod.KamuiScraper, "_post", post), \
         patch.object(kamui_mod.time, "sleep", lambda *_: None):
        with pytest.raises(PermissionError):
            scraper._login_impl()


# ── the healthcheck stops eating the log ─────────────────────────────────────

def test_the_healthcheck_is_kept_out_of_the_log():
    """Every 30 s, so 3000 lines covered barely seven hours: anything that broke
    overnight left no trace by morning."""
    import logging
    from app.main import _DropHealthChecks

    drop = _DropHealthChecks()

    def line(message):
        return logging.LogRecord("uvicorn.access", logging.INFO, "", 0, message, (), None)

    assert drop.filter(line('GET /api/health HTTP/1.1" 200')) is False
    assert drop.filter(line('GET /api/series HTTP/1.1" 200')) is True


# ── HnS carried the same login bug as Kamui ──────────────────────────────────

def _hns_login(form_html, response_html, response_url):
    from app.services import hns as hns_mod

    scraper = hns_mod.HnsScraper("uzivatel", "heslo")
    client = MagicMock()
    posted = {}

    get_resp = MagicMock(text=form_html, url=hns_mod.LOGIN_URL)
    get_resp.raise_for_status = lambda: None

    def _post(self, _c, url, data=None, **kw):
        posted["url"] = url
        r = MagicMock(text=response_html, url=response_url)
        r.raise_for_status = lambda: None
        return r

    with patch.object(hns_mod.HnsScraper, "_make_client",
                      lambda self: MagicMock(__enter__=lambda s: client,
                                             __exit__=lambda *a: None)), \
         patch.object(hns_mod.HnsScraper, "_get", lambda self, c, url, **kw: get_resp), \
         patch.object(hns_mod.HnsScraper, "_post", _post), \
         patch.object(hns_mod.time, "sleep", lambda *_: None):
        scraper._login_impl()
    return posted


_HNS_FORM = ('<form action="" method="post">'
             '<input name="username"><input name="password" type="password">'
             '</form>')


def test_hns_posts_the_login_to_the_login_page():
    """BASE_URL + "" is the site root, and BASE_URL + "login/" would have been
    glued into "https://hns.sklogin/"."""
    posted = _hns_login(_HNS_FORM, "<a>Odhlásiť</a>", "https://hns.sk/")
    assert "login" in posted["url"], posted["url"]


def test_hns_does_not_call_a_redirect_to_an_error_page_a_success():
    """The failure check only ran while the response was still on the login
    page, so a redirect anywhere else fell through to "přihlášení OK"."""
    with pytest.raises(PermissionError):
        _hns_login(_HNS_FORM, "<p>Nesprávne heslo</p>", "https://hns.sk/chyba")


# ── one answer to "is this provider on" ──────────────────────────────────────

def test_the_scraper_factory_and_the_audit_agree_a_disabled_provider_is_off(db):
    """The check used to exist twice — once for the scrapers, once in the audit
    — which is how a provider switched off in the UI kept being called."""
    from app.routers.subtitles import _provider_enabled
    from app.services import audit

    session, _ = db
    session.add(Service(name="Hiyori (test)", type="hiyori", enabled=False))
    session.commit()

    assert _provider_enabled("hiyori", session) is False
    assert audit._hiyori_check_due(_series(db), session) is False


# ── WordPress sets the same cookie twice ─────────────────────────────────────

def test_a_duplicated_session_cookie_does_not_break_the_login():
    """WordPress hands out its session cookie for both "/" and "/wp-admin/",
    and dict(client.cookies) raises CookieConflict on that — so the scraper
    fell over on the line right after a login that had just succeeded. It could
    not show up until the login started working."""
    import httpx
    from app.services.kamui import _cookie_values

    client = httpx.Client()
    client.cookies.set("wordpress_sec_abc", "prvni", domain="kamui-subs.cz", path="/")
    client.cookies.set("wordpress_sec_abc", "druha", domain="kamui-subs.cz", path="/wp-admin/")

    with pytest.raises(Exception):
        dict(client.cookies)          # the shape that broke

    assert _cookie_values(client) == {"wordpress_sec_abc": "druha"}


def test_kamui_stores_cookies_the_way_the_other_scrapers_do():
    """hns.py and hiyori.py already read the jar; kamui was the odd one out."""
    from pathlib import Path

    source = Path("app/services/kamui.py").read_text(encoding="utf-8")
    assert "dict(c.cookies)" not in source


# ── a switch that says off must not read as on ───────────────────────────────

def test_an_unreadable_registry_counts_as_switched_off():
    """Fail-open on a kill switch means a database hiccup re-enables the one
    provider whose rate limits already cost an account."""
    from app.services.connections import provider_enabled

    broken = MagicMock()
    broken.query.side_effect = RuntimeError("databáze nedostupná")

    assert provider_enabled(broken, "hiyori") is False


# ── a subtitle path from Sonarr's namespace still resolves ───────────────────

def test_a_stored_sonarr_path_is_resolved_before_the_file_is_touched(tmp_path):
    """_unc_to_local is a Windows-only helper: on Linux it hands the path back
    unchanged, so a row holding /data/media/... was looked for under a prefix
    this container never mounts — 410 subtitles that are on the disk read as
    missing."""
    from types import SimpleNamespace
    from app.routers.subtitles import _subtitle_local_path
    from app.services import path_resolver

    real = tmp_path / "Show - S01E01.cs.srt"
    real.write_text("titulek")

    sub = SimpleNamespace(file_path="/data/media/anime/Show - S01E01.cs.srt")
    with patch.object(path_resolver, "_cfg_value",
                      lambda key, default="": {
                          "path_mappings": f'[{{"from": "/data/media/anime", "to": "{tmp_path}"}}]'
                      }.get(key, "")):
        assert _subtitle_local_path(sub) == str(real)
