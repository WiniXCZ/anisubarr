r"""
path_resolver.py – Maps Sonarr file paths to locally accessible paths.

Sonarr always returns its own internal paths, e.g.:
    /data/media/anime_series/Show (2020)/Season 01/Show.S01E01.mkv

These need to be translated to a path the backend process can actually reach:

  WINDOWS DEV (SMB):
    Sonarr prefix:  /data
    Local prefix:   \\192.168.1.149\data
    Result:         \\192.168.1.149\data\media\anime_series\Show (2020)\Season 01\Show.S01E01.mkv

  DOCKER (volume mount):
    Sonarr prefix:  /data
    Local prefix:   /media
    Result:         /media/media/anime_series/Show (2020)/Season 01/Show.S01E01.mkv

Configuration (via .env):
    PATH_SONARR_PREFIX=/data          # the leading part of Sonarr paths to strip
    PATH_LOCAL_PREFIX=\\192.168.1.149\data   # what to replace it with
    SMB_HOST / SMB_USERNAME / SMB_PASSWORD  # only needed on Windows
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
import time
import logging
from pathlib import PurePosixPath, PureWindowsPath
from .subtitle_utils import smb_authenticate

log = logging.getLogger("anisubarr.path_resolver")

_smb_authed: bool = False

# Short-lived cache for _cfg_value(). resolve() is called in tight loops over
# whole libraries; without this, every call opened a fresh DB session just to
# re-read the same path prefixes. A few seconds of staleness on a rarely-changed
# setting is harmless and cuts the session churn to (at most) one per key per TTL.
_cfg_cache: dict[str, tuple[float, str]] = {}
_CFG_TTL = 5.0  # seconds


def _cfg_cache_clear() -> None:
    """Drop the cache so a settings change is picked up immediately."""
    _cfg_cache.clear()


def _cfg_value(key: str, env_default: str = "") -> str:
    """
    Read a config value: DB AppSetting override (set via Nastavení → Síť) first,
    falling back to the .env/pydantic default.

    `get_settings()` is lru_cache'd and only reflects .env at process start, so
    without this DB check, path/SMB settings changed in the UI would silently
    have no effect until the container restarts.

    Cached for _CFG_TTL seconds to avoid a DB session per resolve() in hot loops.
    """
    now = time.monotonic()
    cached = _cfg_cache.get(key)
    if cached and now - cached[0] < _CFG_TTL:
        return cached[1] or env_default

    value = env_default
    try:
        from ..database import SessionLocal
        from ..models.app_settings import AppSetting
        db = SessionLocal()
        try:
            row = db.query(AppSetting).filter(AppSetting.key == key).first()
            if row and row.value:
                value = row.value
        finally:
            db.close()
    except Exception:
        pass
    _cfg_cache[key] = (now, value if value != env_default else "")
    return value


def media_access_mode() -> str:
    """Return 'smb' or 'local' (default). Configurable in Nastavení → Síť → Média."""
    from ..config import get_settings
    cfg = get_settings()
    mode = _cfg_value("media_access_mode", cfg.media_access_mode or "local")
    return mode if mode in ("smb", "local") else "local"


def resolve(sonarr_path: str) -> str:
    """
    Convert a Sonarr-side path to a locally accessible path.

    Returns the translated path (string). On Windows (or when explicitly set to
    "smb" mode) the result is a UNC path. Otherwise it is a plain local/POSIX
    path (Docker volume mount or other root directory).
    Raises ValueError if PATH_SONARR_PREFIX / PATH_LOCAL_PREFIX are not configured.
    """
    from ..config import get_settings
    cfg = get_settings()

    sonarr_prefix = _cfg_value("path_sonarr_prefix", cfg.path_sonarr_prefix or "").rstrip("/\\")
    local_prefix  = _cfg_value("path_local_prefix",  cfg.path_local_prefix  or "").rstrip("/\\")

    if not sonarr_prefix or not local_prefix:
        # No mapping configured — return as-is and hope for the best
        log.warning("PATH_SONARR_PREFIX / PATH_LOCAL_PREFIX not set; using Sonarr path as-is")
        return sonarr_path

    # Normalise the sonarr path to forward slashes for comparison
    normalised = sonarr_path.replace("\\", "/")

    sonarr_prefix_norm = sonarr_prefix.replace("\\", "/")
    if not normalised.startswith(sonarr_prefix_norm):
        log.warning(f"Sonarr path '{sonarr_path}' does not start with prefix '{sonarr_prefix}'")
        return sonarr_path

    # Strip the Sonarr prefix, keep the rest
    relative = normalised[len(sonarr_prefix_norm):]   # starts with '/'

    if sys.platform == "win32":
        # Convert relative POSIX → Windows separator
        rel_win  = relative.lstrip("/").replace("/", "\\")
        result   = f"{local_prefix.rstrip(chr(92))}\\{rel_win}"
    else:
        # Keep POSIX separators
        result = local_prefix + relative

    # ── Fallback for cache-only Unraid shares ──────────────────────────────
    # If PATH_LOCAL_PREFIX (e.g. /media) is a bind mount of /mnt/user, and the
    # target share has "use cache: only" set, the resulting path doubles up
    # (e.g. /media/media/...) and points at a relative symlink
    # (/mnt/user/media -> ../cache/media) that doesn't resolve inside the
    # container. If a separate PATH_CACHE_PREFIX bind mount (e.g. /cache for
    # host /mnt/cache) is configured and the primary path is missing, try the
    # equivalent path under the cache prefix instead.
    cache_prefix = _cfg_value("path_cache_prefix", cfg.path_cache_prefix or "")
    if sys.platform != "win32" and cache_prefix:
        double_prefix = local_prefix + local_prefix
        if result.startswith(double_prefix) and not os.path.exists(result):
            alt = cache_prefix.rstrip("/\\") + result[len(local_prefix):]
            if os.path.exists(alt):
                log.debug("resolve: falling back to cache path %s for %s", alt, sonarr_path)
                return alt

    return result


def unc_to_local(path: str) -> str:
    """Convert \\\\server\\share\\... to X:\\... using existing 'net use' mappings.

    Handles hostname ↔ IP mismatches (e.g. net use shows \\TOWER\\data but the
    path arrives as \\192.168.1.149\\data) by resolving both sides via socket.
    Returns path unchanged on non-Windows or if no matching mapping exists.
    """
    if sys.platform != "win32":
        return path
    if not path.startswith("\\\\"):
        return path

    import socket

    def _resolve_host(host: str) -> str:
        try:
            return socket.gethostbyname(host)
        except Exception:
            return host

    # Resolve the IP of the host in the incoming path
    parts = path.lstrip("\\").split("\\", 1)          # e.g. ['192.168.1.149', 'data\\...']
    path_host_ip = _resolve_host(parts[0]) if parts else ""

    try:
        result = subprocess.run(
            ["net", "use"],
            capture_output=True, text=True, encoding="cp852", timeout=5,
        )
        for line in result.stdout.splitlines():
            m = re.match(r"\S+\s+([A-Za-z]:)\s+(\\\\[^\s]+)", line)
            if not m:
                continue
            drive, share = m.group(1).upper(), m.group(2).rstrip("\\")
            # Direct string match
            if path.lower().startswith(share.lower()):
                rest = path[len(share):].lstrip("\\")
                log.debug("unc_to_local: %s → %s\\%s", share, drive, rest)
                return f"{drive}\\{rest}"
            # Hostname ↔ IP match
            share_parts = share.lstrip("\\").split("\\", 1)
            if share_parts:
                share_host_ip = _resolve_host(share_parts[0])
                share_suffix  = share_parts[1] if len(share_parts) > 1 else ""
                ip_share = f"\\\\{share_host_ip}\\{share_suffix}" if share_suffix else f"\\\\{share_host_ip}"
                if path.lower().startswith(ip_share.lower()):
                    rest = path[len(ip_share):].lstrip("\\")
                    log.debug("unc_to_local (hostname resolved): %s → %s\\%s", ip_share, drive, rest)
                    return f"{drive}\\{rest}"
                # Also try: incoming path with IP matches share after IP resolution
                if path_host_ip and share_host_ip == path_host_ip:
                    path_suffix = parts[1] if len(parts) > 1 else ""
                    if share_suffix and path_suffix.lower().startswith(share_suffix.lower()):
                        rest = path_suffix[len(share_suffix):].lstrip("\\")
                        log.debug("unc_to_local (ip match): %s → %s\\%s", share, drive, rest)
                        return f"{drive}\\{rest}"
    except Exception as exc:
        log.warning("unc_to_local: %s", exc)
    log.warning("unc_to_local: no drive mapping found for %s", path)
    return path


def ensure_smb(path: str) -> None:
    """
    If running on Windows and the path is a UNC path, make sure we're
    authenticated to the share. No-op on Linux.
    Called once before any file write/read; subsequent calls are cached.

    Strategy:
    1. Try to resolve the UNC path to a drive letter via existing 'net use' mappings.
       If found, trust it and skip authentication (avoids Windows error 1219).
       NOTE: we do NOT do a write-access probe here because the share root
       may be read-only (Sonarr/nobody owns it) while subdirectories are writable.
       Real write errors are caught and reported in write_subtitle().
    2. If not mapped, call smb_authenticate() + map the share.
    """
    global _smb_authed
    if sys.platform != "win32":
        return
    if not path.startswith("\\\\"):
        return
    if _smb_authed:
        return

    from ..config import get_settings
    cfg = get_settings()
    local_prefix = _cfg_value("path_local_prefix", cfg.path_local_prefix or "").rstrip("\\")
    smb_host     = _cfg_value("smb_host",     cfg.smb_host or "")
    smb_username = _cfg_value("smb_username", cfg.smb_username or "")
    smb_password = _cfg_value("smb_password", cfg.smb_password or "")

    # ── Step 1: check for an existing drive-letter mapping ────────────────────
    mapped = unc_to_local(path)
    if mapped != path:
        # Drive letter found — share is already mounted, trust it
        log.info(f"SMB: path already mapped ({path} → {mapped}), skipping auth")
        _smb_authed = True
        return

    # ── Step 2: no existing mapping — authenticate and map the share ──────────
    if not smb_username:
        log.warning("SMB_USERNAME not configured — file write may fail on protected shares")
        return

    ok, msg = smb_authenticate(smb_host, smb_username, smb_password)
    if ok:
        log.info(f"SMB: {msg}")
        _smb_authed = True
    else:
        log.error(f"SMB auth failed: {msg}")
        raise PermissionError(f"SMB authentication failed: {msg}")

    # Also map the actual data share (PATH_LOCAL_PREFIX) to a drive letter so that
    # unc_to_local() can resolve it even when the hostname differs from SMB_HOST.
    if local_prefix.startswith("\\\\"):
        try:
            result = subprocess.run(["net", "use"], capture_output=True, text=True,
                                    encoding="cp852", timeout=5)
            already_mapped = local_prefix.lower() in result.stdout.lower()
        except Exception:
            already_mapped = False

        if not already_mapped:
            cmd = ["net", "use", local_prefix, smb_password, f"/user:{smb_username}",
                   "/persistent:yes"]
            try:
                r = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
                if r.returncode == 0:
                    log.info(f"SMB: mapped share {local_prefix}")
                else:
                    log.warning(f"SMB: share mapping failed for {local_prefix}: "
                                f"{(r.stdout + r.stderr).strip()[:200]}")
            except Exception as exc:
                log.warning(f"SMB: share mapping error for {local_prefix}: {exc}")


def subtitle_path_for(episode_path: str, language: str, ext: str) -> str:
    """
    Given a Sonarr episode path, return the drive-letter path for saving a subtitle.
    e.g.  /data/.../Show.S01E01.mkv  →  Y:\\...\\Show.S01E01.cs.srt
    """
    local_video = unc_to_local(resolve(episode_path))
    base        = os.path.splitext(local_video)[0]
    return f"{base}.{language}.{ext}"


def write_subtitle(dest_path: str, data: bytes) -> None:
    """
    Write subtitle bytes to dest_path.
    - Ensures SMB authentication and share mapping are in place.
    - Converts UNC to drive letter first (unc_to_local).
    - Clears read-only flag if the file already exists.
    """
    import stat

    # Authenticate and map SMB share if needed (no-op on Linux or when already done)
    ensure_smb(dest_path)

    local_path = unc_to_local(dest_path)

    # Ensure target directory exists (Sonarr already created it, but just in case)
    target_dir = os.path.dirname(local_path)
    if target_dir:
        try:
            os.makedirs(target_dir, exist_ok=True)
        except Exception as mkdir_err:
            log.warning(f"write_subtitle: makedirs({target_dir}) failed: {mkdir_err}")
        # If makedirs failed AND directory still doesn't exist, fail early with a clear error
        # instead of letting open() produce a confusing "No such file or directory"
        if not os.path.isdir(target_dir):
            raise PermissionError(
                f"Zápis titulku selhal: cílová složka neexistuje a nelze ji vytvořit.\n"
                f"Složka: {target_dir}\n"
                f"Pravděpodobná příčina: Backend nemá oprávnění zápisu na síťový disk, "
                f"nebo disk není dostupný. Ověř mapování disku (net use) a přístupová práva SMB."
            )

    # If the file already exists and is read-only, strip the flag before writing
    if os.path.isfile(local_path):
        try:
            mode = os.stat(local_path).st_mode
            if not (mode & stat.S_IWRITE):
                os.chmod(local_path, mode | stat.S_IWRITE)
                log.info(f"write_subtitle: cleared read-only flag on {local_path}")
        except Exception as chmod_err:
            log.warning(f"write_subtitle: chmod failed on {local_path}: {chmod_err}")

    try:
        with open(local_path, "wb") as f:
            f.write(data)
        log.info(f"Saved subtitle → {local_path}")
    except PermissionError as e:
        # Give actionable diagnostic info rather than a raw OS error
        dir_exists  = os.path.isdir(target_dir)  if target_dir else False
        dir_writable = False
        if dir_exists:
            try:
                test_file = os.path.join(target_dir, ".write_test_tmp")
                with open(test_file, "wb") as _f:
                    _f.write(b"x")
                os.remove(test_file)
                dir_writable = True
            except Exception:
                pass

        hint = (
            f"Složka existuje: {'ano' if dir_exists else 'NE'}, "
            f"zápis do složky: {'ano' if dir_writable else 'NE'}.\n"
        )
        if not dir_writable:
            # Detect if this is likely a promoted anime_series folder with nobody permissions
            path_lower = (local_path or "").lower().replace("\\", "/")
            is_promoted_folder = any(k in path_lower for k in ("anime_series", "anime series"))
            if is_promoted_folder:
                hint += (
                    "Složka je pravděpodobně 'anime_series' — Sonarr (Docker, nobody:nobody) tam\n"
                    "soubory přesunul, ale složky mají práva 755 (nobody:nobody), takže Windows\n"
                    "SMB uživatel (jiný než nobody) nemůže zapisovat.\n"
                    "Řešení na NAS/Unraid: chmod 777 nebo nastav ACL tak, aby SMB uživatel\n"
                    "měl write přístup do anime_series (Settings → Shares → anime_series → Security).\n"
                    "Alternativa: spusť Sonarr i backend jako stejný uživatel."
                )
            else:
                hint += (
                    "Uvicorn nemá oprávnění zápisu do cílové složky.\n"
                    "Řešení: Spusť backend pod účtem, který má přístup k síťovému disku,\n"
                    "nebo nastav SMB_USERNAME/SMB_PASSWORD a ujisti se, že Y:\\ je namapováno\n"
                    "s oprávněním zápisu (ne jen čtení)."
                )
        raise PermissionError(
            f"Zápis titulku selhal: {e}\n"
            f"Cesta: {local_path}\n"
            f"{hint}"
        ) from e


def reset_smb_cache():
    """Force re-authentication on next write (e.g. after credential change)."""
    global _smb_authed
    _smb_authed = False
