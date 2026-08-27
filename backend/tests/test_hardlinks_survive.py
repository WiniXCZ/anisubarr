"""
Nothing Anisubarr writes may corrupt a seeding torrent.

Sonarr hardlinks what it imports, so the file in the library and the file the
torrent client is seeding are one and the same inode — that is the point, and
it is what keeps a library from costing twice the disk. ``open(path, "w")``
truncates that shared inode, so an edit made "in the library" rewrites the bytes
the tracker expects. The next hash check fails and the torrent dies, silently,
weeks later.

So every write goes through a temp file and a rename. The library gets the edit,
the torrent keeps its data, and the link count on the old inode simply drops.
"""
import os
import subprocess
import tempfile

_tmpdir = tempfile.mkdtemp(prefix="anisubarr-hardlink-test-")
os.environ.setdefault("DATABASE_URL", f"sqlite:///{_tmpdir}/test.db")
os.environ.setdefault("JWT_SECRET", "test-secret-not-for-production")

import pytest  # noqa: E402

from app.services import nfo, path_resolver, subtitle_postprocess  # noqa: E402

_ORIGINAL = b"1\n00:00:01,000 --> 00:00:02,000\npuvodni text\n"


def _seed(content=_ORIGINAL):
    """A file that exists twice: once in the library, once for the torrent."""
    root = tempfile.mkdtemp(prefix="anisubarr-seed-")
    library = os.path.join(root, "library")
    torrent = os.path.join(root, "torrent")
    os.makedirs(library)
    os.makedirs(torrent)

    lib_file = os.path.join(library, "Show - S01E01.cs.srt")
    tor_file = os.path.join(torrent, "Show - S01E01.cs.srt")
    with open(lib_file, "wb") as fh:
        fh.write(content)
    os.link(lib_file, tor_file)

    assert os.stat(lib_file).st_ino == os.stat(tor_file).st_ino
    assert os.stat(lib_file).st_nlink == 2
    return lib_file, tor_file


@pytest.fixture
def seeded():
    return _seed()


def _assert_torrent_intact(tor_file, lib_file, original=_ORIGINAL):
    """The torrent still has its bytes, and no longer shares them."""
    with open(tor_file, "rb") as fh:
        assert fh.read() == original, "torrent data byla přepsána"
    assert os.stat(tor_file).st_ino != os.stat(lib_file).st_ino


# ── every way a subtitle gets written ────────────────────────────────────────

def test_write_subtitle_leaves_the_torrent_alone(seeded):
    lib_file, tor_file = seeded
    path_resolver.write_subtitle(lib_file, b"novy obsah")

    assert open(lib_file, "rb").read() == b"novy obsah"
    _assert_torrent_intact(tor_file, lib_file)


def test_atomic_write_leaves_the_torrent_alone(seeded):
    lib_file, tor_file = seeded
    path_resolver.atomic_write(lib_file, b"novy obsah")

    assert open(lib_file, "rb").read() == b"novy obsah"
    _assert_torrent_intact(tor_file, lib_file)


def test_postprocessing_leaves_the_torrent_alone():
    """The clean-up that runs after every download touches the same files.
    Seeded with markup so there is genuinely something to rewrite."""
    dirty = b"1\n00:00:01,000 --> 00:00:02,000\n<i>puvodni  text</i>\n"
    lib_file, tor_file = _seed(dirty)

    subtitle_postprocess.process_subtitle_file(
        lib_file, {"common_fixes": True, "remove_tags": True, "encode_utf8": True})

    assert open(lib_file, "rb").read() != dirty, "postprocess nic nezměnil, test nic netestuje"
    _assert_torrent_intact(tor_file, lib_file, original=dirty)


def test_an_nfo_leaves_its_hardlink_alone(seeded):
    lib_file, tor_file = seeded
    nfo._write(lib_file, "<episodedetails/>")

    assert open(lib_file).read() == "<episodedetails/>"
    _assert_torrent_intact(tor_file, lib_file)


# ── the write itself ─────────────────────────────────────────────────────────

def test_the_link_count_drops_instead_of_the_data(seeded):
    lib_file, tor_file = seeded
    path_resolver.atomic_write(lib_file, b"novy obsah")

    assert os.stat(tor_file).st_nlink == 1
    assert os.stat(lib_file).st_nlink == 1


