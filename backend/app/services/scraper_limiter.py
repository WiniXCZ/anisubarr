"""
scraper_limiter.py – global politeness limiter for subtitle provider requests.

Why this exists
---------------
Subtitle sites are small community servers. Anisubarr previously enforced a
delay only inside one bulk-download loop, so every other path (the nightly
download_missing job, webhook auto-download, parallel bulk jobs) could hammer a
provider as fast as the network allowed — enough to take a site down and get the
user's account banned.

The limiter therefore lives at the lowest level: every scraper's HTTP call goes
through acquire(), so no call path — existing or future — can bypass it.

Three protections, all per-provider:
  1. minimum interval between requests (serialised across threads),
  2. a hard daily request budget (fails closed when exhausted),
  3. a circuit breaker: a 429/503 backs every caller off for a cooldown window.

Settings (AppSetting keys, read fresh but cached briefly):
  scraper_min_interval_seconds  default 3.0
  scraper_daily_limit           default 1500   (0 = unlimited, discouraged)
"""
from __future__ import annotations

import logging
import threading
import time
from datetime import date

log = logging.getLogger("anisubarr.scraper_limiter")

_DEFAULT_MIN_INTERVAL = 3.0
_DEFAULT_DAILY_LIMIT = 1500

# Never allow a faster cadence than this, whatever the setting says — a
# misconfigured "0" must not turn into a flood.
_HARD_MIN_INTERVAL = 1.0


class RateLimitExceeded(RuntimeError):
    """Raised when the daily budget is spent or the provider is cooling down."""


class _ProviderState:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.last_request = 0.0
        self.day = date.today()
        self.count = 0
        self.blocked_until = 0.0


_states: dict[str, _ProviderState] = {}
_states_lock = threading.Lock()

# Settings cache — acquire() runs on every request, so don't hit the DB each time.
_cfg_cache: dict = {"ts": 0.0, "interval": _DEFAULT_MIN_INTERVAL, "limit": _DEFAULT_DAILY_LIMIT}
_CFG_TTL = 30.0


def _state(provider: str) -> _ProviderState:
    with _states_lock:
        st = _states.get(provider)
        if st is None:
            st = _ProviderState()
            _states[provider] = st
        return st


def _clamp(interval: float, limit: int) -> tuple[float, int]:
    """Force configured values into a safe range.

    The interval floor is the important one: a hand-edited settings.yaml with
    `scraper_min_interval_seconds: 0` must not become an unthrottled flood.
    """
    return max(_HARD_MIN_INTERVAL, float(interval)), max(0, int(limit))


def _config() -> tuple[float, int]:
    now = time.monotonic()
    if now - _cfg_cache["ts"] < _CFG_TTL:
        return _cfg_cache["interval"], _cfg_cache["limit"]

    interval, limit = _DEFAULT_MIN_INTERVAL, _DEFAULT_DAILY_LIMIT
    try:
        from ..database import SessionLocal
        from ..models.app_settings import AppSetting
        db = SessionLocal()
        try:
            rows = {
                r.key: r.value
                for r in db.query(AppSetting).filter(
                    AppSetting.key.in_(["scraper_min_interval_seconds", "scraper_daily_limit"])
                ).all()
            }
            if rows.get("scraper_min_interval_seconds"):
                interval = float(rows["scraper_min_interval_seconds"])
            if rows.get("scraper_daily_limit"):
                limit = int(rows["scraper_daily_limit"])
        finally:
            db.close()
    except Exception:
        pass  # defaults are the safe choice

    interval, limit = _clamp(interval, limit)
    _cfg_cache.update({"ts": now, "interval": interval, "limit": limit})
    return interval, limit


def acquire(provider: str) -> None:
    """Block until it's polite to send a request to *provider*.

    Raises RateLimitExceeded if the daily budget is spent or the provider is in
    a backoff window — callers should treat that as "skip this provider", not
    as a transient error to retry.
    """
    interval, daily_limit = _config()
    st = _state(provider)

    # Serialising on the provider lock is deliberate: it enforces the interval
    # across every thread (bulk jobs, scheduler, webhooks) instead of letting
    # each one keep its own private cadence.
    with st.lock:
        now_wall = time.time()
        if now_wall < st.blocked_until:
            wait = int(st.blocked_until - now_wall)
            raise RateLimitExceeded(
                f"{provider}: server nás odmítl (429/503) — pauza ještě {wait}s"
            )

        today = date.today()
        if st.day != today:
            st.day = today
            st.count = 0

        if daily_limit and st.count >= daily_limit:
            raise RateLimitExceeded(
                f"{provider}: vyčerpán denní limit {daily_limit} požadavků "
                f"(nastavitelné v Nastavení → Zdroje titulků)"
            )

        elapsed = time.monotonic() - st.last_request
        if st.last_request and elapsed < interval:
            time.sleep(interval - elapsed)

        st.last_request = time.monotonic()
        st.count += 1


def note_rejection(provider: str, retry_after=None) -> None:
    """Record a 429/503 — backs every caller off this provider for a while.

    `retry_after` is whatever the header held: seconds, an HTTP-date, or None.
    Anything unparseable just falls back to the minimum cooldown.
    """
    try:
        parsed = float(retry_after) if retry_after is not None else 0.0
    except (TypeError, ValueError):
        parsed = 0.0  # HTTP-date form or junk — use the floor below
    cooldown = max(parsed, 300.0)  # at least 5 minutes
    st = _state(provider)
    with st.lock:
        st.blocked_until = time.time() + cooldown
    log.warning(
        "[limiter] %s odmítl požadavek — pauza %.0f s pro všechny úlohy",
        provider, cooldown,
    )


def usage() -> dict:
    """Snapshot for diagnostics (/api/system/diag)."""
    interval, limit = _config()
    out: dict = {"min_interval_seconds": interval, "daily_limit": limit, "providers": {}}
    now = time.time()
    with _states_lock:
        items = list(_states.items())
    for name, st in items:
        with st.lock:
            out["providers"][name] = {
                "requests_today": st.count if st.day == date.today() else 0,
                "blocked_for_seconds": max(0, int(st.blocked_until - now)),
            }
    return out
