"""
subtitle_sync.py — alass-based subtitle timing synchronisation.

alass (https://github.com/kaegi/alass) aligns an incorrectly-timed subtitle
file against a reference.  When the reference is a .mkv / .mp4 that contains
embedded subtitle tracks (e.g. embedded EN subs from the release group), alass
extracts them automatically and uses them as the timing reference — no audio
VAD comparison required.

Endpoints
---------
POST /api/subtitle-sync/episode/{episode_id}   — sync one episode (sync)
POST /api/subtitle-sync/series/{series_id}     — sync all CZ subs in series (bg)
POST /api/subtitle-sync/bulk                   — sync list of episodes (bg)
"""
from __future__ import annotations

import logging
import os
import re
import shutil
import subprocess
import sys
import tempfile

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user
from ..models.series import Episode, Series
from ..models.user import User
from ..services import path_resolver
from ..utils import CS_LANGS

log = logging.getLogger("anisubarr.subtitle_sync")


def _unc_to_local(path: str) -> str:
    """On Windows, convert a UNC path (\\\\server\\share\\...) to a mapped drive
    letter (X:\\...) if such a mapping exists via 'net use'. ffmpeg and other
    native tools often fail on UNC paths but work fine with drive letters.
    Handles hostname↔IP differences by resolving both sides via socket."""
    if sys.platform != "win32":
        return path
    if not path.startswith("\\\\"):
        return path

    import socket

    def _resolve_host(host: str) -> str:
        """Return IP for hostname, or original string on failure."""
        try:
            return socket.gethostbyname(host)
        except Exception:
            return host

    # Resolve the IP of the host in the incoming path
    parts = path.lstrip("\\").split("\\", 1)           # ['192.168.1.149', 'data\\...']
    path_host_ip = _resolve_host(parts[0]) if parts else ""

    try:
        result = subprocess.run(
            ["net", "use"],
            capture_output=True, text=True, encoding="cp852", timeout=5,
        )
        log.debug("net use output:\n%s", result.stdout)
        for line in result.stdout.splitlines():
            m = re.match(r"\S+\s+([A-Za-z]:)\s+(\\\\[^\s]+)", line)
            if not m:
                continue
            drive, share = m.group(1).upper(), m.group(2).rstrip("\\")
            # Direct match
            if path.lower().startswith(share.lower()):
                rest = path[len(share):].lstrip("\\")
                log.debug("_unc_to_local: %s → %s\\%s", share, drive, rest)
                return f"{drive}\\{rest}"
            # Hostname→IP match (net use may show hostname, path has IP or vice versa)
            share_parts = share.lstrip("\\").split("\\", 1)   # ['TOWER', 'data']
            if share_parts:
                share_host_ip = _resolve_host(share_parts[0])
                share_suffix  = share_parts[1] if len(share_parts) > 1 else ""
                # Reconstruct share with resolved IP
                ip_share = f"\\\\{share_host_ip}\\{share_suffix}" if share_suffix else f"\\\\{share_host_ip}"
                if path.lower().startswith(ip_share.lower()):
                    rest = path[len(ip_share):].lstrip("\\")
                    log.debug("_unc_to_local (hostname resolved): %s → %s\\%s", ip_share, drive, rest)
                    return f"{drive}\\{rest}"
                # Also: path_host_ip matches share_host_ip
                path_share = f"\\\\{path_host_ip}\\{parts[1]}" if len(parts) > 1 else f"\\\\{path_host_ip}"
                if path_share.lower().startswith(f"\\\\{share_host_ip}\\{share_suffix}".lower()):
                    rest = path_share[len(f"\\\\{share_host_ip}\\{share_suffix}"):].lstrip("\\")
                    log.debug("_unc_to_local (ip match): %s → %s\\%s", share, drive, rest)
                    return f"{drive}\\{rest}"
    except Exception as exc:
        log.warning("_unc_to_local: %s", exc)
    log.warning("_unc_to_local: no drive mapping found for %s", path)
    return path

router = APIRouter(prefix="/api/subtitle-sync", tags=["subtitle-sync"])

