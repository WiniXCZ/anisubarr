"""
config_file.py – settings.yaml, an editable on-disk mirror of app settings.

The file lives next to the SQLite database (the mapped appdata directory), so
it survives container updates and can be hand-edited when the UI is unreachable.

Behaviour (deliberately simple and predictable):
  * On startup, if settings.yaml changed since the last sync (mtime differs
    from the stored marker), its values are imported into the DB and the file
    is re-exported in normalized form. Hand-edit + restart = applied.
  * After every save from the UI (PUT /api/settings), the file is re-exported.
  * Secrets (API keys, passwords, webhook/JWT secrets) are NEVER written to the
    file — they stay only in the DB / .env. A secret key found in the file is
    imported (so you *can* set one by hand once) but dropped on re-export.

Self-heal:
  * Unparseable YAML is quarantined as settings.yaml.broken-<timestamp> and a
    fresh file is exported — the app never crash-loops on a bad edit.
  * Unknown keys are warned about and ignored; non-scalar values are skipped.
"""
from __future__ import annotations

import logging
import time
from pathlib import Path

import yaml

log = logging.getLogger("anisubarr.config_file")

# AppSetting row that remembers the file mtime from the last import/export, so
# startup can tell "file was hand-edited" apart from "file is what we wrote".
_MARKER_KEY = "_settings_yaml_mtime"

_HEADER = """\
# Anisubarr — settings.yaml
#
# Editovatelné zrcadlo nastavení aplikace. Ulož + restartuj kontejner a změny
# se načtou do databáze. Soubor se automaticky přegenerovává při každém
# uložení Nastavení v UI (tvoje ruční změny provedené za běhu tím přepíše).
#
# Tajné údaje (API klíče, hesla) sem NEPATŘÍ a nikdy se sem nezapisují —
# nastav je v UI (Nastavení / Připojení → Služby) nebo přes .env. Pokud sem
# tajný klíč ručně napíšeš, při startu se naimportuje a ze souboru zmizí.
"""


def _yaml_path() -> Path:
    from .backup import _db_path
    return _db_path().parent / "settings.yaml"


def _editable_nonsecret_keys() -> tuple[set, set]:
    from ..routers.settings import EDITABLE_KEYS, _SECRET_KEYS
    return set(EDITABLE_KEYS), set(_SECRET_KEYS)


def _get_marker(db) -> str:
    from ..models.app_settings import AppSetting
    row = db.query(AppSetting).filter(AppSetting.key == _MARKER_KEY).first()
    return (row.value or "") if row else ""


def _set_marker(db, value: str) -> None:
    from ..models.app_settings import AppSetting
    row = db.query(AppSetting).filter(AppSetting.key == _MARKER_KEY).first()
    if row:
        row.value = value
    else:
        db.add(AppSetting(key=_MARKER_KEY, value=value))
    db.commit()


def export_settings(db) -> None:
    """Write the current DB settings (non-secret keys only) to settings.yaml.
    Best-effort — failures are logged, never raised."""
    try:
        from ..models.app_settings import AppSetting
        editable, secret = _editable_nonsecret_keys()
        rows = db.query(AppSetting).all()
        data = {
            r.key: r.value
            for r in sorted(rows, key=lambda r: r.key)
            if r.key in editable and r.key not in secret and r.value is not None
        }
        path = _yaml_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        body = _HEADER + "\n" + yaml.safe_dump(
            data, allow_unicode=True, sort_keys=True, default_flow_style=False
        )
        tmp = path.with_suffix(".yaml.tmp")
        tmp.write_text(body, encoding="utf-8")
        tmp.replace(path)  # atomic on POSIX
        _set_marker(db, str(path.stat().st_mtime_ns))
        log.debug("settings.yaml exported (%d keys)", len(data))
    except Exception as exc:
        log.warning("settings.yaml export failed: %s", exc)


def import_settings_if_changed(db) -> int:
    """Import hand-edits from settings.yaml into the DB (startup hook).
    Returns how many keys were applied. Never raises."""
    try:
        path = _yaml_path()
        if not path.is_file():
            export_settings(db)   # first run — create the file
            return 0

        mtime = str(path.stat().st_mtime_ns)
        if mtime == _get_marker(db):
            return 0  # unchanged since we last wrote/read it

        try:
            parsed = yaml.safe_load(path.read_text(encoding="utf-8"))
        except Exception as exc:
            quarantine = path.with_name(f"settings.yaml.broken-{int(time.time())}")
            path.rename(quarantine)
            log.warning(
                "settings.yaml je nevalidní (%s) — přesunuto do %s a vygenerován čistý soubor",
                exc, quarantine.name,
            )
            export_settings(db)
            return 0

        if parsed is None:
            parsed = {}
        if not isinstance(parsed, dict):
            log.warning("settings.yaml neobsahuje mapu klíč→hodnota — ignorováno")
            export_settings(db)
            return 0

        from ..models.app_settings import AppSetting
        editable, _secret = _editable_nonsecret_keys()
        applied = 0
        for key, value in parsed.items():
            if key not in editable:
                log.warning("settings.yaml: neznámý klíč '%s' — ignorován", key)
                continue
            if value is None or isinstance(value, (dict, list)):
                log.warning("settings.yaml: klíč '%s' má nepodporovanou hodnotu — ignorován", key)
                continue
            sval = str(value).strip() if not isinstance(value, bool) else ("true" if value else "false")
            row = db.query(AppSetting).filter(AppSetting.key == key).first()
            if row is None:
                db.add(AppSetting(key=key, value=sval))
                applied += 1
            elif (row.value or "") != sval:
                row.value = sval
                applied += 1
        db.commit()
        if applied:
            log.info("settings.yaml: naimportováno %d změněných klíčů", applied)
        # Re-export to normalize formatting and strip any secrets that were
        # hand-added; this also refreshes the mtime marker.
        export_settings(db)
        return applied
    except Exception as exc:
        log.warning("settings.yaml import failed: %s", exc)
        return 0
