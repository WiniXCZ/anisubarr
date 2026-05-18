from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text
from sqlalchemy.sql import func
from ..database import Base


class ScheduledJob(Base):
    __tablename__ = "scheduled_jobs"

    id           = Column(Integer, primary_key=True, index=True)
    job_id       = Column(String, unique=True, index=True, nullable=False)   # internal key e.g. "sonarr_sync"
    name         = Column(String, nullable=False)                             # display name
    description  = Column(Text, nullable=True)
    interval     = Column(String, nullable=False, default="daily")           # hourly/daily/weekly/monthly
    hour         = Column(Integer, nullable=True, default=3)                 # for daily/weekly/monthly
    minute       = Column(Integer, nullable=True, default=0)
    day_of_week  = Column(Integer, nullable=True, default=0)                 # 0=Mon for weekly
    day_of_month = Column(Integer, nullable=True, default=1)                 # 1-28 for monthly
    enabled      = Column(Boolean, default=True)
    last_run_at  = Column(DateTime(timezone=True), nullable=True)
    last_status  = Column(String, nullable=True)                             # "ok" / "error: ..."
    created_at   = Column(DateTime(timezone=True), server_default=func.now())
    updated_at   = Column(DateTime(timezone=True), onupdate=func.now())
