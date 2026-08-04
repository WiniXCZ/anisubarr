"""
Shared test setup.

The login endpoint rate-limits by client IP (10 attempts a minute), and every
test module logs in from the same TestClient address. Past ten modules the suite
trips that limit and unrelated tests start failing on 429 — a failure that looks
like a broken feature but is only leaked process state. Clearing the counter
between tests keeps the suite honest without weakening the product: the rate
limit itself still has its own coverage in test_smoke.

Imports happen inside the fixture on purpose. Test modules set DATABASE_URL at
import time, and conftest is imported first — pulling the app in here would
build the engine against the wrong database.
"""
import pytest


@pytest.fixture(autouse=True)
def _reset_login_rate_limit():
    try:
        from app.routers import auth
        with auth._rate_lock:
            auth._attempts.clear()
    except Exception:
        pass
    yield
