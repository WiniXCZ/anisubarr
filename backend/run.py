"""
run.py – Entrypoint that runs both Anisubarr apps in one process:

  • app.main:app         (admin UI + full API)   → port ANISUBARR_PORT (default 8000)
  • app.public_main:public_app (public visitor site) → port PUBLIC_PORT (default 8090)

Only main.py's lifespan touches the database schema / scheduler — public_main.py
is a thin read-only layer on the same SQLite file, so there's no double-init.

If PUBLIC_PORT is set to an empty string or "0", the public site is disabled
and only the admin app runs (useful if you don't want the second port at all).
"""
import asyncio
import os

import uvicorn


async def main() -> None:
    admin_port = int(os.environ.get("ANISUBARR_PORT", "8000"))
    public_port_raw = os.environ.get("PUBLIC_PORT", "8090")

    from app.main import app as admin_app

    admin_config = uvicorn.Config(admin_app, host="0.0.0.0", port=admin_port, log_level="info")
    servers = [uvicorn.Server(admin_config).serve()]

    if public_port_raw and public_port_raw != "0":
        from app.public_main import public_app

        public_config = uvicorn.Config(public_app, host="0.0.0.0", port=int(public_port_raw), log_level="info")
        servers.append(uvicorn.Server(public_config).serve())
    else:
        print("[run.py] PUBLIC_PORT disabled — public visitor site not started")

    await asyncio.gather(*servers)


if __name__ == "__main__":
    asyncio.run(main())