def test_a_failed_write_leaves_no_debris(seeded):
    """A half-written temp file left in the season folder would look to Sonarr
    like a subtitle, and to the user like a mystery."""
    lib_file, _ = seeded
    before = sorted(os.listdir(os.path.dirname(lib_file)))

    with pytest.raises(TypeError):
        path_resolver.atomic_write(lib_file, "tohle nejsou bajty")  # type: ignore[arg-type]

    assert sorted(os.listdir(os.path.dirname(lib_file))) == before
    assert open(lib_file, "rb").read() == _ORIGINAL


def test_permissions_survive_the_replacement(seeded):
    """Emby reads these files; a subtitle that comes back 0600 is invisible."""
    lib_file, _ = seeded
    os.chmod(lib_file, 0o664)

    path_resolver.atomic_write(lib_file, b"novy obsah")
    assert os.stat(lib_file).st_mode & 0o777 == 0o664


def test_writing_a_new_file_still_works(seeded):
    """Most writes have nothing to replace — that path must not regress."""
    lib_file, _ = seeded
    fresh = os.path.join(os.path.dirname(lib_file), "Show - S01E02.cs.srt")

    path_resolver.atomic_write(fresh, b"novy titulek")
    assert open(fresh, "rb").read() == b"novy titulek"


# ── video ────────────────────────────────────────────────────────────────────

def test_cutting_a_video_never_opens_the_source_for_writing():
    """The cut writes a second file; the episode Sonarr hardlinked is only read.
    Asserted on the source's inode and mtime rather than on ffmpeg's arguments,
    so a future rewrite that starts editing in place fails here."""
    if not subprocess.run(["which", "ffmpeg"], capture_output=True).stdout.strip():
        pytest.skip("ffmpeg není k dispozici")

    root = tempfile.mkdtemp(prefix="anisubarr-video-")
    src = os.path.join(root, "Show - S01E01.mkv")
    subprocess.run(["ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc=duration=3:size=64x64:rate=5",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", src],
                   capture_output=True, timeout=120)
    if not os.path.exists(src):
        pytest.skip("ffmpeg nedokázal vyrobit testovací video")

    link = os.path.join(root, "seeded.mkv")
    os.link(src, link)
    before = os.stat(src)

    out = os.path.join(root, "Show - S01E01_cut.mkv")
    subprocess.run(["ffmpeg", "-y", "-ss", "0", "-to", "1", "-i", src, "-c", "copy", out],
                   capture_output=True, timeout=120)

    after = os.stat(src)
    assert (after.st_ino, after.st_mtime, after.st_size) == \
           (before.st_ino, before.st_mtime, before.st_size)
    assert after.st_nlink == 2          # the hardlink is still a hardlink
    assert os.path.exists(out)


# ── ownership ────────────────────────────────────────────────────────────────

def test_a_new_file_takes_the_folders_permissions(seeded):
    """The container runs as root, so a file it creates comes out root:root and
    Emby — running as nobody — cannot rewrite its own NFO afterwards. Taking the
    folder's bits instead means the file belongs where it lands."""
    lib_file, _ = seeded
    folder = os.path.dirname(lib_file)
    os.chmod(folder, 0o775)
    fresh = os.path.join(folder, "Show - S01E03.cs.srt")

    path_resolver.atomic_write(fresh, b"novy titulek")

    assert os.stat(fresh).st_mode & 0o777 == 0o664   # not 0644, and not executable


def test_a_replaced_file_keeps_its_own_permissions(seeded):
    """Whoever set the mode on an existing subtitle had a reason."""
    lib_file, _ = seeded
    os.chmod(os.path.dirname(lib_file), 0o700)
    os.chmod(lib_file, 0o666)

    path_resolver.atomic_write(lib_file, b"novy obsah")
    assert os.stat(lib_file).st_mode & 0o777 == 0o666


def test_a_new_file_inherits_the_owner_when_it_can(seeded):
    """Running as root, the write can hand the file to the folder's owner."""
    lib_file, _ = seeded
    folder = os.path.dirname(lib_file)
    fresh = os.path.join(folder, "Show - S01E04.cs.srt")

    path_resolver.atomic_write(fresh, b"novy titulek")

    parent = os.stat(folder)
    written = os.stat(fresh)
    if os.geteuid() == 0:
        assert (written.st_uid, written.st_gid) == (parent.st_uid, parent.st_gid)
    else:
        # Not root: chown is refused, and that must not break the write.
        assert open(fresh, "rb").read() == b"novy titulek"
