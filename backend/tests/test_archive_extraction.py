"""
Unpacking what a provider actually serves.

Kamui moved from RAR to ZIP and kept its site-wide password. The ZIP branch
could not open an encrypted archive, so the download matched no branch at all
and the raw archive was written to disk under a .ass name: every download
reported success and no player could read one of them.
"""
import io
import zipfile

import pytest

from app.services.subtitle_utils import (
    extract_subtitle_bytes, extract_zip_subtitle,
)

_ASS = b"[Script Info]\nTitle: Chainsaw Man\n\n[Events]\nDialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,Ahoj\n"
_PASSWORD = "kamui"


def _plain_zip(name: str = "titulky.ass", data: bytes = _ASS) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr(name, data)
    return buf.getvalue()


def _aes_zip(name: str = "titulky.ass", data: bytes = _ASS,
             password: str = _PASSWORD) -> bytes:
    pyzipper = pytest.importorskip("pyzipper")
    buf = io.BytesIO()
    with pyzipper.AESZipFile(buf, "w", compression=pyzipper.ZIP_DEFLATED,
                             encryption=pyzipper.WZ_AES) as zf:
        zf.setpassword(password.encode())
        zf.writestr(name, data)
    return buf.getvalue()


def test_a_plain_zip_needs_no_password():
    data, ext = extract_zip_subtitle(_plain_zip())
    assert data == _ASS and ext == "ass"


def test_an_encrypted_zip_opens_with_the_site_password():
    """The archive Kamui serves today. Without this the bytes landed on disk
    as a .ass file that was really an encrypted archive."""
    data, ext = extract_zip_subtitle(_aes_zip(), _PASSWORD)
    assert data == _ASS and ext == "ass"


def test_the_wrong_password_is_refused_not_returned_as_subtitle():
    with pytest.raises(ValueError):
        extract_zip_subtitle(_aes_zip(), "spatne-heslo")


def test_a_missing_password_says_which_setting_is_empty():
    with pytest.raises(ValueError, match="kamui_rar_password"):
        extract_zip_subtitle(_aes_zip())


def test_an_archive_without_subtitles_is_refused():
    with pytest.raises(ValueError, match="SRT/ASS"):
        extract_zip_subtitle(_plain_zip("readme.txt", b"nic"))


def test_a_corrupt_archive_says_so():
    with pytest.raises(ValueError, match="[Pp]oškozený"):
        extract_zip_subtitle(b"PK\x03\x04 tohle rozhodne ne")


def test_the_macos_resource_fork_is_not_mistaken_for_the_subtitle():
    """A ZIP made on a Mac carries ._name beside name — a few hundred bytes
    of metadata that is not a subtitle."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("__MACOSX/._titulky.ass", b"\x00\x05\x16\x07nesmysl")
        zf.writestr("titulky.ass", _ASS)
    data, _ = extract_zip_subtitle(buf.getvalue())
    assert data == _ASS


def test_ass_wins_over_srt_when_the_archive_holds_both():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("a-titulky.srt", b"1\n00:00:01,000 --> 00:00:03,000\nAhoj\n")
        zf.writestr("z-titulky.ass", _ASS)
    data, ext = extract_zip_subtitle(buf.getvalue())
    assert ext == "ass" and data == _ASS


def test_the_generic_entry_point_passes_the_password_through():
    """Everything else in the app calls extract_subtitle_bytes()."""
    data, ext = extract_subtitle_bytes(_aes_zip(), _PASSWORD)
    assert data == _ASS and ext == "ass"


def test_plain_text_still_comes_back_untouched():
    data, ext = extract_subtitle_bytes(_ASS)
    assert data == _ASS and ext == "ass"
