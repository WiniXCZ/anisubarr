"""
local_subs.py – "Ruční složka": subtitles the user downloaded by hand.

Anisubarr looks in here before it touches any site on the net. A file that is
already on the disk costs nothing, cannot be rate-limited, and cannot get the
account banned — so it is always the cheapest source available.

The interface deliberately mirrors the web scrapers (``search`` / ``download``),
which is what lets the folder sit in the provider registry next to Hiyori & co.
and take part in the normal priority order instead of being a special case.

Matching is name-based because a hand-downloaded file can be called anything:
the episode number is parsed from several conventions (``S01E05``, ``1x05``,
``- 05``, ``EP05``, a bare ``05``), and the series is recognised from the file
name *and* the folders above it, compared against every title Anisubarr knows
for the show (Sonarr title, romaji, english, alternates). A file that can't be
attributed to an episode with confidence is left alone rather than guessed at.
"""
from __future__ import annotations

import json
import logging
import os
import re
import time
from dataclasses import dataclass
from difflib import SequenceMatcher
from urllib.parse import quote, unquote

log = logging.getLogger("anisubarr.local_subs")

# Plain subtitle files plus the archives extract_subtitle_bytes() can unpack —
# dropping the ZIP straight from a provider's site works without unpacking it.
SUB_EXTS = (".srt", ".ass", ".ssa", ".vtt")
ARCHIVE_EXTS = (".zip", ".rar")
ALL_EXTS = SUB_EXTS + ARCHIVE_EXTS

URL_SCHEME = "local://"

PROVIDER_TYPE = "local"
DEFAULT_FOLDER_NAME = "manual-subs"

# Walking the tree is cheap but happens once per episode during a bulk run, so
# a short-lived index keeps a 500-episode job from re-scanning 500 times.
_INDEX_TTL = 20.0
_MAX_FILES = 20_000
_index_cache: dict[str, tuple[float, list["Entry"]]] = {}

# Titles never contain these; dropping them keeps "Frieren.S01E05.1080p.WEB-DL"
# from being compared as if the release tags were part of the show's name.
_NOISE_WORDS = {
    "1080p", "720p", "480p", "2160p", "4k", "uhd", "hdr",
    "bluray", "blu", "ray", "bdrip", "brrip", "bdremux", "remux",
    "web", "webrip", "webdl", "dl", "hdtv", "dvdrip",
    "x264", "x265", "h264", "h265", "hevc", "avc", "av1",
    "aac", "ac3", "eac3", "ddp", "flac", "opus", "10bit", "8bit", "dual",
    "titulky", "titles", "subs", "sub", "subtitles", "cz", "cs", "cze", "ces",
    "sk", "slo", "slk", "en", "eng", "final", "fixed", "complete",
    # File extensions — the name is normalised whole, so without these every
    # haystack would carry a "srt" nobody meant as part of the title.
    "srt", "ass", "ssa", "vtt", "zip", "rar",
    # Season wording: "Frieren 1. serie - 05" is still Frieren.
    "season", "serie", "série", "series", "rada", "řada", "sezona", "sezóna",
    "epizoda", "episode", "dil", "díl",
}

_RELEASE_NOISE_RE = re.compile(
    r"\b(?:\d{3,4}p|x26[45]|h\.?26[45]|hevc|10bit|8bit|bd(?:rip|remux)?|"
    r"blu-?ray|web-?dl|webrip|hdtv|dvdrip|remux|aac\d?|e?ac3|ddp?\d?)\b",
    re.IGNORECASE,
)

# Season + episode in one token.
_SE_PATTERNS = (
    re.compile(r"s(\d{1,2})[\s._-]*e(\d{1,3})", re.IGNORECASE),
    re.compile(r"(?<!\d)(\d{1,2})x(\d{1,3})(?!\d)"),
)
# Episode only — the season then comes from the folder, or is assumed to be 1.
# Ordered from most explicit to loosest; the last one is a plain number, which
# is only reached when nothing better said anything.
_EP_PATTERNS = (
    re.compile(r"(?:^|[\s._\-\[(#])(?:e|ep|episode|epizoda|dil|díl)[\s._-]*(\d{1,3})(?:v\d)?(?!\d)",
               re.IGNORECASE),
    # "Show - 05" and "Sousou-no-Frieren-05" alike: the dash needs no space
    # around it, because plenty of files are written without one.
    re.compile(r"-[\s._]*(\d{1,3})(?:v\d)?(?!\d)"),
    re.compile(r"[\[(](\d{1,3})(?:v\d)?[\])]"),
    re.compile(r"^(\d{1,3})$"),
    # Bare number in the middle: "Frieren 05 CZ". Loose on purpose and last in
    # line — release tags are stripped before this runs, and years don't fit in
    # three digits, so what's left is nearly always the episode.
    re.compile(r"(?:^|[\s._])(\d{1,3})(?:v\d)?(?=$|[\s._\-\])])"),
)
# "Show - 2 - 05" puts the season first and the episode last, so for these
# conventions the *last* number is the episode, not the first one found.
_LAST_MATCH_PATTERNS = {_EP_PATTERNS[1], _EP_PATTERNS[4]}
_SEASON_IN_FOLDER_RE = re.compile(
    r"(?:season|serie|série|series|řada|rada|s)[\s._-]*(\d{1,2})(?!\d)", re.IGNORECASE
)

