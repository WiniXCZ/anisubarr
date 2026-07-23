from __future__ import annotations

import os

# ---------------------------------------------------------------------------
# Czech subtitle language codes - single source of truth used across routers
# and services.  ISO 639-1 "cs", ISO 639-2/B "cze", ISO 639-2/T "ces", plus
# the informal two-letter shorthand "cz" that some tools emit.
# ---------------------------------------------------------------------------

CS_LANGS: frozenset = frozenset({"cs", "cze", "cz", "ces"})

# Sonarr sometimes stores the full English name or Czech-language variants in
# the subtitles_in_file field.
CS_NAMES: frozenset = CS_LANGS | frozenset(
    {"czech", "cestina", "cestiny", "cestina"}
)

_SUB_EXTS = ("srt", "ass", "ssa", "vtt")


def _file_non_empty(path: str) -> bool:
    try:
        if not os.path.isfile(path):
            return False
        return os.path.getsize(path) >= 10
    except PermissionError:
        return True
    except Exception:
        return False


def has_cs_sub(ep, dir_cache=None) -> bool:
    from ..services import path_resolver

    for sub in ep.subtitles:
        if sub.language in CS_LANGS:
            return True

    if ep.subtitles_in_file:
        for token in ep.subtitles_in_file.replace("/", ",").split(","):
            if token.strip().lower() in CS_NAMES:
                return True

    if not ep.file_path:
        return False
    try:
        unc_video   = path_resolver.resolve(ep.file_path)
        local_video = path_resolver.unc_to_local(unc_video)

        directories = []
        for vid in ([local_video] if local_video != unc_video else []) + [unc_video]:
            d = os.path.dirname(vid)
            if d and d not in directories:
                directories.append(d)

        video_stem = os.path.splitext(os.path.basename(local_video))[0].lower()
        cache = dir_cache if dir_cache is not None else {}

        for directory in directories:
            if directory not in cache:
                try:
                    if os.path.isdir(directory):
                        # Map lowercased filename -> actual on-disk filename, since
                        # POSIX filesystems are case-sensitive but Sonarr/video_stem
                        # casing may not match the sidecar subtitle's casing.
                        cache[directory] = {f.lower(): f for f in os.listdir(directory)}
                    else:
                        cache[directory] = {}
                except Exception:
                    cache[directory] = {}

            filenames = cache[directory]
            for lang in CS_LANGS:
                for ext in _SUB_EXTS:
                    candidate = f"{video_stem}.{lang}.{ext}"
                    actual = filenames.get(candidate)
                    if actual and _file_non_empty(os.path.join(directory, actual)):
                        return True

        # 4) Embedded subtitle tracks inside the video file itself, detected via
        #    ffprobe. Sonarr's mediaInfo.subtitles field is sometimes empty/null
        #    even when the file does contain a Czech subtitle track (e.g. ASS
        #    tracks that Emby detects fine but Sonarr's parser misses).
        from ..services import video as video_service

        probe_cache = cache.setdefault("__ffprobe_subs__", {})
        for vid in ([local_video] if local_video != unc_video else []) + [unc_video]:
            if not os.path.isfile(vid):
                continue
            if vid not in probe_cache:
                try:
                    probe_cache[vid] = video_service.list_subtitle_tracks(vid)
                except Exception:
                    probe_cache[vid] = []
            for track in probe_cache[vid]:
                lang  = (track.get("language") or "").strip().lower()
                title = (track.get("title") or "").strip().lower()
                if lang in CS_LANGS or title in CS_NAMES:
                    return True
            break  # only need to probe the first reachable copy of the file
    except Exception:
        pass
    return False
