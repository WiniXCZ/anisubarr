"""
subtitle_langcheck.py — hromadná kontrola jazyka stažených titulků.

Postup pro každý nalezený titulek v DB:
 1. Přečte soubor ze SMB/UNC cesty.
 2. Detekuje jazyk.
 3. Pokud je detekovaný jazyk jiný než uložený (typicky cs→sk):
    a. Přejmenuje soubor (nahradí jazykový kód v názvu).
    b. Zapíše detected_lang a aktualizuje language v DB.
    c. Tím se při příštím spuštění download_missing epizoda znovu
       označí jako bez CZ titulku a proběhne nový pokus o stažení.

Cooldown: download_missing přeskočí epizodu, pokud má subtitle
s detected_lang='sk' stažený méně než LANGCHECK_COOLDOWN_HOURS hodin zpátky.
"""
from __future__ import annotations

import logging
import os
import re
from datetime import datetime, timezone, timedelta
from pathlib import Path

from sqlalchemy.orm import Session

from .lang_detect import detect_lang_from_file
from .path_resolver import resolve as resolve_path   # server_path → local/UNC path

log = logging.getLogger("anisubarr.langcheck")

# Po kolika hodinách se smí zopakovat pokus o stažení CS po detekci SK
LANGCHECK_COOLDOWN_HOURS = 12
# Minimální jistota detekce pro akci (0–1)
LANGCHECK_MIN_CONF = 0.80


def _rename_subtitle_file(path: Path, detected_lang: str) -> Path | None:
    """
    Pokusí se přejmenovat soubor tak, aby odpovídal skutečnému jazyku.
    Např. show.S01E01.cs.srt → show.S01E01.sk.srt

    Vrátí novou cestu, nebo None pokud přejmenování nebylo potřeba/možné.
    """
    ext  = path.suffix.lower()   # .srt / .ass
    stem = path.stem             # vše bez poslední přípony

    lang_pat = re.compile(
        r"^(.*?)[._-](cs|cz|cze|sk|slo|ces)([._-]|$)",
        re.IGNORECASE,
    )
    m = lang_pat.match(stem)
    if not m:
        return None  # nenašli jsme kód → nic nedělat

    found_code = m.group(2).lower()
    if found_code == detected_lang:
        return None  # kód je již správný

    sep_before = stem[len(m.group(1))]        # oddělovač před kódem
    sep_after  = m.group(3)                   # oddělovač za kódem
    rest       = stem[m.end():]

    if sep_after:
        new_stem = f"{m.group(1)}{sep_before}{detected_lang}{sep_after}{rest}"
    else:
        new_stem = f"{m.group(1)}{sep_before}{detected_lang}"

    new_path = path.parent / (new_stem + ext)
    if new_path.exists():
        log.warning(f"[langcheck] cíl již existuje, přeskočen: {new_path}")
        return None

    path.rename(new_path)
    log.info(f"[langcheck] přejmenováno: {path.name} → {new_path.name}")
    return new_path


