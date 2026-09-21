"""
subtitle_cleanup.py — tidy a subtitle on its way to the disk.

Eight switches for this lived in the settings whitelist and nothing read any
of them: the user turned them on and the file was written exactly as it came
off the provider. This is the code behind the ones that can be honoured.

Every step is off by default and applies to the text only. Timings are never
touched, and neither is the video — a subtitle sits beside the episode, and
the episode is a hardlink to a file that is still being seeded.

ASS is treated with more care than SRT. Its override blocks (``{\\an8}``,
``{\\pos(…)}``) are not decoration around the text, they are how a sign gets
placed over the right part of the picture; stripping them turns a typeset
release into a pile of captions in the middle of the screen. So tag removal
covers the HTML-ish markup that appears in both formats, and leaves ASS
overrides alone.
"""
from __future__ import annotations

import logging
import re

log = logging.getLogger("anisubarr.subtitle_cleanup")

# The settings this module answers to, in the order they are applied.
STEPS = ("encode_utf8", "remove_tags", "remove_emoji",
         "ocr_fixes", "common_fixes")

_ENCODINGS = ("utf-8-sig", "utf-8", "cp1250", "iso-8859-2", "cp1252", "latin-1")

_HTML_TAG = re.compile(r"</?(?:i|b|u|s|font|br)(?:\s[^<>]*)?/?>", re.IGNORECASE)

# Emoji blocks plus the music notes that karaoke lines are wrapped in.
_EMOJI = re.compile(
    "[\U0001F000-\U0001FAFF\U00002600-\U000027BF\U0001F1E6-\U0001F1FF"
    "\U00002190-\U000021FF\U00002B00-\U00002BFF♠-♧♪-♯]+"
)

_OCR_REPLACEMENTS = {
    "„": '"', "“": '"', "”": '"',   # „ “ ”
    "‘": "'", "’": "'",                   # ‘ ’
    "…": "...",                                # …
    " ": " ",                                  # non-breaking space
    "–": "-", "—": "-",                   # – —
    "﻿": "",                                   # stray BOM mid-file
}


def decode(raw: bytes) -> str:
    """Bytes to text, trying the encodings Czech subtitles actually arrive in."""
    for enc in _ENCODINGS:
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def _strip_tags(text: str, is_ass: bool) -> str:
    text = _HTML_TAG.sub("", text)
    if not is_ass:
        # A stray {…} in an SRT is a leftover from a converted ASS file, not
        # formatting anyone chose.
        text = re.sub(r"\{\\[^}]*\}", "", text)
    return text


def _common_fixes(text: str) -> str:
    lines = [line.rstrip() for line in text.splitlines()]
    out: list[str] = []
    blank = 0
    for line in lines:
        # Runs of spaces inside a line are almost always a conversion artefact;
        # leading spaces are how some releases indent a second speaker, so only
        # the trailing ones go.
        line = re.sub(r"[ \t]{2,}", " ", line)
        if line.strip():
            blank = 0
            out.append(line)
        else:
            blank += 1
            if blank <= 1:          # one blank line separates cues; more is noise
                out.append("")
    return "\n".join(out).strip("\n") + "\n"


def clean(raw: bytes, ext: str, options: dict) -> bytes:
    """Apply the enabled steps and return the bytes to write.

    ``options`` maps a step name from :data:`STEPS` to a bool. Anything that
    goes wrong leaves the file exactly as it arrived — a subtitle that could
    not be tidied is still a subtitle, and losing it to a cleanup step would
    be a far worse outcome than a stray ``<i>``.
    """
    if not any(options.get(step) for step in STEPS):
        return raw

    try:
        text = decode(raw)
        is_ass = (ext or "").lower() in ("ass", "ssa")

        if options.get("remove_tags"):
            text = _strip_tags(text, is_ass)
        if options.get("remove_emoji"):
            text = _EMOJI.sub("", text)
        if options.get("ocr_fixes"):
            for bad, good in _OCR_REPLACEMENTS.items():
                text = text.replace(bad, good)
        if options.get("common_fixes"):
            text = _common_fixes(text)

        # encode_utf8 is the reason this returns bytes at all: reading the file
        # and writing it back is what converts it, so it happens whenever any
        # step ran. The switch decides whether a file that needed no other
        # change is rewritten just for its encoding.
        return text.encode("utf-8")
    except Exception as exc:
        log.warning("[cleanup] úprava titulku se nepovedla (%s) — ukládám ho, "
                    "jak přišel", exc)
        return raw


def options_from_settings(db) -> dict:
    """Read the switches. Unset means off."""
    from ..utils.settings_helper import read_setting
    out = {}
    for step in STEPS:
        try:
            out[step] = (read_setting(f"subtitle_{step}", db) or "").strip().lower() \
                in ("true", "1", "yes")
        except Exception:
            out[step] = False
    return out
