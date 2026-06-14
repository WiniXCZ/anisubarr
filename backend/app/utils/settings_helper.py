from __future__ import annotations

import os


def read_setting(key: str, db=None) -> str | None:
    """Read a setting: DB AppSetting → pydantic config → env vars."""
    if db is not None:
        try:
            from ..models.app_settings import AppSetting
            row = db.query(AppSetting).filter(AppSetting.key == key).first()
            if row and row.value:
                return row.value
        except Exception:
            pass
    from ..config import get_settings
    val = getattr(get_settings(), key, None)
    if val:
        return str(val)
    return os.environ.get(key.upper())