def check_and_fix_subtitle(db: Session, subtitle, dry_run: bool = False) -> dict:
    """
    Zkontroluje jeden záznam Subtitle, v případě potřeby opraví.
    Vrátí dict se stavem: action='ok'|'fixed'|'skipped'|'error'.
    """
    from ..models.series import Subtitle

    if not subtitle.file_path:
        return {"action": "skipped", "reason": "no file_path"}

    try:
        path = Path(resolve_path(subtitle.file_path))
    except Exception as e:
        return {"action": "error", "reason": f"path resolve: {e}"}

    if not path.exists():
        return {"action": "skipped", "reason": "file not found"}

    detected, conf = detect_lang_from_file(path)

    # Zapíše výsledek detekce vždy (i když se jazyk shoduje)
    if not dry_run:
        subtitle.detected_lang = detected
        db.commit()

    if detected == "??" or conf < LANGCHECK_MIN_CONF:
        return {"action": "skipped", "reason": f"low confidence ({conf:.0%})"}

    stored_lang = subtitle.language  # "cs" / "sk" atd.
    if detected == stored_lang:
        return {"action": "ok", "lang": detected, "conf": conf}

    # ── Jazyk nesedí — opravíme ─────────────────────────────────────────────
    if dry_run:
        return {
            "action": "would_fix",
            "file": path.name,
            "from": stored_lang,
            "to": detected,
            "conf": conf,
        }

    new_path = _rename_subtitle_file(path, detected)
    if new_path:
        # Zpátky převedeme na server-side cestu (nahradíme local prefix sonarr prefixem)
        from ..config import get_settings as _gs
        cfg = _gs()
        local_p = (cfg.path_local_prefix or "").rstrip("/\\")
        sonarr_p = (cfg.path_sonarr_prefix or "").rstrip("/\\")
        new_str = str(new_path)
        if local_p and new_str.startswith(local_p):
            new_str = sonarr_p + new_str[len(local_p):].replace("\\", "/")
        subtitle.file_path = new_str

    subtitle.language     = detected
    subtitle.detected_lang = detected
    db.commit()

    log.info(
        f"[langcheck] EP {subtitle.episode_id}: "
        f"{stored_lang}→{detected} ({conf:.0%}) | {path.name}"
    )
    return {
        "action": "fixed",
        "file": path.name,
        "from": stored_lang,
        "to": detected,
        "conf": conf,
    }


def run_langcheck(
    db: Session,
    *,
    language_filter: str = "cs",
    dry_run: bool = False,
    min_conf: float = LANGCHECK_MIN_CONF,
) -> dict:
    """
    Hromadná kontrola všech titulků uložených jako `language_filter`.

    Parametry:
        language_filter  — zkontroluje titulky uložené pod tímto kódem (default 'cs')
        dry_run          — pouze zjistí, nic nepřejmenovává ani nezapisuje do DB
        min_conf         — minimální jistota pro akci

    Vrátí:
        {
          "total": int,
          "ok": int,
          "fixed": int,
          "skipped": int,
          "errors": int,
          "details": [ ... ]
        }
    """
    from ..models.series import Subtitle

    subs = (
        db.query(Subtitle)
        .filter(Subtitle.language == language_filter, Subtitle.file_path.isnot(None))
        .all()
    )

    log.info(f"[langcheck] start — {len(subs)} titulků s language='{language_filter}'")

    stats = {"total": len(subs), "ok": 0, "fixed": 0, "skipped": 0, "errors": 0}
    details = []

    for sub in subs:
        result = check_and_fix_subtitle(db, sub, dry_run=dry_run)
        action = result.get("action", "error")

        if action in ("ok",):
            stats["ok"] += 1
        elif action in ("fixed", "would_fix"):
            stats["fixed"] += 1
        elif action == "error":
            stats["errors"] += 1
            log.warning(f"[langcheck] chyba EP {sub.episode_id}: {result.get('reason')}")
        else:
            stats["skipped"] += 1

        if action != "ok":
            details.append({"episode_id": sub.episode_id, **result})

    stats["details"] = details
    log.info(
        f"[langcheck] hotovo — ok={stats['ok']} fixed={stats['fixed']} "
        f"skip={stats['skipped']} err={stats['errors']}"
    )
    return stats


def should_skip_due_to_sk_cooldown(db: Session, episode_id: int) -> bool:
    """
    Vrátí True pokud má epizoda SK titulek stažený v rámci cooldown okna.
    Použije se v download_missing pro přeskočení čerstvě označených epizod.
    """
    from ..models.series import Subtitle

    cutoff = datetime.now(timezone.utc) - timedelta(hours=LANGCHECK_COOLDOWN_HOURS)
    sk_sub = (
        db.query(Subtitle)
        .filter(
            Subtitle.episode_id == episode_id,
            Subtitle.detected_lang == "sk",
            Subtitle.downloaded_at >= cutoff,
        )
        .first()
    )
    return sk_sub is not None
