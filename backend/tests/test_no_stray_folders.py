"""
Anisubarr never creates a folder to write into.

Every file it writes belongs next to a video Sonarr already put on the disk.
When the folder isn't there, the path mapping is pointing somewhere else — and
``makedirs`` turned that into an empty replica of Sonarr's tree growing on the
share, one directory per download, while the subtitles inside were invisible to
Emby and to Anisubarr's own scan. The mistake has to surface, not be papered
over, so a missing folder is an error with the mapping named in it.
"""
import os
import tempfile
from types import SimpleNamespace
from unittest.mock import patch

_tmpdir = tempfile.mkdtemp(prefix="anisubarr-stray-test-")
os.environ.setdefault("DATABASE_URL", f"sqlite:///{_tmpdir}/test.db")
os.environ.setdefault("JWT_SECRET", "test-secret-not-for-production")

import pytest  # noqa: E402
from fastapi import HTTPException  # noqa: E402

from app.routers.subtitles import _save_subtitle  # noqa: E402
from app.services import local_subs, nfo, path_resolver  # noqa: E402

_SRT = b"1\n00:00:01,000 --> 00:00:02,000\nahoj\n"


@pytest.fixture
def folder():
    return tempfile.mkdtemp(prefix="anisubarr-real-")


@pytest.fixture
def manual_folder():
    """The manual folder, wherever the test wants it."""
    root = tempfile.mkdtemp(prefix="anisubarr-manual-")
    with patch.object(local_subs, "folder_path", lambda db=None: root):
        yield root


def _episode(file_path=None, series_path=None):
    return SimpleNamespace(
        file_path=file_path, season_number=1, episode_number=5,
        series=SimpleNamespace(title="Frieren", path=series_path),
    )


# ── subtitles ────────────────────────────────────────────────────────────────

def test_a_subtitle_lands_next_to_the_video(folder):
    dest = os.path.join(folder, "Show.S01E01.cs.srt")
    path_resolver.write_subtitle(dest, b"1\n00:00:01,000 --> 00:00:02,000\nahoj\n")
    assert open(dest, "rb").read().startswith(b"1\n")


def test_a_missing_folder_is_refused(folder):
    missing = os.path.join(folder, "media", "anime_series", "Show", "Season 01")
    with pytest.raises(path_resolver.TargetFolderMissing):
        path_resolver.write_subtitle(os.path.join(missing, "x.cs.srt"), b"data")


def test_nothing_is_created_on_the_way(folder):
    """The whole point: the share must look exactly as it did before."""
    before = os.listdir(folder)
    with pytest.raises(path_resolver.TargetFolderMissing):
        path_resolver.write_subtitle(
            os.path.join(folder, "data", "media", "Show", "Season 01", "x.cs.srt"), b"data")
    assert os.listdir(folder) == before


def test_the_error_names_the_folder_and_the_setting(folder):
    """"Write failed" sends people to file permissions; this is a mapping bug."""
    missing = os.path.join(folder, "nekde")
    with pytest.raises(path_resolver.TargetFolderMissing) as exc:
        path_resolver.write_subtitle(os.path.join(missing, "x.cs.srt"), b"data")
    assert missing in str(exc.value)
    assert "mapování cest" in str(exc.value)


def test_an_existing_subtitle_is_replaced(folder):
    dest = os.path.join(folder, "Show.S01E01.cs.srt")
    path_resolver.write_subtitle(dest, b"stare")
    path_resolver.write_subtitle(dest, b"nove")
    assert open(dest, "rb").read() == b"nove"


# ── NFO ──────────────────────────────────────────────────────────────────────

def test_an_nfo_does_not_conjure_a_series_folder(folder):
    """Sonarr owns the series folder; writing metadata must not invent one."""
    missing = os.path.join(folder, "Show (2023)")
    with pytest.raises(path_resolver.TargetFolderMissing):
        nfo._write(os.path.join(missing, "tvshow.nfo"), "<tvshow/>")
    assert not os.path.exists(missing)


def test_an_nfo_is_written_when_the_folder_is_real(folder):
    nfo._write(os.path.join(folder, "tvshow.nfo"), "<tvshow/>")
    assert open(os.path.join(folder, "tvshow.nfo")).read() == "<tvshow/>"


# ── where a download ends up ─────────────────────────────────────────────────

def test_a_download_goes_next_to_the_video(folder, manual_folder):
    video = os.path.join(folder, "Frieren - S01E05.mkv")
    open(video, "wb").close()

    dest = _save_subtitle(_episode(file_path=video), _SRT, "cs", "srt")
    assert dest == os.path.join(folder, "Frieren - S01E05.cs.srt")
    assert os.listdir(manual_folder) == []


def test_a_download_into_a_folder_that_is_not_there_fails_loudly(folder, manual_folder):
    """Silently writing elsewhere is what hid the broken mapping for weeks."""
    ep = _episode(file_path=os.path.join(folder, "chybi", "Frieren - S01E05.mkv"))

    with pytest.raises(HTTPException) as exc:
        _save_subtitle(ep, _SRT, "cs", "srt")
    assert exc.value.status_code == 409
    assert "mapování cest" in exc.value.detail
    assert not os.path.exists(os.path.join(folder, "chybi"))


def test_an_episode_without_a_video_is_parked_in_the_manual_folder(manual_folder):
    """A temp directory the container throws away was the same bug in reverse:
    the file existed, but nowhere anyone — including Anisubarr — would look."""
    dest = _save_subtitle(_episode(), _SRT, "cs", "srt")

    assert os.path.dirname(dest) == manual_folder
    assert open(dest, "rb").read() == _SRT


def test_a_parked_file_is_named_so_the_local_provider_finds_it(manual_folder):
    dest = _save_subtitle(_episode(), _SRT, "cs", "srt")

    title, season, episode = local_subs.parse_name(os.path.basename(dest), ())
    assert (season, episode) == (1, 5)
    assert "frieren" in title.lower()


def test_the_season_folder_wins_when_sonarr_already_made_it(folder, manual_folder):
    """Sonarr creates the folder before the import finishes; a subtitle that
    can go where it belongs should not be parked."""
    season = os.path.join(folder, "Season 01")
    os.makedirs(season)

    dest = _save_subtitle(_episode(series_path=folder), _SRT, "cs", "srt")
    assert os.path.dirname(dest) == season
    assert os.listdir(manual_folder) == []


def test_a_series_folder_that_is_not_there_is_not_created(folder, manual_folder):
    ep = _episode(series_path=os.path.join(folder, "Frieren (2023)"))

    dest = _save_subtitle(ep, _SRT, "cs", "srt")
    assert os.path.dirname(dest) == manual_folder
    assert os.listdir(folder) == []
