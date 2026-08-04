"""
What an episode row shows about subtitles, and why one counts as missing.

Emby happily played a Czech subtitle that Anisubarr's episode list reported as
missing, with no way to tell which of the half-dozen possible causes it was.
Two things come out of that: the row lists the languages it actually found and
where each came from, and a missing one can explain itself.
"""
import os
import tempfile
from unittest.mock import patch

_tmpdir = tempfile.mkdtemp(prefix="anisubarr-epview-test-")
os.environ.setdefault("DATABASE_URL", f"sqlite:///{_tmpdir}/test.db")
os.environ.setdefault("JWT_SECRET", "test-secret-not-for-production")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.database import SessionLocal, create_all  # noqa: E402
from app.models.series import Episode, Series, Subtitle  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services import path_resolver  # noqa: E402
from app.services.auth import hash_password  # noqa: E402
from app.utils import subtitle_languages  # noqa: E402
from app.main import app  # noqa: E402

create_all()
client = TestClient(app)

_USERNAME = "epviewtest"
_PASSWORD = "pw"
_BASE = "Frieren - Beyond Journey's End - S01E01 - The Journey's End"
_next_id = iter(range(5000, 5100))


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


@pytest.fixture
def episode():
    """An episode whose video lives in a real temp folder."""
    n = next(_next_id)
    root = tempfile.mkdtemp(prefix="anisubarr-media-")
    folder = os.path.join(root, "Season 01")
    os.makedirs(folder)
    with open(os.path.join(folder, f"{_BASE}.mkv"), "wb") as fh:
        fh.write(b"video")

    db = SessionLocal()
    series = Series(title=f"View Show {n}", sonarr_id=n)
    db.add(series)
    db.flush()
    ep = Episode(series_id=series.id, sonarr_ep_id=n, season_number=1,
                 episode_number=1, has_file=True,
                 file_path=os.path.join(folder, f"{_BASE}.mkv"))
    db.add(ep)
    db.commit()
    ep_id = ep.id
    try:
        # Paths are already local here — keep the resolver out of the way so the
        # test is about the subtitle logic, not about path mapping.
        with patch.object(path_resolver, "resolve", lambda p: p), \
             patch.object(path_resolver, "unc_to_local", lambda p: p):
            yield ep_id, folder
    finally:
        db.query(Subtitle).filter(Subtitle.episode_id == ep_id).delete()
        db.query(Episode).filter(Episode.id == ep_id).delete()
        db.query(Series).filter(Series.id == series.id).delete()
        db.commit()
        db.close()


def _drop(folder, name, body=b"1\n00:00:01,000 --> 00:00:02,000\nahoj\n"):
    with open(os.path.join(folder, name), "wb") as fh:
        fh.write(body)


def _reload(ep_id):
    db = SessionLocal()
    try:
        return db.query(Episode).filter(Episode.id == ep_id).first(), db
    finally:
        pass


# ── which languages the row lists ────────────────────────────────────────────

def test_a_subtitle_on_disk_is_listed_even_without_a_db_record(episode):
    """The production case: Emby plays it, the database never heard of it."""
    ep_id, folder = episode
    _drop(folder, f"{_BASE}.cs.srt")

    ep, db = _reload(ep_id)
    try:
        langs = subtitle_languages(ep)
    finally:
        db.close()
    assert langs == [{"lang": "cs", "sources": ["disk"]}]


def test_every_source_is_named(episode):
    ep_id, folder = episode
    _drop(folder, f"{_BASE}.ja.srt")

    db = SessionLocal()
    try:
        db.add(Subtitle(episode_id=ep_id, language="cs", source="local",
                        file_path="/x.srt", format="srt"))
        ep = db.query(Episode).filter(Episode.id == ep_id).first()
        ep.subtitles_in_file = "eng"
        db.commit()
        db.refresh(ep)
        langs = {x["lang"]: x["sources"] for x in subtitle_languages(ep)}
    finally:
        db.close()

    assert langs["cs"] == ["db"]
    assert langs["ja"] == ["disk"]
    assert langs["en"] == ["embedded"]


def test_three_and_two_letter_codes_are_one_language(episode):
    """Sonarr says "eng", the sidecar file says "en" — one chip, not two."""
    ep_id, folder = episode
    _drop(folder, f"{_BASE}.en.srt")

    db = SessionLocal()
    try:
        db.query(Episode).filter(Episode.id == ep_id).update({"subtitles_in_file": "eng"})
        db.commit()
        ep = db.query(Episode).filter(Episode.id == ep_id).first()
        langs = subtitle_languages(ep)
    finally:
        db.close()

    assert [x["lang"] for x in langs] == ["en"]
    assert langs[0]["sources"] == ["disk", "embedded"]


