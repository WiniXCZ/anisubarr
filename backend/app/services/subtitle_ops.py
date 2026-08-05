"""
subtitle_ops.py – the operations every subtitle editor has, on plain cue lists.

Anisubarr could shift a whole file by a fixed number of milliseconds and edit
one line's text. That covers the easiest half of what goes wrong with a
hand-downloaded subtitle and none of the rest: a file timed for a 25 fps
broadcast drifts further out the longer the episode runs and no shift will ever
line it up, overlapping cues make a player flash two lines at once, and a cue
that shows 90 characters for 0.4 s is unreadable no matter how correct the
timing is.

Everything here is a pure function over ``[{"start": float, "end": float,
"text": str}]`` — the shape ``subtitle_lines.py`` already parses SRT and ASS
into. Nothing reads or writes a file, so the editor can preview a change, let
it be undone, and save once, instead of rewriting the file per keystroke.
"""
from __future__ import annotations

import re

# What "readable" means. The numbers are the usual subtitling conventions
# (Netflix, BBC): a line longer than ~42 characters doesn't fit the screen, more
# than two lines covers the picture, and above ~21 characters per second an
# average reader can't keep up.
MAX_CPS = 21.0
MAX_LINE_LEN = 42
MAX_LINES = 2
MIN_DURATION = 1.0
MAX_DURATION = 7.0
# Two cues that touch exactly would make a player redraw for nothing, so a fixed
# overlap is pulled back by one frame's worth of time rather than to zero.
FRAME_GAP = 0.042

_TAG_RE = re.compile(r"<[^>]+>|\{[^}]*\}")
_SPACE_RE = re.compile(r"[ \t]{2,}")
_SPACE_BEFORE_PUNCT_RE = re.compile(r"\s+([,.!?;:])")


def visible_text(text: str) -> str:
    """The text a viewer actually reads — markup contributes nothing."""
    return _TAG_RE.sub("", text or "")


def cps(cue: dict) -> float:
    """Characters per second. 0 for a cue with no duration, not infinity."""
    duration = (cue.get("end") or 0) - (cue.get("start") or 0)
    if duration <= 0:
        return 0.0
    chars = len(visible_text(cue.get("text", "")).replace("\n", ""))
    return round(chars / duration, 1)


def _sorted(lines: list[dict]) -> list[dict]:
    return sorted((dict(c) for c in lines), key=lambda c: (c.get("start") or 0))


def _renumber(lines: list[dict]) -> list[dict]:
    for i, cue in enumerate(lines, start=1):
        cue["id"] = i
    return lines


# ── analysis ─────────────────────────────────────────────────────────────────

def analyze(lines: list[dict]) -> dict:
    """Per-cue problems plus a count of each kind.

    This is the part that tells someone *which* of 400 lines to look at. Every
    issue named here has a matching rule in :func:`fix`, so the report doubles
    as the list of what can be repaired automatically.
    """
    cues = _sorted(lines)
    issues: dict[int, list[str]] = {}
    summary: dict[str, int] = {}

    def flag(index: int, kind: str) -> None:
        issues.setdefault(index, []).append(kind)
        summary[kind] = summary.get(kind, 0) + 1

    for i, cue in enumerate(cues):
        start = cue.get("start") or 0
        end = cue.get("end") or 0
        text = visible_text(cue.get("text", "")).strip()

        if not text:
            flag(i, "empty")
        if end <= start:
            flag(i, "negative")
        else:
            if end - start < MIN_DURATION:
                flag(i, "short")
            if end - start > MAX_DURATION:
                flag(i, "long")
            if cps(cue) > MAX_CPS:
                flag(i, "fast")

        text_lines = text.split("\n")
        if len(text_lines) > MAX_LINES:
            flag(i, "lines")
        if any(len(line) > MAX_LINE_LEN for line in text_lines):
            flag(i, "wide")
        if i + 1 < len(cues) and end > (cues[i + 1].get("start") or 0):
            flag(i, "overlap")

    return {
        "count": len(cues),
        "issues": {str(k): v for k, v in issues.items()},
        "summary": summary,
        "cps": [cps(c) for c in cues],
        "duration": max((c.get("end") or 0) for c in cues) if cues else 0,
    }


# ── fixes ────────────────────────────────────────────────────────────────────

ALL_RULES = ("order", "empty", "spaces", "tags", "duplicates",
             "overlap", "min_duration", "max_duration")


