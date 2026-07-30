"""
Ruční složka — the folder searched before anything on the net.

The matching is name-based, so these tests pin down what counts as a match:
a hand-downloaded file can be named half a dozen ways, and a wrong guess would
write someone else's subtitles next to the video.
"""
import os
import tempfile

_tmpdir = tempfile.mkdtemp(prefix="anisubarr-localsubs-test-")
os.environ.setdefault("DATABASE_URL", f"sqlite:///{_tmpdir}/test.db")
os.environ.setdefault("JWT_SECRET", "test-secret-not-for-production")

import pytest  # noqa: E402

from app.services import local_subs  # noqa: E402


@pytest.fixture
def folder():
    """A fresh drop folder; the index cache is cleared so tests don't leak."""
    root = tempfile.mkdtemp(prefix="anisubarr-drop-")
    local_subs.invalidate_cache()
    yield root
    local_subs.invalidate_cache()


def _drop(root: str, rel: str, body: bytes = b"1\n00:00:01,000 --> 00:00:02,000\nahoj\n") -> str:
    path = os.path.join(root, *rel.split("/"))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as fh:
        fh.write(body)
    return path


def _search(root, title, season=1, episode=5, language="cs", **kw):
    return local_subs.LocalFolderScraper(root).search(
        title=title, season=season, episode=episode, language=language, **kw)


# ── episode numbering ────────────────────────────────────────────────────────

@pytest.mark.parametrize("name", [
    "Sousou no Frieren S01E05.srt",
    "Sousou no Frieren.s01.e05.cs.srt",
    "Sousou no Frieren 1x05.srt",
    "[SubsPlease] Sousou no Frieren - 05 (1080p) [ABCD1234].srt",
    "Sousou no Frieren EP05.ass",
    "Sousou no Frieren - 05v2.srt",
])
def test_common_naming_conventions_are_recognised(folder, name):
    _drop(folder, name)
    assert len(_search(folder, "Sousou no Frieren")) == 1, name


@pytest.mark.parametrize("name", [
    # How people really name files, collected by walking through the variants
    # a Czech subtitle download actually produces.
    "Sousou.no.Frieren.S01E05.1080p.CR.WEB-DL.AAC2.0.H.264-VARYG.srt",
    "Sousou-no-Frieren-05.srt",          # dashes with no spaces around them
    "Sousou no Frieren 05 CZ tit.srt",   # bare number in the middle
    "Sousou no Frieren S1E5.srt",        # single digits
    "Frieren - 05 [1080p].srt",          # short alias + junk after it
    "Frieren_S01E05_CZ.srt",
    "Frieren.EP05.CZ.ass",
    "Frieren 1. serie - 05.srt",
    "Frieren S01E05 (CZ titulky).srt",
    "frieren 05.srt",
    "Frieren/S01E05.cz.srt",             # series folder, bare episode file
    "Titulky/Frieren/frieren.s01e05.srt",
])
def test_names_people_actually_use(folder, name):
    """The library calls the show "Sousou no Frieren"; the file may not."""
    _drop(folder, name)
    assert len(_search(folder, "Sousou no Frieren")) == 1, name


@pytest.mark.parametrize("name", [
    "Bocchi the Rock S01E05.srt",      # different show
    "Sousou no Frieren S01E06.srt",    # different episode
    "Sousou no Frieren S02E05.srt",    # different season
    "readme.srt",                      # no episode number at all
    "Frieren S01E05.en.srt",           # different language
])
def test_names_that_must_not_match(folder, name):
    """The looser parsing must not start attributing files by wishful thinking."""
    _drop(folder, name)
    assert _search(folder, "Sousou no Frieren", season=1, episode=5) == [], name


def test_release_tags_are_not_mistaken_for_episode_numbers(folder):
    """"1080p" and the year must not end up being read as the episode."""
    _drop(folder, "Sousou no Frieren S01E05 1080p WEB-DL x265 2023.srt")
    assert len(_search(folder, "Sousou no Frieren", episode=5)) == 1
    assert _search(folder, "Sousou no Frieren", episode=1080) == []


def test_season_comes_from_the_folder_when_the_name_omits_it(folder):
    _drop(folder, "Frieren/Season 02/Frieren - 03.srt")
    assert len(_search(folder, "Frieren", season=2, episode=3)) == 1
    # …and that file is not offered for the same episode number in season 1.
    assert _search(folder, "Frieren", season=1, episode=3) == []


def test_absolute_numbering_matches_a_later_season(folder):
    """Anime files are usually numbered straight through: 25 = S02E13."""
    _drop(folder, "Show - 25.srt")
    assert len(_search(folder, "Show", season=2, episode=13, absolute=25)) == 1


def test_dash_convention_reads_the_last_number_as_the_episode(folder):
    """"Show - 2 - 05" is season 2, episode 5 — not episode 2."""
    _drop(folder, "Show - 2 - 05.srt")
    assert len(_search(folder, "Show", season=1, episode=5)) == 1
    assert _search(folder, "Show", season=1, episode=2) == []


def test_wrong_episode_is_not_offered(folder):
    _drop(folder, "Sousou no Frieren S01E05.srt")
    assert _search(folder, "Sousou no Frieren", episode=6) == []


# ── series matching ──────────────────────────────────────────────────────────

def test_another_show_is_not_matched(folder):
    _drop(folder, "Bocchi the Rock S01E05.srt")
    assert _search(folder, "Sousou no Frieren") == [], "cizí seriál se nesmí spárovat"


def test_series_folder_names_the_show(folder):
    """The file itself says nothing but the folder does — that's the tidy layout."""
    _drop(folder, "Sousou no Frieren/S01E05.srt")
    assert len(_search(folder, "Sousou no Frieren")) == 1


