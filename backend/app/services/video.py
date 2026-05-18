"""
video.py – FFmpeg-based video operations for Anisubarr.

Supported operations:
  - list_subtitle_tracks(path)   → list all subtitle streams in a file
  - extract_subtitle(path, ...)  → extract one subtitle track to a file
  - remove_subtitles(path, ...)  → remux file without specified subtitle tracks
  - probe(path)                  → full ffprobe JSON for a media file
"""

import json
import subprocess
import shutil
import tempfile
import os
from pathlib import Path
from typing import Optional
from ..config import get_settings

settings = get_settings()


# ──────────────────────────────────────────
# Internal helpers
# ──────────────────────────────────────────

def _run(args: list[str], timeout: int = 120) -> subprocess.CompletedProcess:
    return subprocess.run(
        args,
        capture_output=True,
        text=True,
        timeout=timeout,
    )


def _ffprobe_path() -> str:
    return settings.ffprobe_path or "ffprobe"


def _ffmpeg_path() -> str:
    return settings.ffmpeg_path or "ffmpeg"


def _check_tools() -> dict:
    return {
        "ffprobe": shutil.which(_ffprobe_path()) is not None,
        "ffmpeg":  shutil.which(_ffmpeg_path()) is not None,
    }


# ──────────────────────────────────────────
# Probe
# ──────────────────────────────────────────

def probe(file_path: str) -> dict:
    """Run ffprobe and return parsed JSON. Raises on error."""
    result = _run([
        _ffprobe_path(),
        "-v", "quiet",
        "-print_format", "json",
        "-show_format",
        "-show_streams",
        file_path,
    ])
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe failed: {result.stderr}")
    return json.loads(result.stdout)


# ──────────────────────────────────────────
# Subtitle track listing
# ──────────────────────────────────────────

def list_subtitle_tracks(file_path: str) -> list[dict]:
    """
    Return a list of subtitle stream info dicts, e.g.:
      [{"index": 2, "codec": "subrip", "language": "cze", "title": "Czech", "default": True, "forced": False}, ...]
    """
    data = probe(file_path)
    tracks = []
    for stream in data.get("streams", []):
        if stream.get("codec_type") != "subtitle":
            continue
        tags = stream.get("tags", {})
        disp = stream.get("disposition", {})
        tracks.append({
            "index":    stream["index"],
            "codec":    stream.get("codec_name", "unknown"),
            "language": tags.get("language", "und"),
            "title":    tags.get("title", ""),
            "default":  bool(disp.get("default")),
            "forced":   bool(disp.get("forced")),
            "hearing_impaired": bool(disp.get("hearing_impaired")),
        })
    return tracks


# ──────────────────────────────────────────
# Extract subtitle track
# ──────────────────────────────────────────

# Map ffmpeg codec names to file extensions
_CODEC_EXT = {
    "subrip":       "srt",
    "srt":          "srt",
    "ass":          "ass",
    "ssa":          "ssa",
    "webvtt":       "vtt",
    "dvd_subtitle": "sub",
    "hdmv_pgs_subtitle": "sup",
    "pgssub":       "sup",
    "mov_text":     "srt",
}

_CODEC_COPY_OK = {"ass", "ssa", "subrip", "srt", "webvtt", "hdmv_pgs_subtitle", "pgssub", "dvd_subtitle"}


def extract_subtitle(
    file_path: str,
    stream_index: int,
    output_path: Optional[str] = None,
    convert_to_srt: bool = True,
) -> str:
    """
    Extract a subtitle track from file_path.

    Args:
        file_path:       Source media file.
        stream_index:    ffprobe stream index (not relative sub index).
        output_path:     Destination path. If None, auto-generated next to source.
        convert_to_srt:  If True and codec is image-based (PGS/VOBSUB), raise helpful error.
                         Text codecs are always extracted as-is (copy codec).

    Returns:
        Path to the extracted subtitle file.
    """
    tracks = list_subtitle_tracks(file_path)
    track = next((t for t in tracks if t["index"] == stream_index), None)
    if track is None:
        raise ValueError(f"No subtitle stream with index {stream_index} in {file_path}")

    codec = track["codec"]
    ext   = _CODEC_EXT.get(codec, "srt")

    if output_path is None:
        src  = Path(file_path)
        lang = track.get("language", "und")
        output_path = str(src.with_suffix(f".{stream_index}.{lang}.{ext}"))

    # Image-based subtitles cannot be trivially converted — inform the user
    if codec in ("hdmv_pgs_subtitle", "pgssub", "dvd_subtitle") and convert_to_srt:
        raise NotImplementedError(
            f"Track {stream_index} uses image-based codec '{codec}'. "
            "Automatic conversion to SRT is not supported. Extract as-is or use OCR tooling."
        )

    result = _run([
        _ffmpeg_path(),
        "-y",
        "-i", file_path,
        "-map", f"0:{stream_index}",
        "-c:s", "copy",
        output_path,
    ])
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg extract failed:\n{result.stderr}")

    return output_path


