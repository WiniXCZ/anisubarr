#!/usr/bin/env bash
# remove-old-cruft.sh — deletes leftover v1/dev junk from the anisubarr repo
# root. Run this from Git Bash or WSL, from anywhere (it cd's to the repo
# root itself). Everything here is already covered by .gitignore, so this
# is purely about disk hygiene, not git history.
#
# Does NOT touch: .env, backend/anisubarr.db (your real live database),
# .git/, backend/, frontend/, public_site/, docker-compose.yml, Dockerfile,
# README.md, GIT_AND_UNRAID_SETUP.md, scripts/.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "About to permanently delete the following from: $(pwd)"
echo

FILES=(
  AUDIT_REPORT.md INSTALL.md PRISMARR_FEATURES.md TODO.md
  _build_frontend.vbs _fresh_start.vbs _restart_now.bat _write_test_tmp.txt
  backend.log check2.bat check2_result.txt check_health.bat cleanup.bat
  dashboard_hlavni.yaml dashboard_hudba.yaml deploy.sh
  dev-commit-push.bat dev-restart.bat dev-restart.vbs
  health_result.txt install_alass.bat install_and_start_tray.vbs
  install_tray_deps.bat rebuild.vbs remap_smb.bat restart.bat
  restart_all.bat restart_backend.bat restart_backend.vbs restart_silent.vbs
  s.ps1 set_settings.py start-prod.bat start.bat start_servers.ps1
  start_tray.vbs strip_nulls.py test_write.bat tray.pyw
  backend/app/main.py.bak backend/app/routers/logs.py.bak
)
DIRS=( .claude docs tools v1 backend/.venv backend/app/__pycache__ )

for f in "${FILES[@]}"; do [ -e "$f" ] && echo "  file: $f"; done
for d in "${DIRS[@]}"; do [ -e "$d" ] && echo "  dir:  $d"; done

echo
read -p "Type YES to delete all of the above: " confirm
if [ "$confirm" != "YES" ]; then
  echo "Aborted, nothing deleted."
  exit 1
fi

for f in "${FILES[@]}"; do [ -e "$f" ] && rm -v "$f"; done
for d in "${DIRS[@]}"; do [ -e "$d" ] && rm -rv "$d"; done

echo
echo "Done. 'git status' should now be clean of anything that isn't real project code."
