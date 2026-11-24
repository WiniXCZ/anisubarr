"""
Movie scan: what the "Filmy" table shows must come from the file itself.

Covers the parts that decide what the user reads in the table — resolution and
HDR labels, audio channel labels and languages, external subtitles next to the
file — and the check that catches preallocated, never-finished downloads
(blocks of zeros), which Radarr keeps as perfectly fine files.
"""
import os
import tempfile
from unittest.mock import patch

_tmpdir = tempfile.mkdtemp(prefix="anisubarr-moviescan-test-")
os.environ.setdefault("DATABASE_URL", f"sqlite:///{_tmpdir}/test.db")
os.environ.setdefault("JWT_SECRET", "test-secret-not-for-production")

from app.database import SessionLocal, create_all  # noqa: E402
from app.models.movie_file import MovieFile  # noqa: E402
from app.services import movie_scan  # noqa: E402

create_all()

PROBE = {
    "format": {"duration": "8700.7", "format_name": "matroska,webm", "bit_rate": "26000000"},
    "streams": [
        {"codec_type": "video", "codec_name": "hevc", "width": 3832, "height": 1600,
         "color_transfer": "smpte2084", "side_data_list": [{"side_data_type": "DOVI configuration record"}]},
        {"codec_type": "audio", "codec_name": "eac3", "channels": 6, "tags": {"language": "cze", "title": "Česky 5.1"},
         "disposition": {"default": 1}},
        {"codec_type": "audio", "codec_name": "aac", "channels": 2, "tags": {"language": "cze"}},
        {"codec_type": "audio", "codec_name": "truehd", "channels": 8, "profile": "Dolby TrueHD + Dolby Atmos",
         "tags": {"language": "eng"}},
        {"codec_type": "subtitle", "codec_name": "subrip", "tags": {"language": "slo"}, "disposition": {"forced": 1}},
    ],
}


def test_summary_labels():
    s = movie_scan.summarize(PROBE, check_hdr10plus=False)
    assert s["resolution"] == "4K"                 # cinema crop 3832×1600 is still 4K
    assert s["hdr"] == "DV HDR10"
    assert [(a["lang"], a["layout"]) for a in s["audio"]] == [("cs", "5.1"), ("cs", "stereo"), ("en", "7.1")]
    assert s["audio"][2]["atmos"] is True
    assert s["subs"][0]["lang"] == "sk" and s["subs"][0]["forced"] is True
    assert s["bitrate"] == 26000


def test_resolution_and_folder():
    assert movie_scan.resolution_label(1920, 800) == "1080p"
    assert movie_scan.resolution_label(1280, 536) == "720p"
    assert movie_scan.resolution_label(720, 576) == "SD"
    assert movie_scan.parse_folder("Shrek 2 (2004)") == ("Shrek 2", 2004)
    assert movie_scan.parse_folder("Bez roku") == ("Bez roku", None)


def test_external_subs_belong_to_their_version(tmp_path):
    for f in ("Film (2020).mkv", "Film (2020).cs.srt", "Film (2020).en.forced.ass",
              "Film (2020) - 1080p.mkv", "Film (2020) - 1080p.sk.srt", "poster.jpg"):
        (tmp_path / f).write_bytes(b"x")
    subs = movie_scan.external_subs(str(tmp_path / "Film (2020).mkv"))
    assert sorted((s["lang"], s["forced"]) for s in subs) == [("cs", False), ("en", True)]
    assert all(s["external"] for s in subs)


def test_zero_filled_file_is_caught(tmp_path):
    good = tmp_path / "ok.mkv"
    good.write_bytes(os.urandom(4 * 1024 * 1024))
    bad = tmp_path / "zero.mkv"
    bad.write_bytes(os.urandom(1024 * 1024) + bytes(3 * 1024 * 1024))   # header written, rest preallocated
    assert movie_scan.zero_regions(str(good)) == []
    assert movie_scan.zero_regions(str(bad)) == [25, 50, 75, 95]
    status, msg = movie_scan.verify(str(bad), 5000.0)
    assert status == "error" and "vynulovaná" in msg


def test_scan_is_incremental_and_forgets_removed_files(tmp_path):
    root = tmp_path / "movies"
    (root / "A (2001)").mkdir(parents=True)
    (root / "B (2002)").mkdir()
    (root / "A (2001)" / "A (2001).mkv").write_bytes(b"a" * 10)
    (root / "B (2002)" / "B (2002).mkv").write_bytes(b"b" * 10)
    (root / "B (2002)" / "B-trailer.mkv").write_bytes(b"t")
    db = SessionLocal()
    try:
        with patch.object(movie_scan, "roots", return_value=[str(root)]), \
             patch.object(movie_scan, "probe", return_value=PROBE) as pr, \
             patch.object(movie_scan, "_hdr10plus", return_value=False):
            rep = movie_scan.scan(db)
            assert rep["files"] == 2 and rep["new"] == 2 and pr.call_count == 2   # trailer skipped
            rep = movie_scan.scan(db)
            assert rep["probed"] == 0 and pr.call_count == 2                       # nothing changed
            os.remove(root / "B (2002)" / "B (2002).mkv")
            rep = movie_scan.scan(db)
            assert rep["removed"] == 1
        rows = db.query(MovieFile).all()
        assert [(r.title, r.year, r.resolution) for r in rows] == [("A", 2001, "4K")]
    finally:
        db.query(MovieFile).delete()
        db.commit()
        db.close()


def test_unreachable_roots_do_not_wipe_the_table(tmp_path):
    db = SessionLocal()
    try:
        db.add(MovieFile(path="/nikde/X (2000)/X (2000).mkv", root="/nikde", title="X"))
        db.commit()
        with patch.object(movie_scan, "roots", return_value=["/nikde"]):
            rep = movie_scan.scan(db)
        assert rep.get("aborted") and db.query(MovieFile).count() == 1
    finally:
        db.query(MovieFile).delete()
        db.commit()
        db.close()
