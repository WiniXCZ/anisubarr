from __future__ import annotations

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.sql import func

from ..database import Base


class ApiKey(Base):
    __tablename__ = "api_keys"

    id         = Column(Integer, primary_key=True, index=True)
    user_id    = Column(Integer, ForeignKey("users.id"), nullable=False)
    name       = Column(String, nullable=False)           # popis klíče
    key_hash   = Column(String, unique=True, nullable=False)  # SHA-256 hash
    key_prefix = Column(String, nullable=False)            # prvních 8 znaků
    created_at = Column(DateTime, server_default=func.now())
    last_used  = Column(DateTime, nullable=True)
    is_active  = Column(Boolean, default=True)
