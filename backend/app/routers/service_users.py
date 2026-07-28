"""
service_users.py – read-only view of accounts on the connected services.

Anisubarr has its own users (routers/users.py); this lists the people who exist
in Seerr and Emby/Jellyfin, so an admin can see who requests media and who
watches it without opening two other web UIs.

Read-only on purpose: creating or editing accounts belongs in those apps.

Requires a login (like every other page), not admin — it is a top-level tab.

GET /api/service-users → {"users": [...], "sources": {...}}
"""
from __future__ import annotations

import asyncio
import logging

import httpx
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user
from ..models.user import User

log = logging.getLogger("anisubarr.service_users")

router = APIRouter(prefix="/api/service-users", tags=["service-users"])

_TIMEOUT = 8.0


def _base(host: str) -> str:
    host = (host or "").rstrip("/")
    if host and not host.startswith("http"):
        host = f"http://{host}"
    return host


async def _seerr_users(db: Session) -> tuple[list[dict], dict]:
    from ..services import connections
    host, api_key = connections.resolve_seerr(db)
    if not host or not api_key:
        return [], {"ok": False, "reason": "not_configured"}

    url = f"{_base(host)}/api/v1/user"
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
            r = await c.get(url, headers={"X-Api-Key": api_key},
                            params={"take": 100}, follow_redirects=True)
        r.raise_for_status()
        payload = r.json()
    except Exception as exc:
        log.warning("Seerr users failed: %s", exc)
        return [], {"ok": False, "reason": str(exc)[:120]}

    rows = payload.get("results") if isinstance(payload, dict) else payload
    users = []
    for u in rows or []:
        avatar = u.get("avatar") or ""
        # Seerr returns local avatars as a relative path.
        if avatar and not avatar.startswith("http"):
            avatar = f"{_base(host)}{avatar}"
        users.append({
            "source":    "seerr",
            "id":        u.get("id"),
            "name":      u.get("displayName") or u.get("username") or u.get("email") or "—",
            "email":     u.get("email"),
            "avatar":    avatar or None,
            "is_admin":  bool(u.get("permissions", 0) & 2),  # Seerr ADMIN bit
            "requests":  u.get("requestCount"),
            "last_seen": u.get("lastSeenAt") or u.get("updatedAt"),
        })
    return users, {"ok": True, "count": len(users)}


async def _emby_users(db: Session) -> tuple[list[dict], dict]:
    from ..services import connections
    host, api_key = connections.resolve_emby(db)
    if not host or not api_key:
        return [], {"ok": False, "reason": "not_configured"}

    url = f"{_base(host)}/Users"
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
            r = await c.get(url, headers={"X-Emby-Token": api_key}, follow_redirects=True)
        r.raise_for_status()
        rows = r.json()
    except Exception as exc:
        log.warning("Emby users failed: %s", exc)
        return [], {"ok": False, "reason": str(exc)[:120]}

    users = []
    for u in rows or []:
        policy = u.get("Policy") or {}
        uid = u.get("Id")
        tag = u.get("PrimaryImageTag")
        users.append({
            "source":    "emby",
            "id":        uid,
            "name":      u.get("Name") or "—",
            "email":     None,
            "avatar":    f"{_base(host)}/Users/{uid}/Images/Primary?tag={tag}" if (uid and tag) else None,
            "is_admin":  bool(policy.get("IsAdministrator")),
            "disabled":  bool(policy.get("IsDisabled")),
            "last_seen": u.get("LastActivityDate") or u.get("LastLoginDate"),
        })
    return users, {"ok": True, "count": len(users)}


def _match_keys(user: dict) -> list[str]:
    """Identities a person can be recognised by, most reliable first.

    Both keys are used, not just one: Emby doesn't expose e-mail addresses, so
    matching *only* on e-mail would never pair a Seerr account (which has one)
    with its Emby counterpart (which doesn't). Deliberately exact — no fuzzy
    matching, so two genuinely different people don't get glued together.
    """
    keys = []
    email = (user.get("email") or "").strip().casefold()
    if email:
        keys.append(f"email:{email}")
    name = (user.get("name") or "").strip().casefold()
    if name:
        keys.append(f"name:{name}")
    return keys


def _newest(*values):
    """Most recent of several ISO timestamps (strings sort correctly here)."""
    present = [v for v in values if v]
    return max(present) if present else None


def _merge(users: list[dict]) -> list[dict]:
    """Collapse the same person appearing on several services into one entry.

    Only merges *across* services — two accounts on the same service stay
    separate even if they share a name, since those really are different people.
    """
    groups: list[dict] = []
    by_key: dict[str, dict] = {}

    def _index(group: dict) -> None:
        for k in _match_keys(group):
            by_key.setdefault(k, group)

    for u in users:
        group = None
        for key in _match_keys(u):
            candidate = by_key.get(key)
            # A second account on a service already in the group is a different
            # person, so it must start its own entry.
            if candidate is not None and u["source"] not in candidate["sources"]:
                group = candidate
                break

        if group is None:
            group = {
                "name":      u.get("name"),
                "email":     u.get("email"),
                "avatar":    u.get("avatar"),
                "is_admin":  bool(u.get("is_admin")),
                "requests":  u.get("requests"),
                "last_seen": u.get("last_seen"),
                "sources":   [u["source"]],
                "ids":       {u["source"]: u.get("id")},
                # A service that doesn't report the flag counts as active.
                "_disabled_flags": [bool(u.get("disabled"))],
            }
            groups.append(group)
            _index(group)
            continue

        group["sources"].append(u["source"])
        group["ids"][u["source"]] = u.get("id")
        group["email"] = group["email"] or u.get("email")
        group["avatar"] = group["avatar"] or u.get("avatar")
        group["is_admin"] = group["is_admin"] or bool(u.get("is_admin"))
        if u.get("requests") is not None:
            group["requests"] = u["requests"]
        group["last_seen"] = _newest(group["last_seen"], u.get("last_seen"))
        group["_disabled_flags"].append(bool(u.get("disabled")))
        # The group may have just gained an e-mail — make it findable by it.
        _index(group)

    for g in groups:
        # Disabled only when the person is switched off everywhere; active on
        # any service means they're still around.
        g["disabled"] = all(g.pop("_disabled_flags"))
    return groups


@router.get("")
async def list_service_users(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> dict:
    """Users from Seerr and Emby, one entry per person.

    A failing service degrades to an empty list plus a reason, so one
    unreachable server doesn't hide the other's users.
    """
    (seerr_users, seerr_state), (emby_users, emby_state) = await asyncio.gather(
        _seerr_users(db), _emby_users(db)
    )
    users = _merge(seerr_users + emby_users)
    users.sort(key=lambda u: (u.get("name") or "").casefold())
    return {"users": users, "sources": {"seerr": seerr_state, "emby": emby_state}}
