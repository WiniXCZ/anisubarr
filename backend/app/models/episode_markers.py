from sqlalchemy import Column, Integer, String, Float, ForeignKey
from sqlalchemy.orm import relationship
from ..database import Base


class EpisodeMarker(Base):
    __tablename__ = "episode_markers"

    id           = Column(Integer, primary_key=True, index=True)
    episode_id   = Column(Integer, ForeignKey("episodes.id"), nullable=False, index=True)
    type         = Column(String, nullable=False)  # intro_start / intro_end / outro_start / outro_end
    time_seconds = Column(Float, nullable=False)

    episode = relationship("Episode")