_SUB_EXTS  = ["srt", "ass", "ssa", "vtt"]


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _find_cs_sub(ep: Episode) -> str | None:
    """Return the local path of the CZ subtitle file, or None."""
    if not ep.file_path:
        return None

    # 1) DB subtitles (non-embedded)
    for sub in ep.subtitles:
        if sub.language.lower() not in CS_LANGS:
            continue
        if sub.is_embedded:
            continue
        if not sub.file_path:
            continue
        # Path stored in DB might already be local or might be a Sonarr path
        if os.path.isfile(sub.file_path):
            return sub.file_path
        try:
            resolved = path_resolver.resolve(sub.file_path)
            if os.path.isfile(resolved):
                return resolved
        except Exception:
            pass

    # 2) Disk scan alongside the video file
    try:
        local_video = path_resolver.resolve(ep.file_path)
        directory   = os.path.dirname(local_video)
        video_stem  = os.path.splitext(os.path.basename(local_video))[0]

        for lang in CS_LANGS:
            for ext in _SUB_EXTS:
                candidate = os.path.join(directory, f"{video_stem}.{lang}.{ext}")
                if os.path.isfile(candidate):
                    return candidate
    except Exception as exc:
        log.warning("Error scanning disk for CZ sub (ep %s): %s", ep.id, exc)

    return None


def _extract_reference_sub(video_paths: list[str], ffprobe_bin: str, ffmpeg_bin: str) -> str | None:
    """
    Try to extract the first subtitle track from *video_paths* (tried in order) into a
    local temp .srt.  Returns the temp file path on success, None if no subtitle stream
    exists or on error.

    Multiple paths are tried so we can fall back from a drive-letter path (Y:\\...)
    to a UNC path (\\\\server\\share\\...) if the subprocess cannot access mapped drives.
    """
    for video_path in video_paths:
        try:
            probe = subprocess.run(
                [
                    ffprobe_bin, "-hide_banner", "-v", "error",
                    "-select_streams", "s",
                    "-show_entries", "stream=index",
                    "-of", "csv=p=0",
                    video_path,
                ],
                capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=20,
            )
            if probe.returncode != 0 or not probe.stdout.strip():
                log.debug("_extract_reference_sub: no subtitle streams in %s (rc=%s err=%s)",
                          video_path, probe.returncode, probe.stderr[-200:].strip())
                continue

            tmp_fd, tmp_path = tempfile.mkstemp(suffix=".srt")
            os.close(tmp_fd)

            extract = subprocess.run(
                [
                    ffmpeg_bin, "-y", "-hide_banner",
                    "-i", video_path,
                    "-map", "0:s:0",
                    "-c:s", "srt",
                    tmp_path,
                ],
                capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=60,
            )

            if extract.returncode == 0 and os.path.getsize(tmp_path) > 100:
                log.info("_extract_reference_sub: extracted reference from %s → %s",
                         video_path, tmp_path)
                return tmp_path

            log.debug(
                "_extract_reference_sub: ffmpeg extract failed (rc=%s path=%s): %s",
                extract.returncode, video_path, extract.stderr[-200:].strip(),
            )
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            # Don't try next path for the same kind of failure — subtitle track
            # is path-independent once we know it exists.
            return None

        except Exception as exc:
            log.warning("_extract_reference_sub (%s): %s", video_path, exc)

    return None


