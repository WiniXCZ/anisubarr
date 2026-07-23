"""
lang_detect.py — detekce jazyka titulkových souborů (CZ vs SK).

Používá heuristiku na základě klíčových slov — nevyžaduje žádné
externí knihovny.  Primárně rozlišuje češtinu od slovenštiny.
"""
from __future__ import annotations
import re
from pathlib import Path

# ── Klíčová slova ─────────────────────────────────────────────────────────────

_SK: set[str] = {
    "som", "sme", "ste", "sú", "budem", "budeme", "budete",
    "alebo", "keď", "keďže", "teda", "totiž", "pretože",
    "neviem", "viem", "hovorí", "hovoril", "povedal", "povedala",
    "môj", "moja", "môže", "môžeš", "nemôžem", "nemôžeš",
    "áno", "ďakujem", "dobre", "prídem", "prišiel", "prišla", "odišiel",
    "potrebujem", "chcem", "nechcem", "veľmi",
    "žiadny", "žiadna", "trochu", "potom", "skôr",
    "čoskoro", "vlastne", "naozaj", "určite", "možno", "napríklad",
    "taktiež", "rovnako", "kedysi", "niekedy", "nikdy",
}

_CZ: set[str] = {
    "jsem", "jsme", "jste", "jsou", "budu", "budeme", "budete",
    "nebo", "když", "jenže", "tedy", "totiž", "protože",
    "nevím", "vím", "říká", "řekl", "řekla",
    "můj", "moje", "může", "můžeš", "nemůžu", "nemůžeš",
    "ano", "děkuji", "dobře", "přijdu", "přišel", "přišla", "odešel",
    "potřebuji", "chci", "nechci", "velmi",
    "žádný", "žádná", "trochu", "potom", "spíš",
    "brzy", "vlastně", "opravdu", "určitě", "možná", "například",
    "taktéž", "stejně", "kdysi", "někdy", "nikdy",
}

_MIN_HITS = 5   # méně shod → výsledek "??"


def _read_text(path: Path, max_bytes: int = 12_000) -> str:
    raw = path.read_bytes()[:max_bytes]
    for enc in ("utf-8-sig", "utf-8", "cp1250", "iso-8859-2"):
        try:
            return raw.decode(enc)
        except Exception:
            continue
    return raw.decode("latin-1", errors="replace")


def _strip_markup(text: str) -> str:
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\{[^}]+\}", " ", text)
    text = re.sub(r"\d+:\d+:\d+.*?-->\s*\d+.*", " ", text)
    text = re.sub(r"^\d+$", " ", text, flags=re.MULTILINE)
    return text.lower()


def detect_lang_from_bytes(data: bytes) -> tuple[str, float]:
    """
    Detekuje jazyk z bajtů titulkového souboru.

    Vrátí (jazyk, jistota):
        jazyk   = 'cs' | 'sk' | '??'
        jistota = 0.0–1.0
    """
    try:
        raw = data[:12_000]
        text = None
        for enc in ("utf-8-sig", "utf-8", "cp1250", "iso-8859-2"):
            try:
                text = raw.decode(enc)
                break
            except Exception:
                continue
        if text is None:
            text = raw.decode("latin-1", errors="replace")
    except Exception:
        return "??", 0.0

    return _score(_strip_markup(text))


def detect_lang_from_file(path: Path) -> tuple[str, float]:
    """Detekuje jazyk ze souboru. Vrátí (jazyk, jistota)."""
    try:
        text = _strip_markup(_read_text(path))
    except Exception:
        return "??", 0.0
    return _score(text)


def _score(text: str) -> tuple[str, float]:
    words = re.findall(r"[a-záčďéěíňóřšťúůýžäôľĺŕ]+", text)
    sk = sum(1 for w in words if w in _SK)
    cz = sum(1 for w in words if w in _CZ)
    total = sk + cz

    if total < _MIN_HITS:
        return "??", 0.0
    if sk > cz:
        return "sk", round(sk / total, 3)
    if cz > sk:
        return "cs", round(cz / total, 3)
    return "??", 0.5