def fix(lines: list[dict], rules: list[str] | None = None) -> dict:
    """Apply the named repairs. Returns the new cues and what each rule changed.

    Rules are opt-in and reported separately because they are not equally safe:
    dropping empty cues is uncontroversial, stripping ``<i>`` throws away
    styling somebody may have wanted. Nobody should have to diff a 400-line file
    to find out what a "fix everything" button did.
    """
    chosen = [r for r in (rules if rules is not None else ALL_RULES) if r in ALL_RULES]
    cues = [dict(c) for c in lines]
    report = {r: 0 for r in chosen}

    if "order" in chosen:
        ordered = _sorted(cues)
        if [c.get("start") for c in ordered] != [c.get("start") for c in cues]:
            report["order"] = sum(1 for a, b in zip(cues, ordered) if a is not b)
        cues = ordered

    if "tags" in chosen:
        for cue in cues:
            stripped = _TAG_RE.sub("", cue.get("text", ""))
            if stripped != cue.get("text"):
                cue["text"] = stripped
                report["tags"] += 1

    if "spaces" in chosen:
        for cue in cues:
            tidy = "\n".join(
                _SPACE_BEFORE_PUNCT_RE.sub(r"\1", _SPACE_RE.sub(" ", line)).strip()
                for line in (cue.get("text") or "").split("\n")
            ).strip()
            if tidy != cue.get("text"):
                cue["text"] = tidy
                report["spaces"] += 1

    if "empty" in chosen:
        kept = [c for c in cues if visible_text(c.get("text", "")).strip()]
        report["empty"] = len(cues) - len(kept)
        cues = kept

    if "duplicates" in chosen:
        merged: list[dict] = []
        for cue in cues:
            prev = merged[-1] if merged else None
            same = prev is not None and (prev.get("text") or "").strip() == (cue.get("text") or "").strip()
            # Only a cue that continues the previous one — a line repeated later
            # in the episode is a different line, not a duplicate.
            touching = prev is not None and (cue.get("start") or 0) - (prev.get("end") or 0) <= 0.5
            if same and touching:
                prev["end"] = max(prev.get("end") or 0, cue.get("end") or 0)
                report["duplicates"] += 1
            else:
                merged.append(cue)
        cues = merged

    if "min_duration" in chosen:
        for i, cue in enumerate(cues):
            start, end = cue.get("start") or 0, cue.get("end") or 0
            if end - start >= MIN_DURATION:
                continue
            # Growing into the next cue would only trade one problem for another.
            ceiling = (cues[i + 1].get("start") or 0) - FRAME_GAP if i + 1 < len(cues) else start + MIN_DURATION
            wanted = min(start + MIN_DURATION, max(ceiling, end))
            if wanted > end:
                cue["end"] = round(wanted, 3)
                report["min_duration"] += 1

    if "max_duration" in chosen:
        for cue in cues:
            start, end = cue.get("start") or 0, cue.get("end") or 0
            if end - start > MAX_DURATION:
                cue["end"] = round(start + MAX_DURATION, 3)
                report["max_duration"] += 1

    if "overlap" in chosen:
        for i in range(len(cues) - 1):
            end = cues[i].get("end") or 0
            next_start = cues[i + 1].get("start") or 0
            if end <= next_start:
                continue
            pulled = round(next_start - FRAME_GAP, 3)
            # A cue that would end before it starts is a timing error the shift
            # can't resolve; leave it for the report rather than invert it.
            if pulled > (cues[i].get("start") or 0):
                cues[i]["end"] = pulled
                report["overlap"] += 1

    return {"lines": _renumber(cues), "report": {k: v for k, v in report.items() if v}}


# ── timing ───────────────────────────────────────────────────────────────────

def shift(lines: list[dict], seconds: float, from_index: int = 0) -> list[dict]:
    """Move cues in time. ``from_index`` shifts only from that cue onward.

    Shifting the tail is what fixes a file that was correct until an ad break or
    a missing scene — shifting everything would break the part that was fine.
    """
    cues = _sorted(lines)
    for cue in cues[max(0, from_index):]:
        cue["start"] = round(max(0.0, (cue.get("start") or 0) + seconds), 3)
        cue["end"] = round(max(0.0, (cue.get("end") or 0) + seconds), 3)
    return _renumber(_sorted(cues))


def scale(lines: list[dict], factor: float, anchor: float = 0.0) -> list[dict]:
    """Stretch time by ``factor`` around ``anchor``.

    This is the fix a shift cannot do: a subtitle timed for 25 fps played at
    23.976 drifts a little further out with every minute, so the correction has
    to grow with the timestamp.
    """
    if factor <= 0:
        raise ValueError("Poměr musí být kladný")
    cues = _sorted(lines)
    for cue in cues:
        cue["start"] = round(max(0.0, anchor + ((cue.get("start") or 0) - anchor) * factor), 3)
        cue["end"] = round(max(0.0, anchor + ((cue.get("end") or 0) - anchor) * factor), 3)
    return _renumber(cues)


