# Git push + Unraid nasazení — postup

Tenhle soubor smaž/přesuň, jakmile ho nebudeš potřebovat — je to jednorázový
návod, ne trvalá dokumentace projektu.

## 0) Co jsem nemohl udělat já a proč

V tomhle sandboxu (kde jsem prováděl i18n překlady) není `.git` složka vůbec
— potvrzeno (`git status` → `fatal: not a git repository`). Nejde tedy o to,
že bych něco nemohl smazat kvůli chybějícím právům — smazat soubor jde vždy,
jde jen o to, že žádnou git operaci (init/commit/push) odsud udělat nejde,
protože tu commitovat vůbec není do čeho. Proto to musíš spustit ty (nebo
Claude Code s reálným přístupem k repu) na svém stroji.

Jediné, co jsem si dovolil nechat "viset" schválně: `SubtitleEditorPage.jsx`
a `SubtitleEditorPanel.jsx` — staré, nahrazují se novým editorem (viz dřívější
rozhovor), ale zatím jsou potřeba jako záloha, dokud nový editor nebude
hotový. Nemaž je teď.

Skutečný, reálný problém, co jsem našel: **projekt neměl `.gitignore`** —
bez něj by první `git add -A` klidně nahrál `node_modules/` (51 MB smetí),
`.env` (tvoje API klíče, JWT secret, hesla k SMB/scraperům) a případnou
SQLite databázi rovnou na GitHub. Založil jsem `.gitignore` (viz níže) a
skript `scripts/pre-push-cleanup.sh`, co to ověří.

## 1) Spusť cleanup (Git Bash / WSL, jednou, před prvním commitem)

```bash
cd /c/Projekty/anisubarr-v2      # nebo cesta, kde repo skutečně je
bash scripts/pre-push-cleanup.sh
```

Smaže `frontend/node_modules`, `frontend/dist`, `__pycache__`, `.venv`,
zkontroluje, že se nikde neválí `.env` nebo DB soubor mimo `.gitignore`, a
volitelně přeinstaluje `npm install` čerstvě (ověří, že build furt funguje).

## 2) Založ / zkontroluj git repo

```bash
cd /c/Projekty/anisubarr-v2

# Je to už repo?
git status

# Pokud "fatal: not a git repository":
git init
git branch -M main
git remote add origin https://github.com/WiniXCZ/anisubarr.git

# Pokud repo už existuje, ale bez remote:
git remote -v                     # zkontroluj, jestli tam origin je
git remote add origin https://github.com/WiniXCZ/anisubarr.git   # jen pokud chybí
```

## 3) První (nebo další) commit a push

```bash
git add -A
git status                        # DŮLEŽITÉ: přečti si výpis, než commitneš.
                                   # Nemělo by tam být .env, node_modules, *.db.
git commit -m "i18n: cs/sk/en překlady, subtitle editor placeholder, ghcr deploy"
git push -u origin main
```

Pokud `git push` odmítne kvůli auth — GitHub už nebere heslo, potřebuješ buď
Personal Access Token (Settings → Developer settings → Personal access
tokens → generovat s `repo` scope, použít místo hesla), nebo `gh auth login`
přes GitHub CLI, nebo SSH klíč (`git remote set-url origin
git@github.com:WiniXCZ/anisubarr.git`).

## 4) Zkontroluj, že GitHub Actions build proběhl

Po pushnutí na `main` se spustí `.github/workflows/docker.yml` (build image
+ push na GHCR). Sleduj na `github.com/WiniXCZ/anisubarr/actions`. Trvá pár
minut (frontend build + Rust build alass + finální image).

## 5) DŮLEŽITÉ — nastav GHCR package na public

Nově vytvořený GHCR package je **defaultně private**, i když je repo public.
Unraid ho bez přihlášení nestáhne. Jdi na:

`github.com/WiniXCZ?tab=packages` → `anisubarr` → **Package settings**
(vpravo dole) → **Change visibility** → **Public**.

Alternativa, pokud ho chceš nechat private: v Unraid pod
**Docker → přidat registry** zadej GHCR URL + Personal Access Token s
`read:packages` scope. Jednodušší je ale dát ho public, je to open-source repo.

## 6) Unraid — přidání kontejneru

Nejjednodušší cesta je přes **Docker → Add Container** a ručně vyplnit podle
`docker-compose.yml`, protože Unraid Community Applications šablony jsou pro
cizí/community image navíc práce s XML — u vlastního image se to nevyplatí.

- **Repository**: `ghcr.io/winixcz/anisubarr:latest`
- **Network Type**: Bridge
- **Port**: `8000:8000` (admin UI), `8090:8090` (public site, volitelné)
- **Path**: `/app/backend/data` → `/mnt/user/appdata/anisubarr/data` (SQLite DB, ať přežije update/restart kontejneru)
- **Path**: `/media` → `/mnt/user` (nebo užší podsložka, kde máš anime)
- **Path**: `/cache` → `/mnt/user/data` (fallback mount, jen pokud to reálně používáš — viz komentář v docker-compose.yml)
- **Proměnné prostředí** — z `.env.example` v repu, hlavně:
  `DATABASE_URL=sqlite:///./data/anisubarr.db`, `SONARR_HOST`, `SONARR_API_KEY`,
  `OLLAMA_HOST`, `OLLAMA_MODEL_TRANSLATE`, `JWT_SECRET` (vygeneruj náhodný
  dlouhý string), `WEBHOOK_SECRET`, `FFMPEG_PATH=ffmpeg`, `FFPROBE_PATH=ffprobe`,
  `ALASS_PATH=alass`, `PATH_SONARR_PREFIX=/data`, `PATH_LOCAL_PREFIX=/media`.
- **Icon/WebUI URL**: `http://[IP]:[PORT:8000]`

Po vytvoření: Unraid teď kontejner vidí jako běžnou aplikaci s "check for
update" tlačítkem — protože image táhne z GHCR, ne z lokálního buildu.
Aktualizace pak = push na `main` → GitHub Actions přebuildí `latest` tag →
v Unraidu klikneš "Update" (nebo si to necháš na auto-update, pokud ho máš
zapnutý).

## 7) Ověření, že to celé funguje

```bash
curl -f http://<unraid-ip>:8000/api/health
```
Mělo by vrátit 200 / OK. Pokud ne, koukni do Unraid Docker logu kontejneru
— nejčastější první chyba bývá špatná cesta v `PATH_LOCAL_PREFIX` vs. skutečný
mount, nebo chybějící `JWT_SECRET`.
