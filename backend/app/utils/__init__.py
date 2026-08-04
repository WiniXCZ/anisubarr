from __future__ import annotations

import os
import time

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

# Three-letter (and full-word) forms folded onto the two-letter code, so one
# language is one entry no matter which tool named the file.
_LANG_ALIASES = {
    "slo": "sk", "slk": "sk", "slovak": "sk", "slovensky": "sk",
    "eng": "en", "english": "en",
    "jpn": "ja", "jp": "ja", "japanese": "ja",
    "ger": "de", "deu": "de", "german": "de",
    "pol": "pl", "polish": "pl",
    "fra": "fr", "fre": "fr", "french": "fr",
    "spa": "es", "esp": "es", "spanish": "es",
    "rus": "ru", "russian": "ru",
    "hun": "hu", "ron": "ro", "rum": "ro",
    "por": "pt", "ita": "it", "chi": "zh", "zho": "zh",
}

# has_cs_sub() can optionally probe the video file itself with ffprobe to detect
# embedded Czech subtitle tracks Sonarr's mediaInfo missed. That spawns one
# ffprobe process per distinct video file, which is far too expensive to run on
# every library/grid render (has_cs_sub is called in loops over whole libraries).
# It is therefore gated behind the `deep_embedded_probe` AppSetting (default
# off) and the result cached briefly so a hot loop reads the DB at most once.
_probe_setting_cache: dict = {"val": None, "ts": 0.0}
_PROBE_SETTING_TTL = 30.0  # seconds


def _embedded_probe_enabled() -> bool:
    now = time.monotonic()
    if _probe_setting_cache["val"] is not None and now - _probe_setting_cache["ts"] < _PROBE_SETTING_TTL:
        return _probe_setting_cache["val"]
    val = False
    try:
        from ..database import SessionLocal
        from ..models.app_settings import AppSetting
        db = SessionLocal()
        try:
            row = db.query(AppSetting).filter(AppSetting.key == "deep_embedded_probe").first()
            val = bool(row and (row.value or "").strip().lower() in ("true", "1", "yes"))
        finally:
            db.close()
    except Exception:
        val = False
    _probe_setting_cache["val"] = val
    _probe_setting_cache["ts"] = now
    return val


def _file_non_empty(path: str) -> bool:
    try:
        if not os.path.isfile(path):
            return False
        return os.path.getsize(path) >= 10
    except PermissionError:
        return True
    except Exception:
        return False


def _sidecar_languages(ep, dir_cache=None) -> dict[str, str]:
    """{language code: file name} for subtitle files sitting next to the video.

    Shares dir_cache with has_cs_sub(), so listing a season folder costs one
    readdir per request no matter how many episodes are in it.
    """
    from ..services import path_resolver

    found: dict[str, str] = {}
    if not getattr(ep, "file_path", None):
        return found
    try:
        unc_video = path_resolver.resolve(ep.file_path)
        local_video = path_resolver.unc_to_local(unc_video)
        directories = []
        for vid in ([local_video] if local_video != unc_video else []) + [unc_video]:
            d = os.path.dirname(vid)
            if d and d not in directories:
                directories.append(d)

        stem = os.path.splitext(os.path.basename(local_video))[0].lower()
        cache = dir_cache if dir_cache is not None else {}
        for directory in directories:
            if directory not in cache:
                try:
                    cache[directory] = ({f.lower(): f for f in os.listdir(directory)}
                                        if os.path.isdir(directory) else {})
                except Exception:
                    cache[directory] = {}
            for lower, actual in cache[directory].items():
                if not isinstance(actual, str) or not lower.startswith(stem + "."):
                    continue
                name, ext = os.path.splitext(lower)
                if ext.lstrip(".") not in _SUB_EXTS:
                    continue
                tag = name.rsplit(".", 1)[-1] if "." in name[len(stem):] else ""
                # No tag at all means an untagged sidecar; still a subtitle.
                code = tag if tag and tag.isalpha() and 2 <= len(tag) <= 3 else "?"
                found.setdefault(code, actual)
    except Exception:
        pass
    return found


def subtitle_languages(ep, dir_cache=None) -> list[dict]:
    """Every subtitle language known for an episode and where it came from.

    Powers the per-episode language chips: seeing "CZ · na disku" is what makes
    a subtitle that exists but isn't recorded in the database visible, instead
    of the row just saying "missing" for reasons nobody can see.
    """
    langs: dict[str, set] = {}

    def _add(code: str, source: str) -> None:
        code = (code or "").strip().lower()
        if not code:
            return
        # Sonarr reports three-letter codes, sidecar files usually two — without
        # folding them together the same language shows up as two chips.
        code = "cs" if code in CS_LANGS else _LANG_ALIASES.get(code, code)
        langs.setdefault(code, set()).add(source)

    for sub in getattr(ep, "subtitles", None) or []:
        _add(sub.language, "embedded" if sub.is_embedded else "db")

    for token in (getattr(ep, "subtitles_in_file", None) or "").replace("/", ",").split(","):
        token = token.strip().lower()
        if token:
            _add("cs" if token in CS_NAMES else token, "embedded")

    for code in _sidecar_languages(ep, dir_cache):
        _add(code, "disk")

    order = {"cs": 0, "sk": 1, "en": 2}
    return [
        {"lang": code, "sources": sorted(sources)}
        for code, sources in sorted(langs.items(), key=lambda kv: (order.get(kv[0], 9), kv[0]))
    ]


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
        #    Off by default — see _embedded_probe_enabled() — because it spawns
        #    an ffprobe process per video file, too slow for library-wide loops.
        if not _embedded_probe_enabled():
            return False

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