def _extract_reference_audio(video_paths: list[str], ffmpeg_bin: str, duration_sec: int = 600) -> tuple:
    """
    Extract the first *duration_sec* seconds of audio from one of *video_paths* into a
    local temp MKV (audio-only).  Paths are tried in order so a drive-letter path
    (Y:\\...) is preferred but a UNC path (\\\\server\\share\\...) is used as fallback
    if the subprocess cannot access mapped drives.

    Returns (tmp_path, None) on success, (None, error_str) on failure.
    """
    tmp_fd, tmp_path = tempfile.mkstemp(suffix=".mkv")
    os.close(tmp_fd)

    last_err = ""
    for video_path in video_paths:
        try:
            # Attempt 1: codec copy — fast, no quality loss
            extract = subprocess.run(
                [
                    ffmpeg_bin, "-y", "-hide_banner",
                    "-i", video_path,
                    "-vn",
                    "-acodec", "copy",
                    "-t", str(duration_sec),
                    tmp_path,
                ],
                capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=120,
            )

            if extract.returncode == 0 and os.path.getsize(tmp_path) > 1000:
                log.info("_extract_reference_audio: extracted %ds audio (copy) from %s → %s",
                         duration_sec, video_path, tmp_path)
                return (tmp_path, None)

            last_err = (extract.stderr or "")[-300:].strip()
            log.debug("_extract_reference_audio: copy attempt failed (rc=%s path=%s): %s",
                      extract.returncode, video_path, last_err)

            # Attempt 2: AAC re-encode — handles codecs incompatible with MKV copy
            extract2 = subprocess.run(
                [
                    ffmpeg_bin, "-y", "-hide_banner",
                    "-i", video_path,
                    "-vn",
                    "-acodec", "aac",
                    "-ac", "1",       # mono — smaller, faster VAD
                    "-ar", "16000",   # 16 kHz — sufficient for voice-activity detection
                    "-t", str(duration_sec),
                    tmp_path,
                ],
                capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=120,
            )

            if extract2.returncode == 0 and os.path.getsize(tmp_path) > 1000:
                log.info("_extract_reference_audio: extracted %ds audio (aac) from %s → %s",
                         duration_sec, video_path, tmp_path)
                return (tmp_path, None)

            last_err = (extract2.stderr or extract.stderr or "")[-300:].strip()
            log.warning(
                "_extract_reference_audio: both attempts failed for path=%s\n"
                "  copy rc=%s  aac rc=%s\n"
                "  error: %s",
                video_path, extract.returncode, extract2.returncode, last_err,
            )

        except Exception as exc:
            last_err = str(exc)
            log.warning("_extract_reference_audio (%s): %s", video_path, exc)

    try:
        os.unlink(tmp_path)
    except OSError:
        pass
    return (None, last_err)


