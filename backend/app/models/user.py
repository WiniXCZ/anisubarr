from sqlalchemy import Column, Integer, String, Boolean, DateTime
from sqlalchemy.sql import func
from ..database import Base


class User(Base):
    __tablename__ = "users"

    id          = Column(Integer, primary_key=True, index=True)
    username    = Column(String, unique=True, index=True, nullable=False)
    email       = Column(String, unique=True, index=True, nullable=True)
    hashed_pw   = Column(String, nullable=False)
    is_admin    = Column(Boolean, default=False)
    is_active   = Column(Boolean, default=True)
    created_at  = Column(DateTime(timezone=True), server_default=func.now())
    # Role: viewer | custom | admin
    role        = Column(String, default="viewer")
    # JSON string with boolean permissions — used only for role='custom'
    permissions = Column(String, nullable=True)