# Language tag in the file name (Show.S01E05.cs.srt). Anything else in the name
# is ignored on purpose: release groups like [SubsPlease] would otherwise make
# a hand-picked Czech file look English.
_LANG_TAG = {
    "cs": "cs", "cz": "cs", "ces": "cs", "cze": "cs", "czech": "cs", "cesky": "cs",
    "sk": "sk", "slo": "sk", "slk": "sk", "slovak": "sk",
    "en": "en", "eng": "en", "english": "en",
    "pl": "pl", "pol": "pl", "de": "de", "ger": "de", "deu": "de",
    "hu": "hu", "ro": "ro", "fr": "fr", "es": "es", "ru": "ru",
    "ja": "ja", "jpn": "ja", "jp": "ja",
}
_CS_EQUIVALENT = {"cs", "cz", "ces", "cze"}

# Below this the name is too short for substring matching to mean anything
# ("05" is contained in half the strings in existence).
_MIN_CONTAINMENT = 4
_TITLE_THRESHOLD = 0.75


# ── configuration ────────────────────────────────────────────────────────────

def default_folder() -> str:
    """Inside the data directory, so the existing volume already persists it."""
    from ..config import data_dir
    return os.path.join(str(data_dir()), DEFAULT_FOLDER_NAME)


def folder_path(db=None) -> str:
    """Registry row (host) → DB setting → .env → default under the data dir."""
    if db is not None:
        try:
            from ..models.service import Service
            row = (
                db.query(Service)
                .filter(Service.type == PROVIDER_TYPE)
                .order_by(Service.id)
                .first()
            )
            if row and (row.host or "").strip():
                return (row.host or "").strip()
        except Exception:
            pass

    return configured_folder(db) or default_folder()


def configured_folder(db=None) -> str:
    """The path someone actually configured (setting or LOCAL_SUBTITLE_DIR), or
    "" when nobody did. Kept separate from the registry row so a row that was
    only auto-seeded can tell it apart from a deliberate choice."""
    try:
        from ..utils.settings_helper import read_setting
        configured = (read_setting("local_subtitle_dir", db) or "").strip()
        if configured:
            return configured
    except Exception:
        pass

    try:
        from ..config import get_settings
        return (get_settings().local_subtitle_dir or "").strip()
    except Exception:
        return ""


def ensure_folder(db=None) -> str:
    """Create the folder if it isn't there yet. Never raises — a read-only mount
    means "no local subtitles", not "app won't start"."""
    path = folder_path(db)
    try:
        os.makedirs(path, exist_ok=True)
    except OSError as exc:
        log.warning("[local] ruční složku %s nelze vytvořit: %s", path, exc)
    return path


# ── index ────────────────────────────────────────────────────────────────────

@dataclass
class Entry:
    path: str                    # absolute path on disk
    rel: str                     # path relative to the folder root
    name: str                    # file name as-is
    season: int | None
    episode: int | None
    lang: str | None             # only when the name states it
    haystacks: tuple[str, ...]   # normalised name + folder names above it
    mtime: float
    size: int


def normalise(text: str) -> str:
    """Lower-case, punctuation-free, release-tag-free form used for comparison."""
    text = re.sub(r"[\[(][^\])]*[\])]", " ", text or "")   # [group] / (info)
    text = _RELEASE_NOISE_RE.sub(" ", text)
    text = re.sub(r"[^0-9a-zA-ZÀ-ɏ]+", " ", text)
    words = [w for w in text.lower().split() if w and w not in _NOISE_WORDS]
    return " ".join(words)


