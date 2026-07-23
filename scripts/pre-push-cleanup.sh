#!/usr/bin/env bash
# pre-push-cleanup.sh — run this once, locally (Git Bash / WSL), before the
# very first `git add` / `git init`. It removes local junk that must never
# be committed (build output, caches, real DB, secrets) and double-checks
# nothing sensitive is about to get staged.
#
# Safe to re-run any time. Doesn't touch anything outside this repo.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== Removing local build artifacts / caches =="
rm -rf frontend/node_modules
rm -rf frontend/dist
find . -type d -name "__pycache__" -prune -exec rm -rf {} +
find . -type d -name ".venv" -prune -exec rm -rf {} +

echo "== Checking for files that must NOT be committed =="
FOUND=0
for pattern in ".env" "backend/data" "backend/*.db" "*.db-shm" "*.db-wal"; do
  matches=$(find . -path "./.git" -prune -o -path "$pattern" -print 2>/dev/null || true)
  if [ -n "$matches" ]; then
    echo "  ! Found (excluded by .gitignore, but verify): $matches"
    FOUND=1
  fi
done
if [ "$FOUND" -eq 0 ]; then
  echo "  OK — nothing sensitive found."
fi

echo "== Reinstalling frontend deps fresh (optional, confirms build still works) =="
if command -v npm >/dev/null 2>&1; then
  (cd frontend && npm install)
else
  echo "  npm not found on PATH — skip, or run 'cd frontend && npm install' yourself."
fi

echo
echo "Done. Next: git init (if needed), git add -A, git status — review the"
echo "file list BEFORE the first commit, then git commit / git push."
