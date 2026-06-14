"""
subtitle_translate.py — AI-assisted SK→CS subtitle translation.

Used by subtitle_langcheck: when a subtitle downloaded as "cs" turns out to
actually be Slovak (SK), instead of just renaming it to .sk and waiting for a
fresh CZ download, we translate it in place SK→CS via the configured AI
provider (ai_provider.call_ai — typically DeepSeek, which handles SK→CS
cheaply and accurately).

Supports SRT (full re-render) and ASS/SSA (only the dialogue text field of
each `Dialogue:` line is translated; everything else — headers, styles,
timing, override tags — is left untouched).
"""
from __future__ import annotations

import json
import logging
import re
from pathlib import Path

log = logging.getLogger("anisubarr.subtitle_translate")

# How many subtitle lines to send to the AI per request.
BATCH_SIZE = 40

_SYSTEM_PROMPT = (
    "Jsi profesionální překladatel anime titulků ze slovenštiny do češtiny. "
    "Překládej přesně, přirozeně a stručně — titulky musí zůstat krátké a "
    "čitelné na obrazovce. Zachovej beze změny a na svém místě veškeré "
    "formátovací značky a kódy (např. {\\...}, \\N, \\n, HTML tagy, jména "
    "postav, čísla) — překládej POUZE samotný slovenský text. "
    "Odpovídej VÝHRADNĚ JSON polem ve formátu "
    '[{"id":1,"cs":"přeložený text"},...] bez jakéhokoli dalšího komentáře.'
)

# ── SRT ──────────────────────────────────────────────────────────────────────

_SRT_BLOCK_RE = re.compile(
    r"(\d+)\s*\n(\d{2}:\d{2}:\d{2}[,\.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,\.]\d{3})(.*?)(?=\n\n|\Z)",
    re.DOTALL,
)

# ── ASS/SSA ──────────────────────────────────────────────────────────────────

# Dialogue: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
# → capture the first 9 comma-separated fields as a prefix, rest is the text.
_ASS_DIALOGUE_LINE_RE = re.compile(r"^(Dialogue:\s*(?:[^,\n]*,){9})(.*)$", re.MULTILINE)


def _strip_code_fence(text: str) -> str:
    content = text.strip()
    if content.startswith("```"):
        content = re.sub(r"^```[a-z]*\n?", "", content, flags=re.MULTILINE).rstrip("`").strip()
    return content


def _translate_batch(items: list[tuple[int, str]], db) -> dict[int, str]:
    from .ai_provider import call_ai

    payload = json.dumps([{"id": i, "sk": t} for i, t in items], ensure_ascii=False)
    messages = [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user", "content": f"Přelož tyto titulky ze slovenštiny do češtiny:\n{payload}"},
    ]
    text, model_id = call_ai(messages, db, timeout=90)
    content = _strip_code_fence(text)
    data = json.loads(content)
    log.debug("subtitle_translate: batch of %d lines via %s", len(items), model_id)
    return {int(item["id"]): item.get("cs", "") for item in data}


def _translate_texts(texts: dict[int, str], db) -> dict[int, str]:
    """Translate a {id: sk_text} map in batches, returning {id: cs_text}.

    Raises on the first failed batch — callers should treat any exception as
    "translation unavailable" and fall back to non-AI behavior.
    """
    out: dict[int, str] = {}
    items = [(i, t) for i, t in texts.items() if t.strip()]
    for start in range(0, len(items), BATCH_SIZE):
        batch = items[start:start + BATCH_SIZE]
        translated = _translate_batch(batch, db)
        out.update(translated)
    return out


def translate_srt_to_cs(content: str, db) -> tuple[str, int]:
    """Translate all SRT cue text from SK to CS. Returns (new_content, n_lines)."""
    blocks = list(_SRT_BLOCK_RE.finditer(content.strip()))
    if not blocks:
        return content, 0

    texts = {i: m.group(4).strip() for i, m in enumerate(blocks)}
    translated = _translate_texts(texts, db)

    out: list[str] = []
    for i, m in enumerate(blocks):
        out.append(m.group(1))
        out.append(f"{m.group(2)} --> {m.group(3)}")
        out.append(translated.get(i, texts[i]))
        out.append("")
    return "\n".join(out), len(blocks)


def translate_ass_to_cs(content: str, db) -> tuple[str, int]:
    """Translate the text field of every ASS/SSA Dialogue line SK→CS.

    Everything else in the file (headers, styles, timing, override tags)
    is preserved byte-for-byte. Returns (new_content, n_lines).
    """
    matches = list(_ASS_DIALOGUE_LINE_RE.finditer(content))
    if not matches:
        return content, 0

    texts = {i: m.group(2) for i, m in enumerate(matches)}
    translated = _translate_texts(texts, db)

    out: list[str] = []
    last_end = 0
    for i, m in enumerate(matches):
        out.append(content[last_end:m.start(1)])
        out.append(m.group(1))
        out.append(translated.get(i, texts[i]))
        last_end = m.end()
    out.append(content[last_end:])
    return "".join(out), len(matches)


def translate_subtitle_file(path: Path, db) -> tuple[bool, str]:
    """Translate a subtitle file SK→CS in place via the configured AI provider.

    Returns (success, message). On failure (no provider configured, API
    error, unsupported format, nothing to translate) returns (False, reason)
    and leaves the file untouched.
    """
    ext = path.suffix.lower().lstrip(".")
    if ext not in ("srt", "ass", "ssa"):
        return False, f"unsupported format: {ext}"

    try:
        content = path.read_text(encoding="utf-8-sig", errors="replace")
    except Exception as e:
        return False, f"read error: {e}"

    try:
        if ext in ("ass", "ssa"):
            new_content, n = translate_ass_to_cs(content, db)
        else:
            new_content, n = translate_srt_to_cs(content, db)
    except Exception as e:
        return False, f"AI translate error: {e}"

    if n == 0:
        return False, "no dialogue lines found to translate"

    try:
        path.write_text(new_content, encoding="utf-8")
    except Exception as e:
        return False, f"write error: {e}"

    return True, f"translated {n} lines"