def _lang_of(name: str) -> str | None:
    """Language stated in the name, or None when it says nothing."""
    stem = os.path.splitext(name)[0]
    for token in reversed(re.split(r"[.\s_\-\[\]()]+", stem)):
        tag = _LANG_TAG.get(token.lower())
        if tag:
            return tag
    return None


def parse_name(name: str, folders: tuple[str, ...] = ()) -> tuple[str, int | None, int | None]:
    """(title part, season, episode) read out of a file name.

    The title part is whatever stands *before* the episode marker — that is the
    piece worth comparing against the show's names. Comparing the whole file
    name instead fails on the most common case of all: a file called
    "Frieren - 05.srt" for a show the library calls "Sousou no Frieren".

    Season falls back to the folder above the file. Season and episode may be
    None when the name simply doesn't say.
    """
    stem = os.path.splitext(name)[0]
    cleaned = _RELEASE_NOISE_RE.sub(" ", stem)

    for pattern in _SE_PATTERNS:
        m = pattern.search(cleaned)
        if m:
            return cleaned[:m.start()], int(m.group(1)), int(m.group(2))

    season = None
    for folder in folders:
        m = _SEASON_IN_FOLDER_RE.search(folder)
        if m:
            season = int(m.group(1))
            break

    for pattern in _EP_PATTERNS:
        matches = list(pattern.finditer(cleaned.strip()))
        if matches:
            m = matches[-1] if pattern in _LAST_MATCH_PATTERNS else matches[0]
            return cleaned[:m.start()], season, int(m.group(1))

    return cleaned, season, None


def parse_numbers(name: str, folders: tuple[str, ...] = ()) -> tuple[int | None, int | None]:
    """(season, episode) — see parse_name()."""
    _, season, episode = parse_name(name, folders)
    return season, episode


def _build_index(root: str) -> list[Entry]:
    entries: list[Entry] = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if not d.startswith(".")]
        for fname in filenames:
            if fname.startswith("."):
                continue
            if os.path.splitext(fname)[1].lower() not in ALL_EXTS:
                continue
            full = os.path.join(dirpath, fname)
            rel = os.path.relpath(full, root)
            folders = tuple(reversed(os.path.dirname(rel).split(os.sep))) if os.path.dirname(rel) else ()
            folders = tuple(f for f in folders if f not in ("", "."))
            title_part, season, episode = parse_name(fname, folders)
            try:
                stat = os.stat(full)
                mtime, size = stat.st_mtime, stat.st_size
            except OSError:
                mtime, size = 0.0, 0
            # Title part first (the most meaningful), then the whole name, then
            # the folders above it — any of the three may be the one that names
            # the show, depending on how the file was organised.
            haystacks = (normalise(title_part), normalise(fname),
                         *(normalise(f) for f in folders))
            seen: list[str] = []
            for h in haystacks:
                if h and h not in seen:
                    seen.append(h)
            entries.append(Entry(
                path=full, rel=rel, name=fname,
                season=season, episode=episode, lang=_lang_of(fname),
                haystacks=tuple(seen),
                mtime=mtime, size=size,
            ))
            if len(entries) >= _MAX_FILES:
                log.warning("[local] ruční složka má víc než %d souborů — zbytek ignorován", _MAX_FILES)
                return entries
    return entries


def index(root: str, refresh: bool = False) -> list[Entry]:
    """Indexed contents of the folder, cached for a few seconds."""
    now = time.monotonic()
    cached = _index_cache.get(root)
    if cached and not refresh and now - cached[0] < _INDEX_TTL:
        return cached[1]
    if not os.path.isdir(root):
        _index_cache[root] = (now, [])
        return []
    entries = _build_index(root)
    _index_cache[root] = (now, entries)
    return entries


def invalidate_cache() -> None:
    _index_cache.clear()


# ── matching ─────────────────────────────────────────────────────────────────

def title_score(candidates: list[str], haystacks: tuple[str, ...]) -> float:
    """How well any known title of the show matches the file/folder names, 0–1.

    Containment counts both ways — a file named "Frieren - 05" belongs to
    "Sousou no Frieren" and vice versa — but scores below an exact hit, so when
    several files could serve the episode the closest name wins.
    """
    best = 0.0
    for cand in candidates:
        if not cand:
            continue
        cand_tokens = set(cand.split())
        for hay in haystacks:
            if cand == hay:
                return 1.0
            if len(hay) < _MIN_CONTAINMENT:
                continue          # "05" is a substring of half the strings alive
            if cand in hay or hay in cand:
                best = max(best, 0.95)
                continue
            tokens = [t for t in cand.split() if len(t) >= 3]
            if tokens and all(t in hay for t in tokens):
                best = max(best, 0.9)
                continue
            # The other direction: the file names the show by a shorter alias
            # ("Frieren" for "Sousou no Frieren"). One token has to carry real
            # weight, otherwise a stray "the" would match everything.
            hay_tokens = [t for t in hay.split() if len(t) >= 3]
            if (hay_tokens and max(len(t) for t in hay_tokens) >= 4
                    and all(t in cand_tokens for t in hay_tokens)):
                best = max(best, 0.85)
                continue
            best = max(best, SequenceMatcher(None, cand, hay).ratio())
    return best


