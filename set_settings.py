"""
Jednorázový skript pro nastavení hodnot přímo do DB.
Spuštění: cd C:\Projekty\anisubarr\backend && .venv\Scripts\python ..\set_settings.py
"""
import os, sys

db_path = os.path.join(os.path.dirname(__file__), "backend", "anisubarr.db")
if not os.path.exists(db_path):
    print(f"DB nenalezena: {db_path}")
    sys.exit(1)

import sqlite3

settings = [
    ("qbittorrent_url",      "http://192.168.1.149:8080"),
    ("qbittorrent_username", "admin"),
    ("qbittorrent_password", "asd123dsa"),
]

conn = sqlite3.connect(db_path, timeout=15)
for key, value in settings:
    row = conn.execute("SELECT id FROM app_settings WHERE key=?", (key,)).fetchone()
    if row:
        conn.execute("UPDATE app_settings SET value=? WHERE key=?", (value, key))
        print(f"  updated: {key}")
    else:
        conn.execute("INSERT INTO app_settings (key, value) VALUES (?,?)", (key, value))
        print(f"  inserted: {key}")
conn.commit()
conn.close()
print("Hotovo. Obnov stránku v prohlížeči.")
