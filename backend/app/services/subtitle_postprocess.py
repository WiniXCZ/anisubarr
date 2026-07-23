"""
subtitle_postprocess.py – Post-download subtitle transformations (Sub-Zero style).

Applies configurable transformations to downloaded subtitle files:
  - UTF-8 re-encoding
  - Remove HTML / ASS style tags
  - Remove emoji and music symbols
  - OCR artifact correction
  - Common whitespace / punctuation fixes
"""

from __future__ import annotations

import re
import os

# ──────────────────────────────────────────
# Regex patterns
# ──────────────────────────────────────────

# HTML tags (<b>, <i>, <font color=...>, etc.) and ASS override tags ({\\an8}, {\\b1})
_TAG_RE = re.compile(r'<[^>]+>|\{[^}]*\}', re.DOTALL)

# Emoji and musical symbols
_EMOJI_RE = re.compile(
    "["
    "\U0001F600-\U0001F64F"   # emoticons
    "\U0001F300-\U0001F5FF"   # symbols & pictographs
    "\U0001F680-\U0001F6FF"   # transport & map
    "\U0001F1E0-\U0001F1FF"   # flags
    "\U00002702-\U000027B0"
    "\U000024C2-\U0001F251"
    "\U0001F900-\U0001F9FF"
    "\U00002600-\U000026FF"
    "♪♫♩♬♭♮♯"                 # music notes
    "]+",
    flags=re.UNICODE,
)

# Simple OCR character substitutions (single-char, safe to replace globally)
_OCR_CHAR_FIXES: list[tuple[str, str]] = [
    ("’", "'"),   # RIGHT SINGLE QUOTATION MARK → apostrophe
    ("‘", "'"),   # LEFT SINGLE QUOTATION MARK
    ("“", '"'),   # LEFT DOUBLE QUOTATION MARK
    ("”", '"'),   # RIGHT DOUBLE QUOTATION MARK
    ("–", "-"),   # EN DASH
    ("—", "--"),  # EM DASH
    ("\xa0",   " "),   # NON-BREAKING SPACE
    ("…", "..."), # HORIZONTAL ELLIPSIS
]


# ──────────────────────────────────────────
# Encoding helpers
# ──────────────────────────────────────────

def _decode(raw: bytes) -> tuple[str, str]:
    """Try a cascade of encodings. Returns (text, encoding_used)."""
    for enc in ("utf-8-sig", "utf-8", "cp1250", "iso-8859-2", "windows-1252", "latin-1"):
        try:
            return raw.decode(enc), enc
        except (UnicodeDecodeError, LookupError):
            continue
    return raw.decode("utf-8", errors="replace"), "utf-8"


# ──────────────────────────────────────────
# Transformation helpers
# ──────────────────────────────────────────

def _apply_remove_tags(text: str) -> str:
    return _TAG_RE.sub("", text)


def _apply_remove_emoji(text: str) -> str:
    return _EMOJI_RE.sub("", text)


def _apply_ocr_fixes(text: str) -> str:
    for bad, good in _OCR_CHAR_FIXES:
        text = text.replace(bad, good)
    # Four-or-more dots → ellipsis
    text = re.sub(r"\.{4,}", "...", text)
    return text


def _apply_common_fixes(text: str) -> str:
    # Collapse runs of 3+ spaces to one space (but leave blank lines)
    text = re.sub(r"  +", " ", text)
    # Remove trailing spaces on each line
    text = re.sub(r" +$", "", text, flags=re.MULTILINE)
    # Remove space before common punctuation
    text = re.sub(r" ([,!?])", r"\1", text)
    # Ensure single newline at end
    text = text.rstrip() + "\n"
    return text


# ──────────────────────────────────────────
# Public API
# ──────────────────────────────────────────

def process_subtitle_file(path: str, cfg: dict) -> None:
    """Apply enabled transformations to a subtitle file in-place.

    cfg keys (all optional bool, default False):
      encode_utf8   — always re-write as UTF-8 (even if no other transforms needed)
      remove_tags   — strip HTML / ASS style tags
      remove_emoji  — strip emoji and music-note characters
      ocr_fixes     — fix common Unicode/OCR artefacts
      common_fixes  — collapse whitespace, remove trailing spaces
    """
    if not os.path.isfile(path):
        return

    try:
        with open(path, "rb") as fh:
            raw = fh.read()
    except Exception:
        return

    text, src_enc = _decode(raw)
    modified = False

    if cfg.get("remove_tags"):
        new = _apply_remove_tags(text)
        if new != text:
            text, modified = new, True

    if cfg.get("remove_emoji"):
        new = _apply_remove_emoji(text)
        if new != text:
            text, modified = new, True

    if cfg.get("ocr_fixes"):
        new = _apply_ocr_fixes(text)
        if new != text:
            text, modified = new, True

    if cfg.get("common_fixes"):
        new = _apply_common_fixes(text)
        if new != text:
            text, modified = new, True

    need_write = modified or cfg.get("encode_utf8", False) and src_enc not in ("utf-8", "utf-8-sig")

    if need_write:
        try:
            with open(path, "w", encoding="utf-8", newline="\n") as fh:
                fh.write(text)
        except Exception:
            pass
