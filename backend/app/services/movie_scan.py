"""
movie_scan.py – what is really inside every movie file, and whether it plays.

Walks the movie folders on disk (setting ``movie_roots``), runs ffprobe on each
video and stores a summary in ``movie_files``: resolution and HDR, every audio
track with language and channel count (mono / stereo / 5.1 / 7.1, Atmos),
embedded subtitles and the external ones lying next to the file.

Verification goes further than "ffprobe can open it": a file can have valid
headers and still be useless — torrents that were preallocated but never
finished are full of zeros, and Radarr happily keeps them as fine (eleven such
films were found by hand on 25. 10. 2026). So verification reads a few blocks
across the file looking for all-zero regions, and decodes a few seconds at the
start, middle and end.

The scan is incremental: a file is probed again only when its size or mtime
changed, and verified again only when it changed since the last verification.
"""
from __future__ import annotations

import json
import logging
import os
import re
import subprocess
from datetime import datetime, timezone
from typing import Callable, Optional

log = logging.getLogger("anisubarr.movie_scan")

DEFAULT_ROOTS = "/media/media/movies,/media/media/anime_movies"
VIDEO_EXT = {".mkv", ".mp4", ".avi", ".m4v", ".mov", ".wmv", ".ts", ".m2ts", ".webm", ".mpg", ".mpeg"}
SUB_EXT = {".srt", ".ass", ".ssa", ".vtt", ".sub", ".sup"}
SKIP_DIRS = {"extras", "featurettes", "behind the scenes", "deleted scenes", "trailers", "samples", "sample", "other"}

# ISO 639-2 (and a few spellings seen in the wild) → short code shown in the table
_LANG = {
    "cze": "cs", "ces": "cs", "cs": "cs", "czech": "cs", "cz": "cs",
    "slo": "sk", "slk": "sk", "sk": "sk", "slovak": "sk",
    "eng": "en", "en": "en", "english": "en",
    "jpn": "ja", "ja": "ja", "japanese": "ja",
    "ger": "de", "deu": "de", "de": "de", "fre": "fr", "fra": "fr", "fr": "fr",
    "spa": "es", "es": "es", "ita": "it", "it": "it", "rus": "ru", "ru": "ru",
    "pol": "pl", "pl": "pl", "hun": "hu", "hu": "hu", "por": "pt", "pt": "pt",
    "kor": "ko", "ko": "ko", "chi": "zh", "zho": "zh", "zh": "zh",
    "und": "und", "": "und",
}


def norm_lang(code: Optional[str]) -> str:
    c = (code or "").strip().lower()
    return _LANG.get(c, c or "und")


def channel_label(channels: Optional[int]) -> str:
    return {1: "mono", 2: "stereo", 3: "2.1", 6: "5.1", 7: "6.1", 8: "7.1"}.get(channels or 0, f"{channels or '?'} ch")


def resolution_label(width: Optional[int], height: Optional[int]) -> str:
    """By width first: cinema crops (3840×1600, 1920×800) are still 4K / 1080p."""
    w, h = width or 0, height or 0
    if w >= 3200 or h >= 2000:
        return "4K"
    if w >= 1700 or h >= 1000:
        return "1080p"
    if w >= 1200 or h >= 700:
        return "720p"
    return "SD" if w else "?"


def parse_folder(folder: str) -> tuple[str, Optional[int]]:
    m = re.match(r"^(.*?)\s*\((\d{4})\)", folder)
    if m:
        return m.group(1).strip(), int(m.group(2))
    return folder, None


# ── Listing ──────────────────────────────────────────────────────────────────

def roots(db=None) -> list[str]:
    from ..utils.settings_helper import read_setting
    raw = read_setting("movie_roots", db) or DEFAULT_ROOTS
    return [r.strip() for r in re.split(r"[,\n;]", raw) if r.strip()]


def list_videos(root_list: list[str]) -> list[tuple[str, str]]:
    """(root, path) for every movie video under the roots."""
    out = []
    for root in root_list:
        if not os.path.isdir(root):
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d.lower() not in SKIP_DIRS and not d.startswith(".")]
            for f in filenames:
                ext = os.path.splitext(f)[1].lower()
                low = f.lower()
                if ext not in VIDEO_EXT or ".tmp." in low or low.endswith(".part"):
                    continue
                if re.search(r"(^|[-._ ])(sample|trailer)([-._ ]|$)", low):
                    continue
                out.append((root, os.path.join(dirpath, f)))
    return sorted(out, key=lambda x: x[1])


