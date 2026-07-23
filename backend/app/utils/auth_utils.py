from __future__ import annotations

import hashlib

API_KEY_PREFIX = "ansk_"


def hash_api_key(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()
