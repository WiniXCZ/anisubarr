from __future__ import annotations

import secrets

from sqlalchemy import Column, Integer, String, Boolean, DateTime
from sqlalchemy.sql import func

from ..database import Base


def _gen_token() -> str:
    return secrets.token_urlsafe(24)


class NewsletterSubscriber(Base):
    """
    An email address subscribed to Anisubarr news (new/published series, etc.)
    via the public visitor site. No login required to subscribe — `unsubscribe_token`
    is the only credential, sent in unsubscribe links.
    """
    __tablename__ = "newsletter_subscribers"

    id                = Column(Integer, primary_key=True, index=True)
    email             = Column(String, unique=True, nullable=False, index=True)
    active            = Column(Boolean, default=True, nullable=False)
    unsubscribe_token = Column(String, unique=True, nullable=False, default=_gen_token)
    created_at        = Column(DateTime(timezone=True), server_default=func.now())
    unsubscribed_at   = Column(DateTime(timezone=True), nullable=True)
