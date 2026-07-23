"""
nfo.py – NFO file generator for Emby / Jellyfin / Kodi.

Writes two types of NFO:
  tvshow.nfo    – placed in the series root folder
  <ep>.nfo      – placed next to each episode file (same name, .nfo extension)

Format: Kodi XML (understood by Emby, Jellyfin, Kodi, Plex with NFO agent).

Emby reads these automatically when "Refresh metadata" is triggered or
when the library scanner finds new/changed .nfo files.

All text content prefers Czech (overview_cs) where available, with
the original English as a fallback.
"""
from __future__ import annotations

import os
import json
import logging
from xml.etree import ElementTree as ET
from xml.dom import minidom
from typing import Optional

from .path_resolver import resolve, ensure_smb, unc_to_local

log = logging.getLogger("anisubarr.nfo")

# Characters forbidden in XML 1.0 (outside of legal ranges)
import re as _re
_XML_INVALID_CHARS = _re.compile(
    r"[^\x09\x0A\x0D\x20-퟿-�\U00010000-\U0010FFFF]"
)


def _sanitize_xml_text(text: str) -> str:
    """Strip characters that are illegal in XML 1.0 (e.g. null bytes, control chars)."""
    return _XML_INVALID_CHARS.sub("", text)


# ──────────────────────────────────────────
# XML helpers
# ──────────────────────────────────────────

def _el(parent: ET.Element, tag: str, text: Optional[str] = None, **attribs) -> ET.Element:
    e = ET.SubElement(parent, tag, **attribs)
    if text is not None:
        e.text = _sanitize_xml_text(str(text))
    return e


def _pretty(root: ET.Element) -> str:
    raw = ET.tostring(root, encoding="unicode")
    reparsed = minidom.parseString(raw)
    return reparsed.toprettyxml(indent="  ", encoding=None)


def _parse_list(v) -> list:
    if not v:
        return []
    try:
        parsed = json.loads(v)
        return parsed if isinstance(parsed, list) else []
    except Exception:
        try:
            return json.loads(v.replace("'", '"'))
        except Exception:
            return []


# ──────────────────────────────────────────
# tvshow.nfo
# ──────────────────────────────────────────

def build_tvshow_nfo(series) -> str:
    """
    Build tvshow.nfo XML string from a Series ORM object.

    Emby docs: https://emby.media/community/index.php?/topic/34975-nfo-metadata-format/
    """
    root = ET.Element("tvshow")

    # EN title preferred by Emby; romaji as fallback
    _el(root, "title",         series.title_english or series.title_romaji or series.title)
    _el(root, "originaltitle", series.title_japanese or series.title_romaji or series.title)

    if series.sort_title:
        _el(root, "sorttitle", series.sort_title)

    # Overview — prefer Czech translation
    overview = series.overview_cs or series.overview
    if overview:
        _el(root, "plot",    overview)
        _el(root, "outline", overview[:200] + ("…" if len(overview) > 200 else ""))

    # Ratings
    if series.average_score:
        ratings = _el(root, "ratings")
        r = _el(ratings, "rating", name="anilist", default="true")
        _el(r, "value", f"{series.average_score:.1f}")
        _el(r, "votes", str(series.rating_votes or 0))
    elif series.rating_value:
        ratings = _el(root, "ratings")
        r = _el(ratings, "rating", name="tvdb", default="true")
        _el(r, "value", f"{series.rating_value:.1f}")
        _el(r, "votes", str(series.rating_votes or 0))

    if series.year:
        _el(root, "year",    str(series.year))
    if series.first_aired:
        _el(root, "premiered", series.first_aired)
    if series.runtime:
        _el(root, "runtime", str(series.runtime))
    if series.certification:
        _el(root, "mpaa", series.certification)
    if series.network:
        _el(root, "studio", series.network)
    if series.status:
        _el(root, "status", series.status)
    if series.series_type:
        _el(root, "anime", "1" if series.series_type == "anime" else "0")

    # Genres (merged from Sonarr + AniList)
    seen_genres = set()
    for g in _parse_list(series.genres):
        if g not in seen_genres:
            _el(root, "genre", g)
            seen_genres.add(g)

    # Tags (from AniList)
    for t in _parse_list(series.tags)[:15]:
        _el(root, "tag", t)

    # Sonarr tags
    for t in _parse_list(series.sonarr_tags):
        _el(root, "tag", f"sonarr:{t}")

    # Unique IDs — Emby uses these for external scraping
    if series.tvdb_id:
        _el(root, "uniqueid", str(series.tvdb_id), type="tvdb", default="true" if not series.anilist_id else "false")
    if series.imdb_id:
        _el(root, "uniqueid", series.imdb_id, type="imdb")
    if series.anilist_id:
        _el(root, "uniqueid", str(series.anilist_id), type="anilist", default="true")
    if series.tvmaze_id:
        _el(root, "uniqueid", str(series.tvmaze_id), type="tvmaze")

    # Alternate titles
    for alt in _parse_list(series.alternate_titles):
        _el(root, "alternatetitle", alt)

    return _pretty(root)


# ──────────────────────────────────────────
# Episode NFO
# ──────────────────────────────────────────