def external_subs(video_path: str) -> list[dict]:
    """Subtitles lying next to the video: "<base>.cs.srt", "<base>.cs.forced.ass", "<base>.srt" …"""
    d, name = os.path.split(video_path)
    base = os.path.splitext(name)[0]
    subs = []
    try:
        entries = os.listdir(d)
    except OSError:
        return subs
    for f in sorted(entries):
        stem, ext = os.path.splitext(f)
        if ext.lower() not in SUB_EXT or not stem.startswith(base):
            continue
        rest = stem[len(base):]
        if rest and not rest.startswith("."):
            continue                      # another version's subtitle ("Base - 1080p.cs.srt")
        tokens = [t.lower() for t in rest.split(".") if t]
        lang = next((norm_lang(t) for t in tokens if t in _LANG), "und")
        subs.append({"lang": lang, "codec": ext.lstrip(".").lower(), "forced": "forced" in tokens,
                     "default": False, "title": "", "external": True, "file": f})
    return subs


# ── Probe ────────────────────────────────────────────────────────────────────

def _ffprobe() -> str:
    from ..config import get_settings
    return get_settings().ffprobe_path or "ffprobe"


def _ffmpeg() -> str:
    from ..config import get_settings
    return get_settings().ffmpeg_path or "ffmpeg"