def series_titles(series) -> list[str]:
    """Every name the show is known by, normalised. Alternates included because
    hand-downloaded files are usually named after the release, not after Sonarr."""
    raw = [
        getattr(series, "title", None),
        getattr(series, "title_romaji", None),
        getattr(series, "title_english", None),
        getattr(series, "title_japanese", None),
        getattr(series, "sort_title", None),
    ]
    alternates = getattr(series, "alternate_titles", None)
    if alternates:
        try:
            parsed = json.loads(alternates)
            if isinstance(parsed, list):
                raw.extend(
                    x.get("title") if isinstance(x, dict) else x for x in parsed
                )
        except Exception:
            pass
    out: list[str] = []
    for value in raw:
        norm = normalise(value) if isinstance(value, str) else ""
        if norm and norm not in out:
            out.append(norm)
    return out


def _episode_matches(entry: Entry, season: int | None, episode: int | None,
                     absolute: int | None) -> bool:
    if episode is None or entry.episode is None:
        return False
    if entry.season is not None and season is not None:
        return entry.season == season and entry.episode == episode
    # Name states no season: anime files usually don't. Accept the plain episode
    # number for season 1, and the absolute number for later seasons — that's
    # how "Show - 25.srt" maps to S02E13.
    if entry.episode == episode and (season in (None, 1)):
        return True
    return absolute is not None and entry.episode == absolute


def _language_ok(entry: Entry, language: str) -> bool:
    """A file that states a different language is not a candidate; one that says
    nothing is taken at face value — the user put it there for this purpose."""
    if entry.lang is None:
        return True
    wanted = "cs" if language in _CS_EQUIVALENT else language
    return entry.lang == wanted


# ── scraper-shaped provider ──────────────────────────────────────────────────

class LocalFolderScraper:
    """Same shape as the web scrapers, backed by a folder on disk."""

    def __init__(self, root: str, db=None):
        self.root = root
        self.db = db

    # search ------------------------------------------------------------------

    def search(
        self,
        title: str,
        season: int | None = None,
        episode: int | None = None,
        language: str = "cs",
        status_cb=None,
        titles: list[str] | None = None,
        absolute: int | None = None,
    ) -> list[dict]:
        def _log(msg: str) -> None:
            if status_cb:
                status_cb(f"  [Ruční složka] {msg}")

        if episode is None:
            return []
        if not os.path.isdir(self.root):
            _log(f"složka {self.root} neexistuje")
            return []

        candidates = [normalise(t) for t in (titles or [])]
        if not candidates:
            candidates = self._known_titles(title)
        candidates = [c for c in candidates if c]
        if absolute is None:
            absolute = self._absolute_number(title, season, episode)

        entries = index(self.root)
        _log(f"souborů ve složce {self.root}: {len(entries)}")

        scored: list[tuple[float, Entry]] = []
        for entry in entries:
            if not _episode_matches(entry, season, episode, absolute):
                continue
            if not _language_ok(entry, language):
                continue
            score = title_score(candidates, entry.haystacks)
            if score >= _TITLE_THRESHOLD:
                scored.append((score, entry))

        # Best title match first, newest file next — a re-download the user just
        # dropped should win over something that has been sitting there for weeks.
        scored.sort(key=lambda pair: (-pair[0], -pair[1].mtime))
        _log(f"shody pro S{season or 0:02d}E{episode:02d}: {len(scored)}")

        return [self._result(entry, score, language) for score, entry in scored]

    def _result(self, entry: Entry, score: float, language: str) -> dict:
        return {
            "source": PROVIDER_TYPE,
            "title": entry.name,
            "language": entry.lang or ("cs" if language in _CS_EQUIVALENT else language),
            "url": f"{URL_SCHEME}{quote(entry.rel.replace(os.sep, '/'))}",
            "rating": "",
            "uploader": os.path.dirname(entry.rel) or "ruční složka",
            "notes": "ruční" + ("" if entry.lang else " (jazyk neuveden)"),
            "match": round(score, 2),
            "size": entry.size,
        }

    def _series_row(self, title: str):
        if self.db is None or not title:
            return None
        try:
            from ..models.series import Series
            return self.db.query(Series).filter(Series.title == title).first()
        except Exception:
            return None

    def _known_titles(self, title: str) -> list[str]:
        """Alternate titles for the show, so a romaji-named file still matches."""
        row = self._series_row(title)
        if row is not None:
            found = series_titles(row)
            if found:
                return found
        return [normalise(title)]

    def _absolute_number(self, title: str, season: int | None, episode: int | None) -> int | None:
        row = self._series_row(title)
        if row is None or season is None or episode is None:
            return None
        try:
            from ..models.series import Episode
            ep = (
                self.db.query(Episode)
                .filter(Episode.series_id == row.id,
                        Episode.season_number == season,
                        Episode.episode_number == episode)
                .first()
            )
            return getattr(ep, "absolute_episode_number", None) if ep else None
        except Exception:
            return None

    # download ---------------------------------------------------------------

    def download(self, url: str) -> bytes:
        with open(resolve_url(url, self.root), "rb") as fh:
            return fh.read()