def build_episode_nfo(episode, series=None) -> str:
    """
    Build an episodedetails NFO string from an Episode ORM object.
    Pass series for fallback title resolution.
    """
    root = ET.Element("episodedetails")

    _el(root, "title",   episode.title or f"Episode {episode.episode_number}")
    _el(root, "season",  str(episode.season_number))
    _el(root, "episode", str(episode.episode_number))

    if episode.absolute_episode_number is not None:
        _el(root, "absoluteepisodenumber", str(episode.absolute_episode_number))

    _ep_overview = episode.overview_cs or episode.overview
    if _ep_overview:
        _el(root, "plot", _ep_overview)

    if episode.air_date:
        _el(root, "aired", episode.air_date)
    if episode.run_time:
        # run_time is "HH:MM:SS" — convert to minutes for Emby
        try:
            parts = episode.run_time.split(":")
            mins  = int(parts[0]) * 60 + int(parts[1])
            _el(root, "runtime", str(mins))
        except Exception:
            pass
    elif episode.runtime:
        _el(root, "runtime", str(episode.runtime))

    # TVDB episode ID
    if episode.tvdb_ep_id:
        _el(root, "uniqueid", str(episode.tvdb_ep_id), type="tvdb", default="true")

    # Media info (informational — Emby may override with its own scan)
    if episode.video_codec or episode.resolution:
        fi = _el(root, "fileinfo")
        sd = _el(fi, "streamdetails")
        if episode.video_codec:
            v = _el(sd, "video")
            _el(v, "codec",        episode.video_codec)
            if episode.resolution:
                parts = episode.resolution.split("x")
                if len(parts) == 2:
                    _el(v, "width",  parts[0])
                    _el(v, "height", parts[1])
            if episode.video_fps:
                _el(v, "framerate", str(round(episode.video_fps, 3)))
            if episode.video_dynamic_range:
                _el(v, "hdrtype", episode.video_dynamic_range)
        if episode.audio_codec:
            a = _el(sd, "audio")
            _el(a, "codec", episode.audio_codec)
            if episode.audio_channels:
                _el(a, "channels", str(episode.audio_channels))
            if episode.audio_languages:
                for lang in episode.audio_languages.split("/"):
                    _el(a, "language", lang.strip())
        if episode.subtitles_in_file:
            for lang in episode.subtitles_in_file.split("/"):
                s = _el(sd, "subtitle")
                _el(s, "language", lang.strip())

    return _pretty(root)


# ──────────────────────────────────────────
# File path helpers
# ──────────────────────────────────────────

def tvshow_nfo_path(series) -> Optional[str]:
    """
    Return the local path for tvshow.nfo.
    Uses the series Sonarr path (series.path) which is the root folder.
    """
    if not series.path:
        return None
    try:
        local = resolve(series.path)
        if not local:
            return None
        return os.path.join(local, "tvshow.nfo")
    except Exception:
        return None


def episode_nfo_path(episode) -> Optional[str]:
    """
    Return the local path for an episode NFO (same name as video, .nfo extension).
    """
    if not episode.file_path:
        return None
    try:
        local = resolve(episode.file_path)
        return os.path.splitext(local)[0] + ".nfo"
    except Exception:
        return None


# ──────────────────────────────────────────
# Write helpers
# ──────────────────────────────────────────

def _write(path: str, content: str) -> None:
    ensure_smb(path)
    local_path = unc_to_local(path)   # UNC → drive letter (Y:\...) on Windows; no-op on Linux
    if local_path != path:
        log.debug(f"NFO path resolved: {path} → {local_path}")
    dirpath = os.path.dirname(local_path)
    if dirpath:
        os.makedirs(dirpath, exist_ok=True)
    with open(local_path, "w", encoding="utf-8") as f:
        f.write(content)
    log.info(f"NFO → {local_path}")


# ──────────────────────────────────────────
# Public API
# ──────────────────────────────────────────

def write_series_nfo(series) -> dict:
    """
    Write tvshow.nfo for a series.
    Returns {"path": ..., "ok": bool, "error": ...}.
    """
    path = tvshow_nfo_path(series)
    if not path:
        return {"path": None, "ok": False, "error": "Series has no path configured in Sonarr"}
    try:
        xml = build_tvshow_nfo(series)
        _write(path, xml)
        return {"path": path, "ok": True, "error": None}
    except Exception as e:
        log.error(f"write_series_nfo '{series.title}': {e}")
        return {"path": path, "ok": False, "error": str(e)}


def write_episode_nfo(episode) -> dict:
    """
    Write .nfo for a single episode.
    Returns {"path": ..., "ok": bool, "error": ...}.
    """
    path = episode_nfo_path(episode)
    if not path:
        return {"path": None, "ok": False, "error": "Episode has no file path"}
    try:
        xml = build_episode_nfo(episode, series=episode.series)
        _write(path, xml)
        return {"path": path, "ok": True, "error": None}
    except Exception as e:
        log.error(f"write_episode_nfo ep {episode.id}: {e}")
        return {"path": path, "ok": False, "error": str(e)}


def refresh_series_nfo(series, db) -> dict:
    """
    Translate description to Czech (if not cached), then write tvshow.nfo.
    Returns {"path": ..., "ok": bool, "translated": bool, "error": ...}.
    """
    translated = False
    try:
        from .ai_description import ensure_czech_description
        cs = ensure_czech_description(series, db)
        translated = bool(cs)
    except Exception as e:
        log.warning("Description translation error for series %d: %s", series.id, e)

    result = write_series_nfo(series)
    result["translated"] = translated
    return result


def write_all_nfo(series) -> dict:
    """
    Write tvshow.nfo + all episode NFOs for a series.
    Returns summary dict.
    """
    results = {
        "series_nfo": write_series_nfo(series),
        "episode_nfos": [],
        "ok_count": 0,
        "fail_count": 0,
    }
    for ep in series.episodes:
        if ep.season_number == 0 or not ep.has_file:
            continue
        r = write_episode_nfo(ep)
        results["episode_nfos"].append(r)
        if r["ok"]:
            results["ok_count"] += 1
        else:
            results["fail_count"] += 1
    return results
