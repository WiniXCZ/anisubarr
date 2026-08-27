#!/bin/sh
# Drop root before starting, the way every other Unraid container does.
#
# The image used to run as root, so every subtitle and NFO it wrote came out
# owned by root:root. Emby runs as nobody and could not rewrite its own
# metadata afterwards — hundreds of "Error in metadata saver: Permission
# denied" in Emby's log, for files Anisubarr had created first.
#
# PUID/PGID are the Unraid convention (99:100 = nobody:users). Leave them unset
# and the container keeps running as root exactly as before, so an existing
# deployment does not change under anyone's feet.
set -e

if [ -n "$PUID" ] || [ -n "$PGID" ]; then
    PUID="${PUID:-99}"
    PGID="${PGID:-100}"

    # UMASK 002 gives 664 files in 775 folders: readable and writable by the
    # group the whole media stack shares.
    umask "${UMASK:-002}"

    if ! getent group anisubarr >/dev/null 2>&1; then
        groupadd -o -g "$PGID" anisubarr
    fi
    if ! getent passwd anisubarr >/dev/null 2>&1; then
        useradd -o -u "$PUID" -g "$PGID" -M -d /app -s /sbin/nologin anisubarr
    fi

    # Only /app — the image's own files and the SQLite volume under
    # /app/backend/data. Never a path from a variable and never the media
    # mounts: /media and /cache point at the whole library, and a recursive
    # chown there would rewrite the ownership of everything Sonarr owns.
    chown -R "$PUID:$PGID" /app 2>/dev/null || true

    echo "[entrypoint] běžím jako ${PUID}:${PGID}, umask $(umask)"
    exec gosu "$PUID:$PGID" "$@"
fi

echo "[entrypoint] PUID/PGID nenastavené — běžím jako root (nastav PUID=99 PGID=100)"
exec "$@"
