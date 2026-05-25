# Instalace Anisubarr na Unraid

## Prerekvizity
- Unraid s Docker povoleným
- Git nainstalovaný (`nerd-tools` plugin nebo manuálně)
- Přístup k terminálu (Settings → Terminal nebo SSH)

## Instalace

```bash
# 1. Naklonuj repo
cd /mnt/user/appdata
git clone https://github.com/TVUJ-USERNAME/anisubarr.git
cd anisubarr

# 2. Vytvoř .env
cp .env.example .env
nano .env
```

### Klíčové proměnné v .env pro Unraid:
```
PATH_SONARR_PREFIX=/data
PATH_LOCAL_PREFIX=/media
UNRAID_MEDIA_PATH=/mnt/user
JWT_SECRET=<vygeneruj nahodny string>
SONARR_HOST=192.168.1.149:8989
SONARR_API_KEY=<tvuj klic>
```

```bash
# 3. Spusť
docker compose up -d

# 4. Ověř
docker compose ps
```

## Přístup
- Frontend: `http://UNRAID-IP:3000`
- Backend API: `http://UNRAID-IP:8000`

## Aktualizace
```bash
cd /mnt/user/appdata/anisubarr
bash deploy.sh
```
