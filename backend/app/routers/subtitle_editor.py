"""
subtitle_editor.py – Read, shift, and save subtitle files manually.

The shift is always applied to the raw SRT/ASS file content — no audio analysis,
no automatic detection. Pure manual offset in milliseconds.
"""
from __future__ import annotations
import os
import re
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user
from ..models.series import Subtitle
from ..models.user import User
from ..services import path_resolver

router = APIRouter(prefix="/api/subtitle-editor", tags=["subtitle-editor"])


# ── Schemas ────────────────────────────────────────────────────────────────────

class ShiftRequest(BaseModel):
    sub_id:       int
    shift_ms:     int          # positive = delay, negative = advance
    save:         bool = True  # if False, just return preview


class SaveRequest(BaseModel):
    sub_id:  int
    content: str               # full SRT text to save


# ── Helpers ────────────────────────────────────────────────────────────────────

SRT_TIME_RE = re.compile(
    r"(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})"
)


def _ts_to_ms(h, m, s, ms) -> int:
    return int(h) * 3_600_000 + int(m) * 60_000 + int(s) * 1_000 + int(ms)


def _ms_to_ts(ms: int) -> str:
    ms = max(0, ms)
    h, rem = divmod(ms, 3_600_000)
    m, rem = divmod(rem, 60_000)
    s, ms2 = divmod(rem, 1_000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms2:03d}"


def _shift_srt(content: str, shift_ms: int) -> str:
    def _replace(m: re.Match) -> str:
        s1 = _ms_to_ts(_ts_to_ms(m[1], m[2], m[3], m[4]) + shift_ms)
        s2 = _ms_to_ts(_ts_to_ms(m[5], m[6], m[7], m[8]) + shift_ms)
        return f"{s1} --> {s2}"
    return SRT_TIME_RE.sub(_replace, content)


# ASS/SSA timecode: H:MM:SS.cc  (centiseconds!)
ASS_TIME_RE = re.compile(r"(\d):(\d{2}):(\d{2})\.(\d{2})")


def _ass_to_ms(h, m, s, cs) -> int:
    return int(h)*3_600_000 + int(m)*60_000 + int(s)*1_000 + int(cs)*10


def _ms_to_ass(ms: int) -> str:
    ms = max(0, ms)
    h, rem = divmod(ms, 3_600_000)
    m, rem = divmod(rem, 60_000)
    s, rem = divmod(rem, 1_000)
    cs = rem // 10
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def _shift_ass(content: str, shift_ms: int) -> str:
    """Shift only Dialogue lines in ASS files."""
    lines = []
    for line in content.splitlines(keepends=True):
        if line.startswith("Dialogue:"):
            # Replace only the first two time fields (Start, End) in Dialogue line
            fields = line.split(",", 10)
            if len(fields) >= 3:
                try:
                    # fields[1]=Start, fields[2]=End
                    def _repl_field(ts: str) -> str:
                        m2 = ASS_TIME_RE.match(ts.strip())
                        if m2:
                            return _ms_to_ass(_ass_to_ms(*m2.groups()) + shift_ms)
                        return ts
                    fields[1] = _repl_field(fields[1])
                    fields[2] = _repl_field(fields[2])
                    line = ",".join(fields)
                except Exception:
                    pass
        lines.append(line)
    return "".join(lines)


def _shift_content(content: str, ext: str, shift_ms: int) -> str:
    if ext in ("ass", "ssa"):
        return _shift_ass(content, shift_ms)
    return _shift_srt(content, shift_ms)  # SRT, VTT, SUB


def _read_sub_file(path: str) -> str:
    for enc in ("utf-8-sig", "utf-8", "cp1250", "latin-1"):
        try:
            with open(path, encoding=enc) as f:
                return f.read()
        except UnicodeDecodeError:
            continue
    raise HTTPException(500, "Nelze přečíst soubor (neznámé kódování)")


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("/{sub_id}")
def get_subtitle_content(
    sub_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    sub = db.query(Subtitle).filter(Subtitle.id == sub_id).first()
    if not sub:
        raise HTTPException(404, "Titulek nenalezen")
    if not sub.file_path:
        raise HTTPException(400, "Titulek nemá cestu k souboru")

    try:
        local = path_resolver.resolve(sub.file_path)
    except Exception:
        local = sub.file_path

    if not os.path.isfile(local):
        raise HTTPException(404, f"Soubor nenalezen: {local}")

    content = _read_sub_file(local)
    return {
        "sub_id":    sub.id,
        "language":  sub.language,
        "format":    sub.format,
        "file_path": sub.file_path,
        "content":   content,
    }


@router.post("/shift")
def shift_subtitle(
    req: ShiftRequest,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Shift all timestamps by shift_ms milliseconds (manual, no audio detection)."""
    sub = db.query(Subtitle).filter(Subtitle.id == req.sub_id).first()
    if not sub:
        raise HTTPException(404, "Titulek nenalezen")

    try:
        local = path_resolver.resolve(sub.file_path)
    except Exception:
        local = sub.file_path

    if not os.path.isfile(local):
        raise HTTPException(404, "Soubor nenalezen")

    original = _read_sub_file(local)
    shifted  = _shift_content(original, sub.format or "srt", req.shift_ms)

    if req.save:
        with open(local, "w", encoding="utf-8") as f:
            f.write(shifted)

    return {"sub_id": sub.id, "shift_ms": req.shift_ms, "saved": req.save, "content": shifted}


@router.post("/save")
def save_subtitle(
    req: SaveRequest,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Overwrite subtitle file with provided content."""
    sub = db.query(Subtitle).filter(Subtitle.id == req.sub_id).first()
    if not sub:
        raise HTTPException(404, "Titulek nenalezen")

    try:
        local = path_resolver.resolve(sub.file_path)
    except Exception:
        local = sub.file_path

    try:
        with open(local, "w", encoding="utf-8") as f:
            f.write(req.content)
    except PermissionError as e:
        raise HTTPException(403, str(e))
    except Exception as e:
        raise HTTPException(500, str(e))

    return {"sub_id": sub.id, "saved": True}
