"""
subtitle_lines.py – Parse and save subtitle files as structured line objects.

GET  /api/episodes/{ep_id}/subs/{lang}       → list subtitle lines
PUT  /api/episodes/{ep_id}/subs/{lang}       → save subtitle lines back to file
GET  /api/episodes/{ep_id}/subs/{lang}/file  → raw subtitle file content
"""
from __future__ import annotations

import os
import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user
from ..models.series import Episode, Subtitle
from ..models.user import User
from ..services import path_resolver

router = APIRouter(prefix="/api/episodes", tags=["subtitle-lines"])


# ── SRT parser ─────────────────────────────────────────────────────────────────

_SRT_BLOCK_RE = re.compile(
    r"(\d+)\s*\n(\d{2}:\d{2}:\d{2}[,\.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,\.]\d{3})(.*?)(?=\n\n|\Z)",
    re.DOTALL,
)

def _ts_to_s(ts: str) -> float:
    ts = ts.replace(",", ".")
    parts = ts.split(":")
    h, m, s = float(parts[0]), float(parts[1]), float(parts[2])
    return h * 3600 + m * 60 + s

def _s_to_ts(s: float) -> str:
    s = max(0.0, s)
    h = int(s // 3600)
    s -= h * 3600
    m = int(s // 60)
    s -= m * 60
    ms = round((s % 1) * 1000)
    sec = int(s)
    return f"{h:02d}:{m:02d}:{sec:02d},{ms:03d}"

def _parse_srt(content: str) -> list[dict]:
    lines = []
    for m in _SRT_BLOCK_RE.finditer(content.strip()):
        idx   = int(m.group(1))
        start = _ts_to_s(m.group(2))
        end   = _ts_to_s(m.group(3))
        text  = m.group(4).strip()
        lines.append({"id": idx, "start": start, "end": end, "text": text})
    return lines

def _render_srt(lines: list[dict]) -> str:
    out = []
    for ln in sorted(lines, key=lambda x: x["start"]):
        out.append(str(ln["id"]))
        out.append(f"{_s_to_ts(ln['start'])} --> {_s_to_ts(ln['end'])}")
        out.append(ln.get("text", ""))
        out.append("")
    return "\n".join(out)


# ── ASS parser (basic: extract dialogue lines) ────────────────────────────────

_ASS_DIALOGUE_RE = re.compile(
    r"^Dialogue:\s*\d+,\s*(\d+:\d{2}:\d{2}\.\d{2}),\s*(\d+:\d{2}:\d{2}\.\d{2}),.*?,,\d+,\d+,\d+,,(.*)$",
    re.MULTILINE,
)
_ASS_OVERRIDE_RE = re.compile(r"\{[^}]*\}")

def _ts_ass_to_s(ts: str) -> float:
    parts = ts.split(":")
    h, m, s = float(parts[0]), float(parts[1]), float(parts[2])
    return h * 3600 + m * 60 + s

def _parse_ass(content: str) -> list[dict]:
    lines = []
    for i, m in enumerate(_ASS_DIALOGUE_RE.finditer(content), start=1):
        start = _ts_ass_to_s(m.group(1))
        end   = _ts_ass_to_s(m.group(2))
        text  = _ASS_OVERRIDE_RE.sub("", m.group(3)).replace("\\N", "\n").strip()
        lines.append({"id": i, "start": start, "end": end, "text": text})
    return sorted(lines, key=lambda x: x["start"])


# ── File reader ────────────────────────────────────────────────────────────────

def _read_subtitle_file(path: str) -> tuple[str, str]:
    """Returns (content, ext). Raises HTTPException on missing file."""
    if not os.path.isfile(path):
        raise HTTPException(404, f"Subtitle file not found: {path}")
    with open(path, encoding="utf-8-sig", errors="replace") as f:
        return f.read(), os.path.splitext(path)[1].lstrip(".").lower()


def _parse_subtitle(content: str, ext: str) -> list[dict]:
    if ext in ("ass", "ssa"):
        return _parse_ass(content)
    return _parse_srt(content)


# ── Helpers ───────────────────────────────────────────────────────────────────

_LANG_ALIASES = {
    "cs": {"cs", "cze", "ces", "cz"},
    "ja": {"ja", "jpn"},
    "en": {"en", "eng"},
}

def _get_episode(db: Session, ep_id: int) -> Episode:
    ep = db.query(Episode).filter(Episode.id == ep_id).first()
    if not ep:
        raise HTTPException(404, "Episode not found")
    return ep

def _find_sub_path(ep: Episode, lang: str, db: Session) -> Optional[str]:
    """Find subtitle file path for episode + language. DB first, then disk."""
    aliases = _LANG_ALIASES.get(lang, {lang})
    # 1) DB record
    for sub in db.query(Subtitle).filter(Subtitle.episode_id == ep.id).all():
        if sub.language in aliases and sub.file_path and not sub.is_embedded:
            try:
                local = path_resolver.unc_to_local(path_resolver.resolve(sub.file_path))
                if os.path.isfile(local):
                    return local
            except Exception:
                if os.path.isfile(sub.file_path):
                    return sub.file_path
    # 2) Disk scan
    if not ep.file_path:
        return None
    try:
        video = path_resolver.unc_to_local(path_resolver.resolve(ep.file_path))
    except Exception:
        video = ep.file_path
    base = os.path.splitext(video)[0]
    for code in aliases:
        for ext in ("srt", "ass", "ssa", "vtt"):
            p = f"{base}.{code}.{ext}"
            if os.path.isfile(p):
                return p
    return None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/{ep_id}/subs/{lang}")
def get_subtitle_lines(
    ep_id: int,
    lang: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    ep = _get_episode(db, ep_id)
    path = _find_sub_path(ep, lang, db)
    if not path:
        return {"lines": [], "lang": lang, "path": None, "format": None}
    content, ext = _read_subtitle_file(path)
    lines = _parse_subtitle(content, ext)
    return {"lines": lines, "lang": lang, "path": path, "format": ext}


@router.get("/{ep_id}/subs/{lang}/file")
def get_subtitle_raw(
    ep_id: int,
    lang: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    ep = _get_episode(db, ep_id)
    path = _find_sub_path(ep, lang, db)
    if not path:
        raise HTTPException(404, "Subtitle file not found for this language")
    content, ext = _read_subtitle_file(path)
    return {"content": content, "format": ext, "path": path}


class SaveLinesRequest(BaseModel):
    lines: list[dict]
    format: str = "srt"


@router.put("/{ep_id}/subs/{lang}")
def save_subtitle_lines(
    ep_id: int,
    lang: str,
    body: SaveLinesRequest,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    ep = _get_episode(db, ep_id)
    path = _find_sub_path(ep, lang, db)
    if not path:
        raise HTTPException(404, "No subtitle file found to overwrite; upload one first")
    if body.format in ("srt",):
        content = _render_srt(body.lines)
    else:
        raise HTTPException(400, "Only SRT format is supported for save; use /api/subtitle-editor for ASS")
    try:
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
    except Exception as e:
        raise HTTPException(500, f"Failed to write subtitle file: {e}")
    return {"saved": True, "path": path, "lines": len(body.lines)}