def _run_alass(ep: Episode) -> dict:
    """
    Synchronise the CZ subtitle for *ep* using alass.
    Returns a result dict with keys: status, message, (optional) subtitle_path.

    Strategy
    --------
    1. Resolve video path (UNC → drive letter).
    2. Try to extract an embedded subtitle track → pass local .srt as reference.
    3. If no embedded subtitle → extract first 10 min of audio to a local temp MKV
       and pass that as reference (alass does VAD on local file, avoids network I/O).
    4. Only if audio extraction also fails → return error (never pass the raw
       network path to alass — it will fail in the sub-subprocess chain).
    """
    from ..config import get_settings
    cfg = get_settings()
    alass_bin    = cfg.alass_path
    ffprobe_bin  = cfg.ffprobe_path
    ffmpeg_bin   = cfg.ffmpeg_path

    if not shutil.which(alass_bin):
        return {
            "status":  "error",
            "message": (
                f"alass not found ('{alass_bin}'). "
                "Install it and/or set ALASS_PATH in .env."
            ),
        }

    if not ep.file_path:
        return {"status": "error", "message": "Episode has no file path"}

    # ── Resolve video path ──────────────────────────────────────────────
    try:
        unc_video = path_resolver.resolve(ep.file_path)   # \\TOWER\data\...
    except Exception as exc:
        return {"status": "error", "message": f"Cannot resolve video path: {exc}"}

    # Drive-letter path preferred (e.g. Y:\...), UNC kept as fallback.
    # Some tools (alass sub-processes) cannot access mapped drives, but can
    # open UNC paths directly — so we always try both.
    local_video = _unc_to_local(unc_video)                # Y:\... (or same as unc_video)

    # Build candidate list: try drive-letter first, then UNC (if different)
    video_paths = [local_video]
    if unc_video != local_video:
        video_paths.append(unc_video)

    if not os.path.isfile(local_video):
        return {"status": "error", "message": f"Video file not found: {local_video}"}

    # ── Find CZ subtitle ────────────────────────────────────────────────
    cs_sub = _find_cs_sub(ep)
    if not cs_sub:
        return {"status": "skipped", "message": "No Czech subtitle found"}

    # Also convert subtitle path (alass reads the cs sub file too)
    cs_sub = _unc_to_local(cs_sub)

    # ── Build alass reference ────────────────────────────────────────────
    # We NEVER pass the raw network path to alass directly — its internal
    # ffprobe subprocess can't reliably access mapped drives.
    # Strategy: embedded subtitle track → audio extract → error.
    ref_tmp: str | None = _extract_reference_sub(video_paths, ffprobe_bin, ffmpeg_bin)
    if ref_tmp:
        log.info("alass: using extracted embedded subtitle as reference (%s)", ref_tmp)
    else:
        log.info("alass: no embedded subtitle — extracting audio as reference (paths: %s) …", video_paths)
        ref_tmp, audio_err = _extract_reference_audio(video_paths, ffmpeg_bin)
        if ref_tmp:
            log.info("alass: using extracted audio as reference (%s)", ref_tmp)
        else:
            err_detail = f" ffmpeg: {audio_err[:300]}" if audio_err else ""
            return {
                "status":  "error",
                "message": (
                    f"Cannot build alass reference: video has no embedded subtitles "
                    f"and audio extraction failed (video: {local_video}).{err_detail}"
                ),
            }
    reference = ref_tmp

    # ── Run alass ───────────────────────────────────────────────────────
    sub_ext = os.path.splitext(cs_sub)[1]
    tmp_fd, tmp_path = tempfile.mkstemp(suffix=sub_ext)
    os.close(tmp_fd)

    try:
        proc = subprocess.run(
            [alass_bin, reference, cs_sub, tmp_path],
            capture_output=True,
            text=True,
            encoding='utf-8',
            errors='replace',
            timeout=180,
        )

        if proc.returncode != 0:
            try: os.unlink(tmp_path)
            except OSError: pass
            err = (proc.stderr or proc.stdout or "")[:500]
            return {
                "status":  "error",
                "message": f"alass exited with code {proc.returncode}: {err}",
            }

        # ── Validate output before replacing the original ───────────────
        # alass can produce an empty file or wildly mis-timed output
        # (e.g. when the reference timing is totally different from the input).
        # We count subtitle entries to catch these cases.
        def _count_entries(path: str) -> int:
            """Count subtitle entries (SRT: '-->'; ASS: 'Dialogue:')."""
            try:
                with open(path, "r", encoding="utf-8-sig", errors="replace") as f:
                    content = f.read()
                if "Dialogue:" in content:
                    return content.count("Dialogue:")
                return content.count("-->")
            except Exception:
                return 0

        out_size    = os.path.getsize(tmp_path)
        out_entries = _count_entries(tmp_path)
        src_entries = _count_entries(cs_sub)

        log.info(
            "alass output: size=%d bytes, entries=%d (input had %d)",
            out_size, out_entries, src_entries,
        )

        if out_size < 50 or out_entries == 0:
            try: os.unlink(tmp_path)
            except OSError: pass
            return {
                "status":  "error",
                "message": (
                    f"alass produced an empty output ({out_size} bytes, {out_entries} entries). "
                    f"Původní titulek nebyl přepsán. "
                    f"Zkontroluj, zda má video vloženou referenční stopu ve správném jazyce."
                ),
            }

        # Warn if too many entries were lost (> 30 % drop)
        # but still allow the sync — some entries near the end may have been cut
        entries_ok = src_entries == 0 or (out_entries >= src_entries * 0.70)
        if not entries_ok:
            log.warning(
                "alass output has %d entries but input had %d — large drop, aborting",
                out_entries, src_entries,
            )
            try: os.unlink(tmp_path)
            except OSError: pass
            return {
                "status":  "error",
                "message": (
                    f"alass ztratil příliš mnoho titulků: vstup={src_entries}, výstup={out_entries}. "
                    f"Pravděpodobně je referenční stopa jiná epizoda nebo jazyk. "
                    f"Původní titulek nebyl přepsán."
                ),
            }

        # ── Backup + replace ────────────────────────────────────────────
        bak_path = cs_sub + ".bak"
        if not os.path.exists(bak_path):
            shutil.copy2(cs_sub, bak_path)

        shutil.move(tmp_path, cs_sub)

        alass_out = (proc.stdout or "").strip()[:300]
        return {
            "status":        "ok",
            "message":       f"Synchronizováno {os.path.basename(cs_sub)} ({out_entries} záznamů)",
            "subtitle_path": cs_sub,
            "backup_path":   bak_path,
            "alass_output":  alass_out,
        }

    except subprocess.TimeoutExpired:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        return {"status": "error", "message": "alass timed out (>180 s)"}

    except Exception as exc:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        return {"status": "error", "message": str(exc)}

    finally:
        # Clean up the temp reference subtitle if we created one
        if ref_tmp:
            try:
                os.unlink(ref_tmp)
            except OSError:
                pass


