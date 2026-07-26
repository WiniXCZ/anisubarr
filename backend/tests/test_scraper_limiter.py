"""
Tests for the provider politeness limiter.

These guard the behaviour that matters after the incident where a nightly job
issued ~11k requests in two hours and got the user banned: the limiter must
enforce spacing across threads, stop dead when the daily budget is gone, and
back everyone off when a provider says 429.
"""
import os
import tempfile
import threading
import time

_tmpdir = tempfile.mkdtemp(prefix="anisubarr-limiter-test-")
os.environ.setdefault("DATABASE_URL", f"sqlite:///{_tmpdir}/test.db")
os.environ.setdefault("JWT_SECRET", "test-secret-not-for-production")

import pytest  # noqa: E402

from app.services import scraper_limiter as lim  # noqa: E402


@pytest.fixture(autouse=True)
def _reset():
    """Fresh limiter state and a known config for every test."""
    with lim._states_lock:
        lim._states.clear()
    lim._cfg_cache.update({"ts": time.monotonic(), "interval": 0.05, "limit": 5})
    yield
    with lim._states_lock:
        lim._states.clear()


def test_enforces_minimum_interval():
    lim.acquire("p")           # first call is free
    start = time.monotonic()
    lim.acquire("p")
    assert time.monotonic() - start >= 0.045


def test_interval_is_shared_across_threads():
    """Two threads must not each keep their own private cadence — that was the
    bug that let parallel bulk jobs multiply the request rate."""
    lim.acquire("p")
    start = time.monotonic()

    def _hit():
        lim.acquire("p")

    threads = [threading.Thread(target=_hit) for _ in range(3)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    # 3 further requests, each spaced by the interval.
    assert time.monotonic() - start >= 0.045 * 3


def test_daily_limit_fails_closed():
    for _ in range(5):
        lim.acquire("p")
    with pytest.raises(lim.RateLimitExceeded) as exc:
        lim.acquire("p")
    assert "denní limit" in str(exc.value)


def test_daily_limit_is_per_provider():
    for _ in range(5):
        lim.acquire("a")
    lim.acquire("b")  # separate budget — must not raise


def test_rejection_blocks_all_callers():
    lim.note_rejection("p", retry_after="120")
    with pytest.raises(lim.RateLimitExceeded) as exc:
        lim.acquire("p")
    assert "odmítl" in str(exc.value)


def test_rejection_tolerates_http_date_header():
    """Retry-After may be an HTTP-date; it must not blow up the limiter."""
    lim.note_rejection("p", retry_after="Wed, 21 Oct 2026 07:28:00 GMT")
    with pytest.raises(lim.RateLimitExceeded):
        lim.acquire("p")


def test_hard_floor_on_interval():
    """A misconfigured interval of 0 must not turn into an unthrottled flood."""
    interval, limit = lim._clamp(0.0, 0)
    assert interval >= lim._HARD_MIN_INTERVAL
    assert limit == 0  # 0 = unlimited budget, but the interval still applies
    # A negative budget can't mean "unlimited by accident" either.
    assert lim._clamp(5.0, -10)[1] == 0


def test_usage_reports_counts():
    lim.acquire("p")
    usage = lim.usage()
    assert usage["providers"]["p"]["requests_today"] == 1
