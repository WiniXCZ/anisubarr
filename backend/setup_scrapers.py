"""
One-time setup script:
  1. Installs rarfile Python library for RAR extraction
  2. Saves Kamui-subs.cz credentials into the app database

Run from project root:
    .venv\Scripts\python setup_scrapers.py
"""
import subprocess
import sys
import os

HERE = os.path.dirname(os.path.abspath(__file__))

# ── 1. Install rarfile ────────────────────────────────────────────────────────
print("📦 Instaluji rarfile...")
try:
    result = subprocess.run(
        [sys.executable, "-m", "pip", "install", "rarfile"],
        capture_output=True, text=True,
    )
    if result.returncode == 0:
        print("   rarfile nainstalován OK")
    else:
        print(f"   pip selhal:\n{result.stderr[:300]}")
except Exception as e:
    print(f"   Chyba při instalaci rarfile: {e}")

# ── 2. Uložit credentials do DB ───────────────────────────────────────────────
DB_PATH = os.path.join(HERE, "anisubarr.db")

SETTINGS = {
    "kamui_username":     "WiniXcz",
    "kamui_password":     "1506Afinka",
    "kamui_rar_password": "kamui",
}

try:
    import sqlite3
    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()

    # Ensure the table exists (it should, but just in case)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS app_settings (
            key   TEXT PRIMARY KEY,
            value TEXT
        )
    """)

    for key, value in SETTINGS.items():
        cur.execute(
            "INSERT INTO app_settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, value),
        )
        print(f"   ✓ {key} uložen")

    con.commit()
    con.close()
    print("\n✅ Hotovo! Kamui přihlašovací údaje jsou uloženy v DB.")
    print("   Restartuj backend, aby se změny projevily.")

except Exception as e:
    print(f"\n❌ Chyba při zápisu do DB: {e}")
    print(f"   DB cesta: {DB_PATH}")
