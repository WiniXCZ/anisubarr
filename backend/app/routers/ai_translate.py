"""
ai_translate.py – AI-assisted subtitle translation endpoint.

POST /api/ai/translate   → translate a batch of subtitle lines via Claude API
GET  /api/ai/status      → check if AI translation is configured
"""
from __future__ import annotations

import logging
import os
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user
from ..models.user import User

log = logging.getLogger("anisubarr.ai_translate")

router = APIRouter(prefix="/api/ai", tags=["ai-translate"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class TranslateLine(BaseModel):
    id: int
    jp: str
    en: Optional[str] = None   # existing translation (for context)


class TranslateContext(BaseModel):
    series_id:       Optional[int]   = None
    series_title:    Optional[str]   = None
    tone:            str             = "standard"   # soft / standard / formal
    keep_honorifics: bool            = True
    glossary:        list[dict]      = []            # [{jp, cs}, ...]


class TranslateRequest(BaseModel):
    lines:   list[TranslateLine]
    context: TranslateContext = TranslateContext()


class TranslatedLine(BaseModel):
    id:   int
    cs:   str
    alts: list[str] = []


class TranslateResponse(BaseModel):
    translations: list[TranslatedLine]
    model:        str
    cached:       bool = False


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_api_key(db) -> Optional[str]:
    """Read Anthropic API key from DB settings or environment."""
    try:
        from ..models.app_settings import AppSetting
        row = db.query(AppSetting).filter(AppSetting.key == "anthropic_api_key").first()
        if row and row.value:
            return row.value
    except Exception:
        pass
    return os.environ.get("ANTHROPIC_API_KEY")


def _build_glossary_prompt(glossary: list[dict]) -> str:
    if not glossary:
        return ""
    lines = [f"  {g.get('jp', '')} → {g.get('cs', '')}" for g in glossary[:30]]
    return "Glosář pojmů (vždy dodržuj):\n" + "\n".join(lines) + "\n\n"


def _build_system_prompt(ctx: TranslateContext) -> str:
    tone_map = {
        "soft":     "Překlad má být jemný, poetický a emotivní.",
        "standard": "Překlad má být přirozený a plynný.",
        "formal":   "Překlad má být formální a přesný.",
    }
    tone_note = tone_map.get(ctx.tone, tone_map["standard"])
    honorifics = (
        "Zachovej japonská honorifika (-san, -kun, -chan, -sensei apod.) v originálním tvaru."
        if ctx.keep_honorifics
        else "Honorifika volně adaptuj do češtiny nebo vynech."
    )
    series_note = f"Anime: {ctx.series_title}. " if ctx.series_title else ""
    return (
        f"Jsi profesionální překladatel anime titulků. {series_note}"
        f"{tone_note} {honorifics} "
        "Překládej z japonštiny do češtiny. Zachovej styl a emoce originálu. "
        "Titulky musí být krátké a čitelné na obrazovce. "
        "Odpovídej POUZE ve formátu JSON."
    )


def _translate_with_claude(lines: list[TranslateLine], ctx: TranslateContext, api_key: str) -> TranslateResponse:
    import anthropic

    client = anthropic.Anthropic(api_key=api_key)
    model = "claude-haiku-4-5"

    glossary_block = _build_glossary_prompt(ctx.glossary)
    lines_text = "\n".join([f'{{"id":{l.id},"jp":"{l.jp}"}}' for l in lines])

    user_msg = (
        f"{glossary_block}"
        f"Přelož tyto titulky do češtiny. Pro každý řádek vrať pole s polí id, cs (hlavní překlad), "
        f"a alts (2 alternativní překlady). Vrať POUZE JSON pole bez dalšího textu.\n\n"
        f"Řádky:\n{lines_text}\n\n"
        f'Formát odpovědi: [{{"id":1,"cs":"překlad","alts":["alt1","alt2"]}},...]'
    )

    response = client.messages.create(
        model=model,
        max_tokens=2048,
        system=_build_system_prompt(ctx),
        messages=[{"role": "user", "content": user_msg}],
    )

    import json
    content = response.content[0].text.strip()
    # Strip markdown code fences if present
    if content.startswith("```"):
        content = re.sub(r"^```[a-z]*\n?", "", content, flags=re.MULTILINE)
        content = content.rstrip("`").strip()

    data = json.loads(content)
    translations = [
        TranslatedLine(id=item["id"], cs=item.get("cs", ""), alts=item.get("alts", []))
        for item in data
    ]
    return TranslateResponse(translations=translations, model=model)


def _translate_with_ollama(lines: list[TranslateLine], ctx: TranslateContext, host: str) -> TranslateResponse:
    import httpx, json

    glossary_block = _build_glossary_prompt(ctx.glossary)
    lines_text = "\n".join([f"ID {l.id}: {l.jp}" for l in lines])

    prompt = (
        f"{_build_system_prompt(ctx)}\n\n"
        f"{glossary_block}"
        f"Přelož tyto titulky do češtiny. Vrať POUZE JSON pole.\n"
        f"Formát: [{{\"id\":1,\"cs\":\"překlad\",\"alts\":[\"alt1\",\"alt2\"]}},...]\n\n"
        f"Titulky:\n{lines_text}"
    )

    r = httpx.post(
        f"{host}/api/generate",
        json={"model": "llama3", "prompt": prompt, "stream": False},
        timeout=120,
    )
    r.raise_for_status()
    raw = r.json().get("response", "")
    # Extract JSON array
    match = re.search(r"\[.*\]", raw, re.DOTALL)
    if not match:
        raise HTTPException(502, "Ollama returned no JSON array")
    data = json.loads(match.group(0))
    translations = [
        TranslatedLine(id=item["id"], cs=item.get("cs", ""), alts=item.get("alts", []))
        for item in data
    ]
    return TranslateResponse(translations=translations, model="ollama/llama3")


import re


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/status")
def ai_status(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    """Check which AI provider is configured."""
    api_key = _get_api_key(db)
    if api_key:
        return {"provider": "claude", "model": "claude-haiku-4-5", "ready": True}

    try:
        from ..models.app_settings import AppSetting
        row = db.query(AppSetting).filter(AppSetting.key == "ollama_host").first()
        if row and row.value:
            return {"provider": "ollama", "model": "llama3", "ready": True, "host": row.value}
    except Exception:
        pass

    env_host = os.environ.get("OLLAMA_HOST")
    if env_host:
        return {"provider": "ollama", "model": "llama3", "ready": True, "host": env_host}

    return {"provider": None, "ready": False, "message": "No AI provider configured. Set anthropic_api_key or ollama_host in Settings."}


@router.post("/translate", response_model=TranslateResponse)
def translate_subtitles(
    req: TranslateRequest,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    if not req.lines:
        raise HTTPException(400, "No lines to translate")
    if len(req.lines) > 100:
        raise HTTPException(400, "Maximum 100 lines per request")

    # Load glossary from DB if context.series_id provided and no explicit glossary
    if req.context.series_id and not req.context.glossary:
        try:
            from ..models.glossary import GlossaryEntry
            entries = (
                db.query(GlossaryEntry)
                .filter(
                    GlossaryEntry.tgt_lang == "cs",
                    (GlossaryEntry.series_id == req.context.series_id) | (GlossaryEntry.series_id == None)  # noqa: E711
                )
                .limit(50)
                .all()
            )
            req.context.glossary = [{"jp": e.src_text, "cs": e.tgt_text} for e in entries]
        except Exception:
            pass

    api_key = _get_api_key(db)
    if api_key:
        try:
            return _translate_with_claude(req.lines, req.context, api_key)
        except Exception as e:
            log.error("Claude translation failed: %s", e)
            raise HTTPException(502, f"Claude API error: {e}")

    # Fallback: Ollama
    try:
        from ..models.app_settings import AppSetting
        row = db.query(AppSetting).filter(AppSetting.key == "ollama_host").first()
        ollama_host = (row.value if row and row.value else None) or os.environ.get("OLLAMA_HOST", "")
    except Exception:
        ollama_host = os.environ.get("OLLAMA_HOST", "")

    if ollama_host:
        try:
            return _translate_with_ollama(req.lines, req.context, ollama_host)
        except Exception as e:
            log.error("Ollama translation failed: %s", e)
            raise HTTPException(502, f"Ollama error: {e}")

    raise HTTPException(
        503,
        "AI translation not configured. Add anthropic_api_key (Claude) or ollama_host to Settings.",
    )
