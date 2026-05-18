from __future__ import annotations

from sqlalchemy import Column, String

from ..database import Base


class AppSetting(Base):
    """Key-value store for runtime-editable settings.

    Values here override the corresponding .env / pydantic-settings values.
    The .env file remains the default fallback.
    """

    __tablename__ = "app_settings"

    key   = Column(String, primary_key=True)
    value = Column(String, nullable=True)