def resolve_url(url: str, root: str) -> str:
    """Absolute path for a ``local://`` url, confined to the folder.

    The url reaches us from the client, so it is treated as hostile input: no
    absolute paths, no ``..``, and the resolved result (symlinks included) has
    to stay under the root.
    """
    rel = url[len(URL_SCHEME):] if url.startswith(URL_SCHEME) else url
    rel = unquote(rel).replace("\\", "/").lstrip("/")
    if not rel or os.path.isabs(rel) or ".." in rel.split("/"):
        raise ValueError("Neplatná cesta k titulku v ruční složce")
    root_real = os.path.realpath(root)
    full = os.path.realpath(os.path.join(root_real, *rel.split("/")))
    if full != root_real and not full.startswith(root_real + os.sep):
        raise ValueError("Cesta míří mimo ruční složku")
    if not os.path.isfile(full):
        raise FileNotFoundError(f"Soubor v ruční složce už neexistuje: {rel}")
    return full


# ── status for the UI ────────────────────────────────────────────────────────

def folder_status(db=None, report: bool = False, limit: int = 200) -> dict:
    """Folder state, and optionally what each file in it would be used for.

    The report exists so a drop that didn't work isn't a black box: it names the
    episode a file was matched to, or why it couldn't be.
    """
    root = folder_path(db)
    exists = os.path.isdir(root)
    status: dict = {
        "path": root,
        "exists": exists,
        "writable": bool(exists and os.access(root, os.W_OK)),
        "files": 0,
        "languages": {},
    }
    if not exists:
        return status

    entries = index(root, refresh=True)
    status["files"] = len(entries)
    for entry in entries:
        key = entry.lang or "?"
        status["languages"][key] = status["languages"].get(key, 0) + 1

    if report and db is not None:
        status["report"] = _match_report(db, entries[:limit])
        status["truncated"] = len(entries) > limit
    return status


def _match_report(db, entries: list[Entry]) -> list[dict]:
    from ..models.series import Episode, Series

    series_rows = db.query(Series).all()
    catalog = [(row, series_titles(row)) for row in series_rows]

    out: list[dict] = []
    for entry in entries:
        row: dict = {"file": entry.rel, "language": entry.lang}
        if entry.episode is None:
            row["reason"] = "v názvu není číslo epizody"
            out.append(row)
            continue

        best_series, best_score = None, 0.0
        for series, titles in catalog:
            score = title_score(titles, entry.haystacks)
            if score > best_score:
                best_series, best_score = series, score

        if best_series is None or best_score < _TITLE_THRESHOLD:
            row["reason"] = "neznámý seriál"
            out.append(row)
            continue

        row["series"] = best_series.title
        episodes = (
            db.query(Episode)
            .filter(Episode.series_id == best_series.id)
            .all()
        )
        match = next(
            (ep for ep in episodes
             if _episode_matches(entry, ep.season_number, ep.episode_number,
                                 ep.absolute_episode_number)),
            None,
        )
        if match is None:
            row["reason"] = "epizoda v knihovně není"
        else:
            row["episode"] = f"S{match.season_number:02d}E{match.episode_number:02d}"
            row["episode_id"] = match.id
        out.append(row)
    return out
