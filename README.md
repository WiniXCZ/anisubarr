# Anisubarr

Webová aplikace pro správu českých anime titulků. Propojuje Sonarr, Emby/Jellyfin a Overseerr/Jellyseerr a umožňuje automatické stahování, editaci a synchronizaci titulků k anime sériím.

---

## Funkce

- **Knihovna** — přehled všech anime sérií synchronizovaných ze Sonarru, obohacený o metadata z AniListu (cover, synopsis, žánry, hodnocení)
- **Titulky** — vyhledávání a stahování českých titulků ze zdrojů Hiyori a HnS; ruční nahrávání a editor titulků přímo v prohlížeči
- **Synchronizace** — ruční i automatický sync se Sonarrem (webhook při stažení epizody)
- **Harmonogram** — přehled naplánovaných epizod příštích dní
- **Kalendář** — kalendářní pohled na datum vydání epizod
- **NFO soubory** — generování Kodi/Emby kompatibilních `.nfo` metadat
- **Video nástroje** — extrakce, záměna a odstraňování titulkových stop z MKV souborů (FFmpeg)
- **Propojení** — testování připojení k Sonarru, Overseerru, Emby a SMB ze záložky Nastavení
- **API klíče** — generování a správa API klíčů pro headless přístup
- **Správa uživatelů** — více uživatelů s RBAC (admin / běžný uživatel)

---

## Požadavky

| Komponenta | Verze |
|------------|-------|
| Python | 3.11+ |
| Node.js | 18+ |
| Sonarr | v3 nebo v4 |
| FFmpeg | libovolná aktuální (pro video operace) |

Volitelné (ale doporučené):
- **Emby / Jellyfin** — pro externí přehrávání
- **Overseerr / Jellyseerr** — přehled požadavků a problémů s titulky
- **Ollama** — lokální AI překlad titulků (model `qwen2.5:14b` nebo jiný)

---

## Instalace

### 1. Klonování repozitáře

```bash
git clone https://github.com/your-user/anisubarr.git
cd anisubarr
```

### 2. Backend

```bash
cd backend

# Vytvoř virtuální prostředí
python -m venv .venv

# Aktivace (Windows)
.venv\Scripts\activate
# Aktivace (Linux/macOS)
source .venv/bin/activate

# Instalace závislostí
pip install -r requirements.txt

# Vytvoř konfiguraci
cp .env.example .env
# Otevři .env a vyplň hodnoty (viz sekce Konfigurace)
```

### 3. Frontend

```bash
cd frontend
npm install
```

---

## Konfigurace

Edituj `backend/.env`. Povinné proměnné:

| Proměnná | Popis |
|----------|-------|
| `JWT_SECRET` | Náhodný tajný klíč pro JWT tokeny (vygeneruj: `openssl rand -hex 32`) |
| `SONARR_HOST` | URL Sonarru, např. `http://192.168.1.x:8989` |
| `SONARR_API_KEY` | Sonarr API klíč (Settings → General → API Key) |
| `PATH_SONARR_PREFIX` | Prefix cesty jak ho vidí Sonarr, např. `/data` |
| `PATH_LOCAL_PREFIX` | Prefix cesty jak ho vidí Anisubarr, např. `\\\\server\\data` |

Volitelné (pro plnou funkčnost):

| Proměnná | Popis |
|----------|-------|
| `SMB_HOST`, `SMB_USERNAME`, `SMB_PASSWORD` | Síťové sdílení (Windows) |
| `HIYORI_USERNAME` / `HIYORI_PASSWORD` | Hiyori účet pro titulky |
| `HNS_USERNAME` / `HNS_PASSWORD` | HnS účet pro titulky |
| `OVERSEERR_HOST` / `OVERSEERR_API_KEY` | Overseerr/Jellyseerr |
| `EMBY_HOST` / `EMBY_API_KEY` / `EMBY_EXTERNAL_URL` | Emby/Jellyfin |
| `OLLAMA_HOST` | Ollama pro AI překlad |
| `WEBHOOK_SECRET` | Secret token pro Sonarr webhooky |
| `FFMPEG_PATH` / `FFPROBE_PATH` | Cesta k FFmpeg binárním souborům |

---

## Spuštění

### Development

```bash
# Backend (z adresáře backend/)
uvicorn app.main:app --reload --port 8000

# Frontend (z adresáře frontend/) — v novém terminálu
npm run dev
```

Frontend běží na `http://localhost:5173`, backend na `http://localhost:8000`.  
API dokumentace je dostupná na `http://localhost:8000/api/docs`.

### Production (Docker)

```bash
docker-compose up -d
```

---

## Sonarr Webhook (automatický sync)

Po stažení epizody Sonarr automaticky spustí sync v Anisubarru.

Nastavení v Sonarru: **Settings → Connect → + → Webhook**

- **URL:** `http://<anisubarr-host>:8000/api/webhooks/sonarr?token=<WEBHOOK_SECRET>`
- **Events:** `On Download`, `On Episode File Delete`

---

## API klíče

Pro headless přístup (skripty, home automation) vytvoř API klíč v **Nastavení → API klíče**.

Použití v HTTP požadavcích:
```
X-Api-Key: ansk_<tvůj-klíč>
```

---

## Přispívání

Pull requesty jsou vítány. Pro větší změny otevři nejdříve issue.

---

## Licence

MIT
