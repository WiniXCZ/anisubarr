"""
tray.pyw — Anisubarr system tray launcher.

Starts the uvicorn backend silently (no console window), keeps it alive,
and exposes a tray icon with Open / Restart / Quit actions.

Requirements (in the backend venv):
    pip install pystray pillow
"""
from __future__ import annotations

import os
import subprocess
import sys
import threading
import webbrowser
from pathlib import Path

BASE_DIR    = Path(__file__).parent
BACKEND_DIR = BASE_DIR / "backend"
LOG_FILE    = BASE_DIR / "backend.log"
APP_URL     = "http://localhost:8000"

# Use the same python that is running this script (should be venv's pythonw.exe)
PYTHON      = sys.executable.replace("pythonw.exe", "python.exe")


# ── Icon ──────────────────────────────────────────────────────────────────────

def _make_icon(color=(52, 120, 246)):
    """Draw a simple coloured circle with letter A."""
    from PIL import Image, ImageDraw, ImageFont
    size = 64
    img  = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.ellipse([2, 2, size - 2, size - 2], fill=(*color, 255))
    # Try a system font; fall back to default
    try:
        font = ImageFont.truetype("arial.ttf", 32)
    except Exception:
        font = ImageFont.load_default()
    draw.text((size // 2, size // 2), "A", fill="white", font=font, anchor="mm")
    return img


# ── Backend process management ────────────────────────────────────────────────

_proc:   subprocess.Popen | None = None
_log_fh = None
_lock   = threading.Lock()


def _start_backend() -> None:
    global _proc, _log_fh
    with _lock:
        _kill_backend_locked()
        try:
            _log_fh = open(LOG_FILE, "a", encoding="utf-8", buffering=1)
            _log_fh.write("\n=== Anisubarr backend start ===\n")
            _log_fh.flush()
        except Exception:
            _log_fh = subprocess.DEVNULL

        env = os.environ.copy()
        # Activate venv env vars
        venv_scripts = str(BACKEND_DIR / ".venv" / "Scripts")
        env["VIRTUAL_ENV"]           = str(BACKEND_DIR / ".venv")
        env["PATH"]                  = venv_scripts + os.pathsep + env.get("PATH", "")
        env.pop("PYTHONHOME", None)

        _proc = subprocess.Popen(
            [
                str(BACKEND_DIR / ".venv" / "Scripts" / "python.exe"),
                "-m", "uvicorn",
                "app.main:app",
                "--host", "0.0.0.0",
                "--port", "8000",
            ],
            cwd=str(BACKEND_DIR),
            stdout=_log_fh,
            stderr=_log_fh,
            env=env,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )


def _kill_backend_locked() -> None:
    """Must be called with _lock held."""
    global _proc, _log_fh
    if _proc and _proc.poll() is None:
        _proc.terminate()
        try:
            _proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            _proc.kill()
    _proc = None
    if _log_fh and _log_fh is not subprocess.DEVNULL:
        try:
            _log_fh.close()
        except Exception:
            pass
    _log_fh = None


def _watchdog(icon) -> None:
    """Restart backend automatically if it crashes."""
    import time
    while True:
        time.sleep(10)
        with _lock:
            if _proc is not None and _proc.poll() is not None:
                # Process exited unexpectedly
                _log_fh_local = _log_fh
                if _log_fh_local and _log_fh_local is not subprocess.DEVNULL:
                    try:
                        _log_fh_local.write(
                            f"\n[watchdog] Backend exited (rc={_proc.returncode}), restarting...\n"
                        )
                        _log_fh_local.flush()
                    except Exception:
                        pass
        # Restart outside the lock
        with _lock:
            if _proc is not None and _proc.poll() is not None:
                pass  # will restart below
            else:
                continue
        _start_backend()


# ── Tray actions ──────────────────────────────────────────────────────────────

def _on_open(icon, item):
    webbrowser.open(APP_URL)


def _on_restart(icon, item):
    def _do():
        icon.icon = _make_icon((255, 165, 0))   # orange while restarting
        _start_backend()
        icon.icon = _make_icon()                 # blue when done
    threading.Thread(target=_do, daemon=True).start()


def _on_log(icon, item):
    if LOG_FILE.exists():
        os.startfile(str(LOG_FILE))


def _on_quit(icon, item):
    with _lock:
        _kill_backend_locked()
    icon.stop()


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    try:
        import pystray
        from PIL import Image  # noqa: F401
    except ImportError:
        import ctypes
        ctypes.windll.user32.MessageBoxW(
            0,
            "Chybí závislosti pro tray ikonu.\n\n"
            "Spusť v terminálu:\n"
            r"  backend\.venv\Scripts\pip install pystray pillow",
            "Anisubarr — chybí pystray/pillow",
            0x10,
        )
        sys.exit(1)

    _start_backend()

    # Watchdog thread — auto-restarts backend if it crashes
    threading.Thread(target=_watchdog, args=(None,), daemon=True).start()

    icon_img = _make_icon()
    menu = pystray.Menu(
        pystray.MenuItem("Otevřít Anisubarr", _on_open, default=True),
        pystray.MenuItem("Restart backend",    _on_restart),
        pystray.MenuItem("Zobrazit log",       _on_log),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Ukončit",            _on_quit),
    )
    icon = pystray.Icon("Anisubarr", icon_img, "Anisubarr", menu)
    icon.run()


if __name__ == "__main__":
    main()