def _sync_episodes_bg(episode_ids: list[int]) -> None:
    """Background task: run alass for each episode in the list."""
    from ..database import SessionLocal
    from ..services import job_log

    db = SessionLocal()
    total = len(episode_ids)
    label = f"Sync časování titulků ({total} epizod)"
    run = job_log.start_run("subtitle_sync", label)
    ok = fail = skipped = 0
    try:
        for idx, ep_id in enumerate(episode_ids, 1):
            ep = db.query(Episode).filter(Episode.id == ep_id).first()
            if not ep:
                skipped += 1
                continue
            ep_label = f"S{ep.season_number:02d}E{ep.episode_number:02d}"
            job_log.update_progress(run.run_id, idx - 1, total, f"{idx}/{total} — {ep_label}")
            result = _run_alass(ep)
            status = result.get("status")
            log.info(
                "subtitle_sync ep=%s  status=%s  %s",
                ep_id, status, result.get("message"),
            )
            if status == "ok":
                ok += 1
            elif status == "skipped":
                skipped += 1
            else:
                fail += 1
        job_log.finish_run(run, "done", f"{ok} synchronizováno, {skipped} přeskočeno, {fail} chyb")
    except Exception as exc:
        job_log.finish_run(run, "error", str(exc)[:300])
    finally:
        db.close()


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/episode/{episode_id}")
def sync_episode(
    episode_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Synchronously sync one episode's CZ subtitle. Returns immediately."""
    from ..services import job_log
    ep = db.query(Episode).filter(Episode.id == episode_id).first()
    if not ep:
        raise HTTPException(404, "Episode not found")
    label = f"Sync titulku S{ep.season_number:02d}E{ep.episode_number:02d} ({ep.series.title if ep.series else '?'})"
    run = job_log.start_run("subtitle_sync_one", label)
    result = _run_alass(ep)
    status = result.get("status", "error")
    msg    = result.get("message", "")
    job_log.finish_run(run, "done" if status == "ok" else ("skipped" if status == "skipped" else "error"), msg)
    return result


@router.post("/series/{series_id}", status_code=202)
def sync_series(
    series_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Queue alass sync for all episodes in a series that have a file."""
    s = db.query(Series).filter(Series.id == series_id).first()
    if not s:
        raise HTTPException(404, "Series not found")

    ep_ids = [
        ep.id for ep in s.episodes
        if ep.has_file and ep.season_number > 0
    ]
    if not ep_ids:
        return {"status": "skipped", "message": "No episodes with files"}

    background_tasks.add_task(_sync_episodes_bg, ep_ids)
    return {
        "status":  "queued",
        "message": f"{len(ep_ids)} episodes queued for alass sync",
        "count":   len(ep_ids),
    }


@router.post("/bulk", status_code=202)
def sync_bulk(
    body: dict,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Queue alass sync for a list of episode IDs."""
    ep_ids = body.get("episode_ids", [])
    if not ep_ids:
        raise HTTPException(400, "episode_ids must be a non-empty list")

    background_tasks.add_task(_sync_episodes_bg, list(ep_ids))
    return {
        "status":  "queued",
        "message": f"{len(ep_ids)} episodes queued for alass sync",
        "count":   len(ep_ids),
    }


@router.post("/bulk-series", status_code=202)
def sync_bulk_series(
    body: dict,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Queue alass sync for all episodes in the given series IDs."""
    series_ids = body.get("series_ids", [])
    if not series_ids:
        raise HTTPException(400, "series_ids must be a non-empty list")

    ep_ids = [
        ep.id
        for s in db.query(Series).filter(Series.id.in_(series_ids)).all()
        for ep in s.episodes
        if ep.has_file and ep.season_number > 0
    ]
    if not ep_ids:
        raise HTTPException(400, "Žádné epizody se soubory ve vybraných sériích")

    background_tasks.add_task(_sync_episodes_bg, ep_ids)
    return {"status": "queued", "count": len(ep_ids)}
