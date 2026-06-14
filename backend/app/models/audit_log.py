from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from ..database import Base


class SeriesAuditLog(Base):
    """Per-series audit / subtitle-state event log.

    Records state transitions, subtitle search hits/misses, Seerr reports,
    hiyori "planned" check results, and damage_ratio re-evaluations — shown
    chronologically in the series detail "Log" tab.
    """
    __tablename__ = "series_audit_log"

    id          = Column(Integer, primary_key=True, index=True)
    series_id   = Column(Integer, ForeignKey("series.id"), nullable=False, index=True)

    # event categories:
    #   state_change        – audit_status transition (old -> new)
    #   subtitle_search     – hiyori/hns search attempt (hit or miss)
    #   seerr_report        – new/updated Seerr issue affecting this series
    #   hiyori_check        – hiyori "planned/revived" check result
    #   damage_eval         – damage_ratio re-evaluation result
    #   subtitle_confidence – subtitle_confidence re-evaluation result
    #   info                – generic informational entry
    event_type  = Column(String, nullable=False, index=True)

    message     = Column(Text, nullable=False)   # human-readable summary (Czech)
    detail      = Column(Text, nullable=True)    # optional JSON blob with structured data

    created_at  = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    series = relationship("Series")