def sync_two_points(lines: list[dict], first: tuple[float, float],
                    second: tuple[float, float]) -> list[dict]:
    """Line the file up from two cues whose real time in the video is known.

    Someone watching finds the first line and a line near the end, notes when
    each is actually spoken, and the drift between them gives both the stretch
    and the offset — no frame rates to look up.
    """
    (old_a, new_a), (old_b, new_b) = first, second
    if old_a == old_b:
        raise ValueError("Oba body ukazují na stejný čas v titulcích")
    factor = (new_b - new_a) / (old_b - old_a)
    if factor <= 0:
        raise ValueError("Body jsou v opačném pořadí")
    offset = new_a - factor * old_a
    cues = _sorted(lines)
    for cue in cues:
        cue["start"] = round(max(0.0, (cue.get("start") or 0) * factor + offset), 3)
        cue["end"] = round(max(0.0, (cue.get("end") or 0) * factor + offset), 3)
    return _renumber(cues)


# ── text ─────────────────────────────────────────────────────────────────────

def replace(lines: list[dict], find: str, repl: str, *, regex: bool = False,
            case_sensitive: bool = True) -> dict:
    """Find and replace across every cue. Returns the cues and the hit count."""
    if not find:
        return {"lines": [dict(c) for c in lines], "count": 0, "cues": 0}
    flags = 0 if case_sensitive else re.IGNORECASE
    try:
        pattern = re.compile(find if regex else re.escape(find), flags)
    except re.error as exc:
        raise ValueError(f"Neplatný regulární výraz: {exc}") from exc

    cues = [dict(c) for c in lines]
    hits = touched = 0
    for cue in cues:
        text = cue.get("text") or ""
        new_text, n = pattern.subn(repl, text)
        if n:
            cue["text"] = new_text
            hits += n
            touched += 1
    return {"lines": cues, "count": hits, "cues": touched}


def split_cue(lines: list[dict], index: int, at: float | None = None) -> list[dict]:
    """Break one cue in two — the standard fix for a line that runs too long.

    Without a time, it splits down the middle and divides the text at the line
    break, which is what a two-line cue showing two speakers usually needs.
    """
    cues = _sorted(lines)
    if not 0 <= index < len(cues):
        raise ValueError("Titulek neexistuje")
    cue = cues[index]
    start, end = cue.get("start") or 0, cue.get("end") or 0
    middle = at if at is not None else (start + end) / 2
    if not start < middle < end:
        raise ValueError("Dělicí bod musí ležet uvnitř titulku")

    text = cue.get("text") or ""
    head, _, tail = text.partition("\n")
    if not tail:
        head, tail = text, ""

    first = {**cue, "end": round(middle, 3), "text": head}
    second = {**cue, "start": round(middle, 3), "end": end, "text": tail}
    return _renumber(cues[:index] + [first, second] + cues[index + 1:])


def merge_cues(lines: list[dict], indexes: list[int]) -> list[dict]:
    """Join neighbouring cues into one, the way a sentence split mid-clause
    reads better as a single line."""
    cues = _sorted(lines)
    picked = sorted(i for i in set(indexes) if 0 <= i < len(cues))
    if len(picked) < 2:
        raise ValueError("Ke spojení jsou potřeba aspoň dva titulky")
    if picked != list(range(picked[0], picked[-1] + 1)):
        raise ValueError("Spojit lze jen titulky, které jdou po sobě")

    group = [cues[i] for i in picked]
    merged = {
        "start": group[0].get("start") or 0,
        "end": max((c.get("end") or 0) for c in group),
        "text": "\n".join(t for t in ((c.get("text") or "").strip() for c in group) if t),
    }
    return _renumber(cues[:picked[0]] + [merged] + cues[picked[-1] + 1:])


def insert_cue(lines: list[dict], start: float, end: float, text: str = "") -> list[dict]:
    """Add a cue — a line the source file simply doesn't have."""
    if end <= start:
        raise ValueError("Konec musí být za začátkem")
    cues = _sorted(lines)
    cues.append({"start": round(start, 3), "end": round(end, 3), "text": text})
    return _renumber(_sorted(cues))


def delete_cues(lines: list[dict], indexes: list[int]) -> list[dict]:
    drop = {i for i in indexes}
    return _renumber([dict(c) for i, c in enumerate(_sorted(lines)) if i not in drop])
