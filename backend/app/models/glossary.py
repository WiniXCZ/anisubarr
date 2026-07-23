from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.sql import func
from ..database import Base


class GlossaryEntry(Base):
    __tablename__ = "glossary_entries"

    id          = Column(Integer, primary_key=True, index=True)
    src_lang    = Column(String, default="ja", nullable=False)
    tgt_lang    = Column(String, default="cs", nullable=False)
    src_text    = Column(String, nullable=False)
    tgt_text    = Column(String, nullable=False)
    notes       = Column(Text, nullable=True)
    # Optional scope: glossary entry can be global or tied to one series
    series_id   = Column(Integer, ForeignKey("series.id"), nullable=True)
    created_at  = Column(DateTime(timezone=True), server_default=func.now())
    updated_at  = Column(DateTime(timezone=True), onupdate=func.now())