def probe(path: str) -> dict:
    r = subprocess.run([_ffprobe(), "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path],
                       capture_output=True, text=True, timeout=180)
    if r.returncode != 0:
        raise RuntimeError((r.stderr or "ffprobe selhal").strip().splitlines()[-1][:200])
    return json.loads(r.stdout or "{}")


def _hdr10plus(path: str) -> bool:
    """HDR10+ lives in per-frame metadata — look at the first frame only."""
    try:
        r = subprocess.run([_ffprobe(), "-v", "error", "-select_streams", "v:0", "-read_intervals", "%+#1",
                            "-show_frames", "-print_format", "json", path], capture_output=True, text=True, timeout=60)
        return "SMPTE2094-40" in (r.stdout or "")
    except Exception:
        return False


def summarize(data: dict, path: str = "", check_hdr10plus: bool = True) -> dict:
    streams = data.get("streams") or []
    fmt = data.get("format") or {}
    video = next((s for s in streams if s.get("codec_type") == "video"
                  and not (s.get("disposition") or {}).get("attached_pic")), None)
    out: dict = {
        "duration": float(fmt["duration"]) if fmt.get("duration") else None,
        "container": (fmt.get("format_name") or "").split(",")[0] or None,
        "bitrate": int(int(fmt["bit_rate"]) / 1000) if str(fmt.get("bit_rate", "")).isdigit() else None,
        "video_codec": None, "width": None, "height": None, "resolution": "?", "hdr": None,
    }
    if video:
        out["video_codec"] = video.get("codec_name")
        out["width"], out["height"] = video.get("width"), video.get("height")
        out["resolution"] = resolution_label(out["width"], out["height"])
        transfer = video.get("color_transfer") or ""
        dovi = any("DOVI" in (sd.get("side_data_type") or "") for sd in video.get("side_data_list") or [])
        hdr = None
        if transfer == "smpte2084":
            hdr = "HDR10+" if (check_hdr10plus and path and _hdr10plus(path)) else "HDR10"
        elif transfer == "arib-std-b67":
            hdr = "HLG"
        if dovi:
            hdr = f"DV {hdr}" if hdr else "DV"
        out["hdr"] = hdr or "SDR"
    audio = []
    for s in streams:
        if s.get("codec_type") != "audio":
            continue
        tags = s.get("tags") or {}
        title = tags.get("title") or ""
        profile = s.get("profile") or ""
        audio.append({
            "lang": norm_lang(tags.get("language")),
            "codec": s.get("codec_name"),
            "channels": s.get("channels"),
            "layout": channel_label(s.get("channels")),
            "atmos": "atmos" in (profile + " " + title).lower(),
            "title": title,
            "default": bool((s.get("disposition") or {}).get("default")),
        })
    subs = []
    for s in streams:
        if s.get("codec_type") != "subtitle":
            continue
        tags, disp = s.get("tags") or {}, s.get("disposition") or {}
        subs.append({"lang": norm_lang(tags.get("language")), "codec": s.get("codec_name"),
                     "forced": bool(disp.get("forced")), "default": bool(disp.get("default")),
                     "title": tags.get("title") or "", "external": False, "file": ""})
    out["audio"], out["subs"] = audio, subs
    return out


# ── Verification ─────────────────────────────────────────────────────────────

ZERO_BLOCK = 256 * 1024
ZERO_POINTS = (0.05, 0.25, 0.5, 0.75, 0.95)


def zero_regions(path: str, size: Optional[int] = None) -> list[int]:
    """Percent positions where a whole block is zeros (preallocated, never written)."""
    size = size if size is not None else os.path.getsize(path)
    bad = []
    if size < ZERO_BLOCK * 4:
        return bad
    with open(path, "rb") as fh:
        for p in ZERO_POINTS:
            fh.seek(int(size * p))
            block = fh.read(ZERO_BLOCK)
            if block and block.count(0) == len(block):
                bad.append(int(p * 100))
    return bad


def decode_test(path: str, duration: Optional[float]) -> list[str]:
    """Decode a few seconds at the start, middle and end; return problems found."""
    if not duration or duration < 30:
        points = [0.0]
    else:
        points = [min(60.0, duration * 0.02), duration * 0.5, max(0.0, duration - 90)]
    problems = []
    for pos in points:
        try:
            r = subprocess.run([_ffmpeg(), "-v", "error", "-ss", f"{pos:.1f}", "-t", "4", "-i", path,
                                "-map", "0:v:0?", "-map", "0:a?", "-f", "null", "-"],
                               capture_output=True, text=True, timeout=120)
        except subprocess.TimeoutExpired:
            problems.append(f"{int(pos // 60)}. min: dekódování neskončilo")
            continue
        err = (r.stderr or "").strip()
        if r.returncode != 0:
            problems.append(f"{int(pos // 60)}. min: nejde přehrát ({err.splitlines()[-1][:80] if err else 'chyba'})")
        elif err:
            problems.append(f"{int(pos // 60)}. min: chyby v datech ({len(err.splitlines())}×)")
    return problems


def verify(path: str, duration: Optional[float], size: Optional[int] = None) -> tuple[str, str]:
    """→ ("ok" | "warn" | "error", message)."""
    try:
        zeros = zero_regions(path, size)
    except OSError as e:
        return "error", f"soubor nejde číst: {e}"
    if zeros:
        return "error", "vynulovaná místa (nedostažený soubor) na " + ", ".join(f"{z} %" for z in zeros)
    if not duration:
        return "error", "nezjištěná délka – soubor je nejspíš poškozený"
    problems = decode_test(path, duration)
    if any("nejde přehrát" in p or "neskončilo" in p for p in problems):
        return "error", "; ".join(problems)
    if problems:
        return "warn", "; ".join(problems)
    return "ok", "přehratelný od začátku do konce, bez vynulovaných míst"


# ── Scan ─────────────────────────────────────────────────────────────────────

def _apply(row, info: dict) -> None:
    for k in ("duration", "container", "video_codec", "width", "height", "resolution", "hdr", "bitrate"):
        setattr(row, k, info.get(k))
    row.audio_json = json.dumps(info.get("audio") or [], ensure_ascii=False)
    row.subs_json = json.dumps(info.get("subs") or [], ensure_ascii=False)


def scan_one(db, row, verify_file: bool = False, force: bool = False) -> None:
    """Probe (when changed) and optionally verify a single MovieFile row."""
    st = os.stat(row.path)
    changed = force or row.size != st.st_size or row.mtime != st.st_mtime or row.scanned_at is None
    row.size, row.mtime = st.st_size, st.st_mtime
    folder = os.path.basename(os.path.dirname(row.path))
    row.title, row.year = parse_folder(folder)
    if changed:
        try:
            info = summarize(probe(row.path), row.path)
            info["subs"] = info["subs"] + external_subs(row.path)
            _apply(row, info)
            row.probe_error = None
        except Exception as e:                       # unreadable header – keep the row, show why
            row.probe_error = str(e)[:300]
        row.scanned_at = datetime.now(timezone.utc)
    else:
        # external subtitles come and go without touching the video
        try:
            subs = [s for s in json.loads(row.subs_json or "[]") if not s.get("external")]
            row.subs_json = json.dumps(subs + external_subs(row.path), ensure_ascii=False)
        except Exception:
            pass
    if verify_file and (force or row.verified_mtime != row.mtime or row.verify_status is None):
        if row.probe_error:
            row.verify_status, row.verify_msg = "error", "hlavičku nejde přečíst: " + row.probe_error
        else:
            row.verify_status, row.verify_msg = verify(row.path, row.duration, row.size)
        row.verified_at = datetime.now(timezone.utc)
        row.verified_mtime = row.mtime


def scan(db, verify_files: bool = False, force: bool = False,
         progress: Optional[Callable[[int, int, str], None]] = None) -> dict:
    from ..models.movie_file import MovieFile
    root_list = roots(db)
    files = list_videos(root_list)
    report = {"files": len(files), "new": 0, "probed": 0, "verified": 0, "removed": 0,
              "errors": 0, "warnings": 0, "roots": [r for r in root_list if os.path.isdir(r)]}
    if not report["roots"]:
        report["aborted"] = "žádná složka s filmy není dostupná"
        return report
    rows = {r.path: r for r in db.query(MovieFile).all()}
    for i, (root, path) in enumerate(files, 1):
        row = rows.get(path)
        if row is None:
            row = MovieFile(path=path, root=root)
            db.add(row)
            report["new"] += 1
        before_scan, before_ver = row.scanned_at, row.verified_at
        try:
            scan_one(db, row, verify_files, force)
        except FileNotFoundError:
            continue
        except Exception as e:
            log.warning("movie scan %s: %s", path, e)
            row.probe_error = str(e)[:300]
        if row.scanned_at != before_scan:
            report["probed"] += 1
        if row.verified_at != before_ver:
            report["verified"] += 1
        if i % 20 == 0:
            db.commit()
        if progress:
            progress(i, len(files), f"{i}/{len(files)} · {row.title or os.path.basename(path)}")
    present = {p for _, p in files}
    # only forget rows under roots that are reachable right now — an unmounted
    # share must not wipe the table
    for path, row in rows.items():
        if path not in present and any(path.startswith(r.rstrip("/") + "/") for r in report["roots"]):
            db.delete(row)
            report["removed"] += 1
    db.commit()
    for row in db.query(MovieFile).all():
        if row.verify_status == "error":
            report["errors"] += 1
        elif row.verify_status == "warn":
            report["warnings"] += 1
    return report


def report_text(rep: dict) -> str:
    if rep.get("aborted"):
        return "Sken filmů zastaven: " + rep["aborted"]
    parts = [f"{rep['files']} souborů", f"{rep['probed']} načteno znovu"]
    if rep["new"]:
        parts.append(f"{rep['new']} nových")
    if rep["verified"]:
        parts.append(f"{rep['verified']} ověřeno")
    if rep["removed"]:
        parts.append(f"{rep['removed']} odebráno")
    if rep["errors"] or rep["warnings"]:
        parts.append(f"chyb {rep['errors']}, varování {rep['warnings']}")
    return ", ".join(parts)


def row_dict(r) -> dict:
    def _j(s):
        try:
            return json.loads(s or "[]")
        except Exception:
            return []
    return {
        "id": r.id, "path": r.path, "file": os.path.basename(r.path), "title": r.title, "year": r.year,
        "size": r.size, "duration": r.duration, "container": r.container, "video_codec": r.video_codec,
        "width": r.width, "height": r.height, "resolution": r.resolution, "hdr": r.hdr, "bitrate": r.bitrate,
        "audio": _j(r.audio_json), "subs": _j(r.subs_json), "probe_error": r.probe_error,
        "scanned_at": r.scanned_at.isoformat() if r.scanned_at else None,
        "verify_status": r.verify_status, "verify_msg": r.verify_msg,
        "verified_at": r.verified_at.isoformat() if r.verified_at else None,
    }