def test_czech_spellings_collapse_into_one_chip(episode):
    ep_id, folder = episode
    _drop(folder, f"{_BASE}.cze.srt")

    db = SessionLocal()
    try:
        db.add(Subtitle(episode_id=ep_id, language="cz", source="hns",
                        file_path="/x.srt", format="srt"))
        db.commit()
        ep = db.query(Episode).filter(Episode.id == ep_id).first()
        langs = subtitle_languages(ep)
    finally:
        db.close()

    assert [x["lang"] for x in langs] == ["cs"]
    assert langs[0]["sources"] == ["db", "disk"]


def test_czech_comes_first(episode):
    ep_id, folder = episode
    for name in (f"{_BASE}.en.srt", f"{_BASE}.ja.srt", f"{_BASE}.cs.srt"):
        _drop(folder, name)

    ep, db = _reload(ep_id)
    try:
        assert [x["lang"] for x in subtitle_languages(ep)][0] == "cs"
    finally:
        db.close()


def test_a_file_belonging_to_another_episode_is_not_counted(episode):
    ep_id, folder = episode
    _drop(folder, "Frieren - Beyond Journey's End - S01E02 - Whatever.cs.srt")

    ep, db = _reload(ep_id)
    try:
        assert subtitle_languages(ep) == []
    finally:
        db.close()


# ── why is it missing ────────────────────────────────────────────────────────

def test_diagnose_finds_the_subtitle(episode, auth):
    ep_id, folder = episode
    _drop(folder, f"{_BASE}.cs.srt")

    body = client.get(f"/api/subtitles/diagnose/{ep_id}", headers=auth).json()
    assert body["verdict"] == "titulky nalezeny"
    assert body["folder_exists"] and body["folder_readable"]
    assert [x["lang"] for x in body["languages"]] == ["cs"]


def test_diagnose_points_at_the_path_mapping(episode, auth):
    """The most common cause: the folder Sonarr names isn't reachable here."""
    ep_id, _ = episode
    db = SessionLocal()
    try:
        db.query(Episode).filter(Episode.id == ep_id).update(
            {"file_path": "/data/nowhere/Show S01E01.mkv"})
        db.commit()
    finally:
        db.close()

    body = client.get(f"/api/subtitles/diagnose/{ep_id}", headers=auth).json()
    assert "mapování cest" in body["verdict"]
    assert body["folder_exists"] is False


def test_diagnose_works_out_the_right_path_mapping(episode, auth):
    """"Wrong mapping" alone is a puzzle; the file's real location is the answer."""
    ep_id, folder = episode
    _drop(folder, f"{_BASE}.cs.srt")
    real_video = os.path.join(folder, f"{_BASE}.mkv")

    db = SessionLocal()
    try:
        # Sonarr's own view of the same file, with a prefix that means nothing here.
        db.query(Episode).filter(Episode.id == ep_id).update(
            {"file_path": f"/data/media/anime_series/Show/Season 01/{_BASE}.mkv"})
        db.commit()
    finally:
        db.close()

    # The mount is the folder *above* the season — matching on the file name
    # alone is deliberately not enough, since the prefix it implies would only
    # ever fit that one episode.
    root = os.path.dirname(folder)
    with patch.object(path_resolver, "_SEARCH_ROOTS", (root,)), \
         patch.object(path_resolver, "_cfg_value", lambda key, default="": ""):
        body = client.get(f"/api/subtitles/diagnose/{ep_id}", headers=auth).json()

    fix = body["suggestion"]
    assert fix["found_path"] == real_video
    assert fix["local_prefix"] == root
    assert fix["sonarr_prefix"] == "/data/media/anime_series/Show"


def test_no_mapping_is_suggested_when_the_file_is_nowhere(episode, auth):
    """A guess would be worse than saying nothing."""
    ep_id, folder = episode
    db = SessionLocal()
    try:
        db.query(Episode).filter(Episode.id == ep_id).update(
            {"file_path": "/data/nic/takoveho/neexistuje.mkv"})
        db.commit()
    finally:
        db.close()

    with patch.object(path_resolver, "_SEARCH_ROOTS", (os.path.dirname(folder),)), \
         patch.object(path_resolver, "_cfg_value", lambda key, default="": ""):
        body = client.get(f"/api/subtitles/diagnose/{ep_id}", headers=auth).json()
    assert body["suggestion"] is None


def test_diagnose_reports_a_subtitle_named_after_another_release(episode, auth):
    ep_id, folder = episode
    _drop(folder, "[SubsPlease] Frieren - 01.cs.srt")

    body = client.get(f"/api/subtitles/diagnose/{ep_id}", headers=auth).json()
    assert "žádný nesedí na název videa" in body["verdict"]
    assert body["files_in_folder"] == ["[SubsPlease] Frieren - 01.cs.srt"]


def test_diagnose_says_when_there_is_simply_nothing(episode, auth):
    ep_id, _ = episode
    body = client.get(f"/api/subtitles/diagnose/{ep_id}", headers=auth).json()
    assert body["verdict"] == "u videa žádný titulkový soubor není"
    assert body["video_present"] is True