# ──────────────────────────────────────────
# Remove subtitle tracks
# ──────────────────────────────────────────

def remove_subtitles(
    file_path: str,
    stream_indices: Optional[list[int]] = None,
    remove_all: bool = False,
    output_path: Optional[str] = None,
    in_place: bool = False,
) -> str:
    """
    Remux file_path without specified subtitle tracks.

    Args:
        file_path:       Source media file.
        stream_indices:  List of stream indices to remove. Ignored if remove_all=True.
        remove_all:      If True, strip ALL subtitle tracks.
        output_path:     Destination path. Required if in_place=False and output_path is None.
        in_place:        If True, replace the original file (uses a temp file).

    Returns:
        Path to the output file.
    """
    if not remove_all and not stream_indices:
        raise ValueError("Provide stream_indices or set remove_all=True")

    if in_place:
        tmp = tempfile.NamedTemporaryFile(
            suffix=Path(file_path).suffix,
            delete=False,
            dir=Path(file_path).parent,
        )
        tmp.close()
        output_path = tmp.name
    elif output_path is None:
        src = Path(file_path)
        output_path = str(src.with_stem(src.stem + ".nosubs"))

    args = [
        _ffmpeg_path(),
        "-y",
        "-i", file_path,
        "-c", "copy",           # copy all streams as-is
    ]

    if remove_all:
        args += ["-sn"]         # -sn = no subtitle streams
    else:
        # Keep all streams, then explicitly unmap the ones we want removed
        all_tracks = list_subtitle_tracks(file_path)
        # Map everything except the targeted subtitle indices
        args += ["-map", "0"]
        for idx in (stream_indices or []):
            args += [f"-map", f"-0:{idx}"]

    args.append(output_path)

    result = _run(args, timeout=300)
    if result.returncode != 0:
        if in_place and os.path.exists(output_path):
            os.unlink(output_path)
        raise RuntimeError(f"ffmpeg remux failed:\n{result.stderr}")

    if in_place:
        os.replace(output_path, file_path)
        return file_path

    return output_path


# ──────────────────────────────────────────
# Convenience: extract all subtitle tracks
# ──────────────────────────────────────────

def extract_all_subtitles(file_path: str, output_dir: Optional[str] = None) -> list[dict]:
    """
    Extract every subtitle track in the file.

    Returns list of {"index", "language", "path", "error"} dicts.
    """
    tracks = list_subtitle_tracks(file_path)
    results = []
    out_dir = Path(output_dir) if output_dir else Path(file_path).parent

    for track in tracks:
        codec = track["codec"]
        ext   = _CODEC_EXT.get(codec, "srt")
        lang  = track.get("language", "und")
        idx   = track["index"]
        dest  = str(out_dir / f"{Path(file_path).stem}.{idx}.{lang}.{ext}")
        try:
            path = extract_subtitle(file_path, idx, output_path=dest, convert_to_srt=False)
            results.append({"index": idx, "language": lang, "path": path, "error": None})
        except Exception as e:
            results.append({"index": idx, "language": lang, "path": None, "error": str(e)})

    return results


# ──────────────────────────────────────────
# Health check
# ──────────────────────────────────────────

def check_tools() -> dict:
    tools = _check_tools()
    return {
        "ffprobe": {"available": tools["ffprobe"], "path": shutil.which(_ffprobe_path())},
        "ffmpeg":  {"available": tools["ffmpeg"],  "path": shutil.which(_ffmpeg_path())},
    }