def test_alternate_title_matches(folder):
    """The library knows the show as "Frieren: Beyond Journey's End", the file
    is named in romaji — passing the known titles must bridge that."""
    _drop(folder, "Sousou no Frieren - 05.srt")
    assert _search(folder, "Frieren: Beyond Journey's End") == []
    assert len(_search(folder, "Frieren: Beyond Journey's End",
                       titles=["Frieren: Beyond Journey's End", "Sousou no Frieren"])) == 1


def test_dots_and_underscores_do_not_break_matching(folder):
    _drop(folder, "Sousou.no.Frieren.S01E05.CZ.srt")
    assert len(_search(folder, "Sousou no Frieren")) == 1


# ── language ─────────────────────────────────────────────────────────────────

def test_a_file_tagged_with_another_language_is_skipped(folder):
    _drop(folder, "Frieren S01E05.en.srt")
    assert _search(folder, "Frieren", language="cs") == []
    assert len(_search(folder, "Frieren", language="en")) == 1


def test_slovak_is_not_served_as_czech(folder):
    _drop(folder, "Frieren S01E05.sk.srt")
    assert _search(folder, "Frieren", language="cs") == []


def test_an_untagged_file_is_taken_as_the_requested_language(folder):
    """No tag means the user dropped it for the language being searched — a
    release group in the name must not make it look English."""
    _drop(folder, "[SubsPlease] Frieren - 05 (1080p).srt")
    results = _search(folder, "Frieren", language="cs")
    assert len(results) == 1
    assert results[0]["language"] == "cs"
    assert "jazyk neuveden" in results[0]["notes"]


def test_czech_tag_variants_all_count_as_czech(folder):
    for name in ("A S01E05.cs.srt", "B S01E05.cz.srt", "C S01E05.cze.srt"):
        _drop(folder, name)
    local_subs.invalidate_cache()
    for title in ("A", "B", "C"):
        assert len(_search(folder, title, language="cs")) == 1, title


# ── files we ignore ──────────────────────────────────────────────────────────

def test_non_subtitle_files_are_ignored(folder):
    _drop(folder, "Frieren S01E05.mkv")
    _drop(folder, "Frieren S01E05.txt")
    assert _search(folder, "Frieren") == []


def test_archives_are_offered(folder):
    """extract_subtitle_bytes() unpacks ZIP/RAR, so dropping the archive works."""
    _drop(folder, "Frieren S01E05.zip", b"PK\x03\x04")
    assert len(_search(folder, "Frieren")) == 1


def test_missing_folder_is_not_an_error(folder):
    assert local_subs.LocalFolderScraper(os.path.join(folder, "nope")).search(
        title="Frieren", season=1, episode=5) == []


# ── download ─────────────────────────────────────────────────────────────────

def test_download_returns_the_file(folder):
    _drop(folder, "Frieren S01E05.srt", b"obsah titulku")
    result = _search(folder, "Frieren")[0]
    assert local_subs.LocalFolderScraper(folder).download(result["url"]) == b"obsah titulku"


def test_download_refuses_to_leave_the_folder(folder):
    """The url arrives from the client, so traversal has to be impossible."""
    secret = os.path.join(os.path.dirname(folder), "secret.srt")
    with open(secret, "wb") as fh:
        fh.write(b"tajne")

    scraper = local_subs.LocalFolderScraper(folder)
    for url in ("local://../secret.srt",
                "local://..%2Fsecret.srt",
                f"local://{secret}",
                "local://sub/../../secret.srt"):
        with pytest.raises((ValueError, FileNotFoundError)):
            scraper.download(url)


def test_download_of_a_removed_file_fails_cleanly(folder):
    path = _drop(folder, "Frieren S01E05.srt")
    result = _search(folder, "Frieren")[0]
    os.unlink(path)
    with pytest.raises(FileNotFoundError):
        local_subs.LocalFolderScraper(folder).download(result["url"])


# ── ordering & status ────────────────────────────────────────────────────────

def test_newest_file_wins_between_equally_good_matches(folder):
    old = _drop(folder, "Frieren S01E05.srt")
    new = _drop(folder, "Frieren/Frieren S01E05.srt")
    os.utime(old, (1, 1))
    os.utime(new, (2_000_000_000, 2_000_000_000))
    local_subs.invalidate_cache()
    assert _search(folder, "Frieren")[0]["url"].endswith("Frieren%20S01E05.srt")
    assert len(_search(folder, "Frieren")) == 2


def test_every_title_the_library_knows_is_used_for_matching(folder):
    """series_titles() feeds the matcher, so alternates from AniList/Sonarr must
    end up in it — that's what makes romaji-named files work."""
    class _Series:
        title = "Frieren: Beyond Journey's End"
        title_romaji = "Sousou no Frieren"
        title_english = None
        title_japanese = None
        sort_title = None
        alternate_titles = '[{"title": "Frieren la Slayer"}, "Frieren"]'

    titles = local_subs.series_titles(_Series())
    assert "sousou no frieren" in titles
    assert "frieren la slayer" in titles
    assert "frieren" in titles


def test_folder_status_counts_files_and_languages(folder):
    _drop(folder, "Frieren S01E05.cs.srt")
    _drop(folder, "Frieren S01E06.en.srt")
    _drop(folder, "Frieren S01E07.srt")
    status = local_subs.folder_status()
    # folder_status() reads the configured folder, not ours — check ours directly.
    entries = local_subs.index(folder, refresh=True)
    assert len(entries) == 3
    assert {e.lang for e in entries} == {"cs", "en", None}
    assert status["path"]  # always reports where it looks
