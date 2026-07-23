"""
ai_translate.py – AI-assisted subtitle translation endpoint.

POST /api/ai/translate  → translate a batch of subtitle lines
GET  /api/ai/status     → check which AI provider is configured
"""
from __future__ import annotations

import json
import logging
import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user
from ..models.user import User

log = logging.getLogger("anisubarr.ai_translate")

router = APIRouter(prefix="/api/ai", tags=["ai-translate"])


# ── Schemas ────────────────────────────────────────────────────────────────────

class TranslateLine(BaseModel):
    id: int
    jp: str
    en: Optional[str] = None


class TranslateContext(BaseModel):
    series_id:       Optional[int] = None
    series_title:    Optional[str] = None
    tone:            str           = "standard"   # soft / standard / formal
    keep_honorifics: bool          = True
    glossary:        list[dict]    = []            # [{jp, cs}, ...]


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


# ── Prompt builders ────────────────────────────────────────────────────────────

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


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("/status")
def ai_status(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    """Return which AI provider is active and ready."""
    from ..services.ai_provider import get_provider_config
    cfg = get_provider_config(db)
    provider = cfg.get("provider")
    if provider:
        return {"provider": provider, "model": cfg.get("model"), "ready": True}
    return {
        "provider": None,
        "ready": False,
        "message": "No AI provider configured. Set ai_translation_provider in Settings.",
    }


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

    # Load glossary from DB when series_id is provided and no explicit glossary
    if req.context.series_id and not req.context.glossary:
        try:
            from ..models.glossary import GlossaryEntry
            entries = (
                db.query(GlossaryEntry)
                .filter(
                    GlossaryEntry.tgt_lang == "cs",
                    (GlossaryEntry.series_id == req.context.series_id)
                    | (GlossaryEntry.series_id == None),  # noqa: E711
                )
                .limit(50)
                .all()
            )
            req.context.glossary = [{"jp": e.src_text, "cs": e.tgt_text} for e in entries]
        except Exception:
            pass

    glossary_block = _build_glossary_prompt(req.context.glossary)
    lines_text = "\n".join([f'{{"id":{l.id},"jp":"{l.jp}"}}' for l in req.lines])
    user_msg = (
        f"{glossary_block}"
        "Přelož tyto titulky do češtiny. Pro každý řádek vrať objekt s poli id, cs (hlavní překlad), "
        "a alts (2 alternativní překlady). Vrať POUZE JSON pole bez dalšího textu.\n\n"
        f"Řádky:\n{lines_text}\n\n"
        'Formát odpovědi: [{"id":1,"cs":"překlad","alts":["alt1","alt2"]},...]'
    )
    messages = [
        {"role": "system", "content": _build_system_prompt(req.context)},
        {"role": "user",   "content": user_msg},
    ]

    from ..services.ai_provider import call_ai
    try:
        text, model_id = call_ai(messages, db, timeout=60)
    except RuntimeError as e:
        raise HTTPException(503, str(e))
    except Exception as e:
        log.error("AI translation failed: %s", e)
        raise HTTPException(502, f"AI error: {e}")

    # Strip markdown code fences if model wraps JSON in them
    content = text
    if content.startswith("```"):
        content = re.sub(r"^```[a-z]*\n?", "", content, flags=re.MULTILINE)
        content = content.rstrip("`").strip()

    try:
        data = json.loads(content)
    except json.JSONDecodeError as exc:
        log.error("AI returned invalid JSON: %s\nRaw: %.200s", exc, content)
        raise HTTPException(502, f"AI returned invalid JSON: {exc}")

    translations = [
        TranslatedLine(id=item["id"], cs=item.get("cs", ""), alts=item.get("alts", []))
        for item in data
    ]
    return TranslateResponse(translations=translations, model=model_id)
