from sqlalchemy import Column, Integer, String, DateTime
from sqlalchemy.sql import func
from ..database import Base


class JobRunModel(Base):
    __tablename__ = "job_runs"

    id          = Column(Integer, primary_key=True, index=True)
    run_id      = Column(String,  unique=True, index=True, nullable=False)
    job_id      = Column(String,  index=True,  nullable=False)
    job_name    = Column(String,  nullable=False)
    status      = Column(String,  default="running", nullable=False)  # running / done / error
    started_at  = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    finished_at = Column(DateTime(timezone=True), nullable=True)
    message     = Column(String,  default="", nullable=False)
