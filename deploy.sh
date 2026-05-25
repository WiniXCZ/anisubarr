#!/bin/bash
# Anisubarr – deploy skript pro Unraid
set -e

echo "=== Anisubarr Deploy ==="
echo "Stahuji aktualizace z GitHubu..."
git pull origin main

echo "Rebuilduji a spouštím kontejnery..."
docker compose down
docker compose up -d --build

echo ""
echo "=== Hotovo ==="
docker compose ps
