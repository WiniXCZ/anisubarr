# Prismarr vs Anisubarr — Analýza funkcí

> Dokument vytvořen: 2026-06-10  
> Prismarr repo: https://github.com/Shoshuo/Prismarr  
> Anisubarr: FastAPI (Python) + React/Vite, SQLite, Windows

---

## 1. Funkce které Prismarr MÁ a Anisubarr NEMÁ

Seřazeno podle priority implementace.

---

### 🔴 HIGH priority

---

#### 1.1 Unified Dashboard (domovská stránka)
**Priorita:** HIGH | **Složitost:** M

Prismarr má dedikovanou dashboard stránku místo pouhé knihovny:
- **Hero spotlight** — náhodný pick z knihovny s backdropem
- **7-day mini-calendar** — nadcházející epizody / filmy příštích 7 dní
- **Pending Seerr requests** — obohacené o TMDb metadata (poster, rok, žánr)
- **Live service health** — stav všech připojených služeb (Sonarr, qBit, Seerr, Emby…)
- **Latest additions** — naposledy přidané série / filmy

**Implementace v Anisubarr:**
- Nová stránka `/` (přesunout Library na `/library`)
- Backend endpoint `GET /api/dashboard` — agreguje data z existujících endpointů (seerr, calendar, service health)
- Frontend: nová stránka `Dashboard.jsx` s komponentami `HeroSpotlight`, `MiniCalendar`, `ServiceHealth`, `RecentAdditions`
- ServiceHealth: opakovaně volat stávající `/api/*/status` endpointy

---

#### 1.2 Radarr (filmy) integrace
**Priorita:** HIGH | **Složitost:** L

Anisubarr je striktně anime-only přes Sonarr. Prismarr integruje Radarr a zpřístupňuje filmovou knihovnu vedle seriálové.

**Implementace:**
- `backend/app/services/radarr.py` — mirror sonarr.py se Radarr API (v3/v4)
- `backend/app/routers/radarr.py` — endpointy: `/api/radarr/movies`, `/api/radarr/movie/{id}`, `/api/radarr/status`
- Model Movie v SQLite (cache filmů podobně jako Series)
- Frontend: rozšířit Library stránku o Movies tab nebo nová stránka `Movies.jsx`
- Settings: přidat `radarr_host`, `radarr_api_key` do nastavení

---

#### 1.3 Ctrl+K globální vyhledávání
**Priorita:** HIGH | **Složitost:** M

Unified search přes celou lokální knihovnu + TMDb / TheTVDB v reálném čase.

**Implementace:**
- Backend: `GET /api/search?q=...` — prohledá lokální `series` tabulku + zavolá TMDb API (filmy i seriály)
- Frontend: globální klávesová zkratka Ctrl+K, modal komponenta `GlobalSearch.jsx`
- Debounce 300ms, výsledky rozděleny na sekce: "V knihovně" / "Na TMDb"
- Klik na výsledek → navigace na `/series/:id` nebo quick-add modal
- TMDb API klíč (zdarma) uložit do Settings

---

#### 1.4 Quick-add modal s per-instance picker
**Priorita:** HIGH | **Složitost:** M

Z výsledku vyhledávání nebo Discovery stránky přidat titul do Sonarr/Radarr jedním kliknutím, s výběrem instance.

**Implementace:**
- Backend: `POST /api/sonarr/add` + `POST /api/radarr/add` — přidání přes Sonarr/Radarr API
- Frontend: `QuickAddModal.jsx` — zobrazí poster, popis, výběr instance (pokud více), výběr root folderu + quality profile
- Volat z GlobalSearch a Discovery stránky

---

#### 1.5 Multi-instance Sonarr/Radarr podpora
**Priorita:** HIGH | **Složitost:** L

Prismarr podporuje více instancí Radarr/Sonarr najednou (1080p + 4K + Anime), každá s vlastní stránkou a health badge.

**Implementace:**
- DB model `ServiceInstance(id, service_type, name, url, api_key, order, enabled)`
- Migrace: stávající `sonarr_host` / `sonarr_api_key` → první instance
- Backend: `SonarrService.get_for_instance(id)` — fanout dotazy na všechny instance
- Frontend: Settings sekce pro správu instancí (přidat / přejmenovat / seřadit / vypnout)
- Library stránka: přidat filtr per-instance

---

#### 1.6 Discovery stránka
**Priorita:** HIGH | **Složitost:** L

TMDb-based stránka pro objevování nového obsahu: hero, trending, personalizovaná doporučení, Explorer.

**Implementace:**
- Backend: `backend/app/services/tmdb.py` (TMDb API wrapper: trending, recommendations, discover)
- Endpointy: `/api/tmdb/trending`, `/api/tmdb/recommendations`, `/api/tmdb/discover?genre=&decade=&cast=`
- Frontend: nová stránka `Discovery.jsx` se sekcemi:
  - Hero banner (náhodný trending titul)
  - Trending (weekly/daily přepínač)
  - Recommendations (based on user's library)
  - Explorer (filtry: žánr, dekáda, herec)
  - Watchlist (uložené tituly)
  - Countdown (upcoming releases)
- Watchlist: jednoduchá SQLite tabulka `watchlist(user_id, tmdb_id, media_type, added_at)`

---

#### 1.7 qBittorrent — plný dashboard
**Priorita:** HIGH | **Složitost:** M

Anisubarr má pouze základní listing torrentů. Prismarr má plnohodnotný dashboard.

**Chybí v Anisubarr:**
- Server-side stránkování (Prismarr zvládá velké knihovny)
- Sorting (podle stavu, rychlosti, velikosti, data)
- Filtry (stav, kategorie, tracker)
- **Drag-and-drop .torrent upload** (multi-file)
- Pipeline badges — kliknutím na torrent přeskočit na odpovídající sérii/film
- qBit auto-refresh interval v nastavení preferencí

**Implementace:**
- Backend: rozšířit `qbittorrent.py` o:
  - `GET /api/qbittorrent/torrents?page=&sort=&filter=` (stránkování + filtry)
  - `POST /api/qbittorrent/upload` — přijmout `.torrent` soubor a odeslat do qBit
  - `DELETE /api/qbittorrent/torrent/{hash}` — smazání torrentu
  - `POST /api/qbittorrent/torrent/{hash}/pause|resume`
- Frontend: plná stránka `Downloads.jsx` s datovou tabulkou, upload zónou (react-dropzone nebo nativní HTML5 D&D)

---

### 🟡 MEDIUM priority

---

#### 2.1 Gluetun VPN integrace
**Priorita:** MEDIUM | **Složitost:** S

Zobrazení stavu VPN tunnelu (Gluetun): veřejná IP, země, port forwarding.

**Implementace:**
- Backend: `GET /api/gluetun/status` — volá Gluetun REST API (`/v1/publicip/ip`, `/v1/openvpn/portforwarded`)
- Settings: `gluetun_host` + `gluetun_api_key`
- Frontend: badge ve qBittorrent dashboardu nebo v service health na Dashboard stránce

---

#### 2.2 iCal export z kalendáře
**Priorita:** MEDIUM | **Složitost:** S

Export nadcházejících epizod/filmů jako `.ics` soubor (Google Calendar, Apple Calendar, Outlook).

**Implementace:**
- Backend: `GET /api/calendar/export.ics` — generuje iCalendar formát pomocí `icalendar` Python knihovny
- Endpoint vrátí `Content-Type: text/calendar`
- Frontend: tlačítko "Export iCal" v hlavičce Calendar stránky

---

#### 2.3 Calendar — month/week/day views
**Priorita:** MEDIUM | **Složitost:** M

Anisubarr má Calendar stránku, ale s omezenými pohledy. Prismarr má přepínač month/week/day.

**Implementace:**
- Frontend: přidat přepínač pohledů do `Calendar.jsx`
- Month view: mřížka 5×7 dní s "bublinami" epizod (existuje?)
- Week view: 7 sloupců s časovou osou
- Day view: detailní pohled na jeden den

---

#### 2.4 Personální watchlist
**Priorita:** MEDIUM | **Složitost:** S

Uložení titulů "ke zhlédnutí" bez nutnosti je přidat do Sonarr/Radarr.

**Implementace:**
- DB model: `watchlist(id, user_id, tmdb_id, media_type, title, poster_path, added_at)`
- Backend: CRUD endpointy `GET/POST/DELETE /api/watchlist`
- Frontend: tlačítko ♥ / záložka na kartách v Discovery + Library stránce, stránka nebo sekce v Dashboard

---

#### 2.5 Nastavení — export/import (bez credentials)
**Priorita:** MEDIUM | **Složitost:** S

Export konfigurace do JSON pro zálohu/přenos, s automatickým vynecháním API klíčů a hesel.

**Implementace:**
- Backend:
  - `GET /api/settings/export` — vrátí JSON ze `app_settings` tabulky, odfiltruje klíče obsahující `api_key`, `password`, `secret`, `token`
  - `POST /api/settings/import` — validuje a uloží importovaná nastavení
- Frontend: tlačítka "Export" / "Import" v Settings → O aplikaci

---

#### 2.6 Login rate-limiter
**Priorita:** MEDIUM | **Složitost:** S

Ochrana přihlašovacího formuláře před brute-force útoky.

**Implementace:**
- Backend: in-memory dict `{ip+username: (count, first_attempt_ts)}`
- Nebo použít Redis-free řešení s SQLite tabulkou `login_attempts(ip, username, attempts, window_start)`
- Po 5 neúspěšných pokusech za 15 minut vrátit HTTP 429 s `Retry-After` hlavičkou
- Middleware nebo decorator na `/api/auth/login` endpoint

---

#### 2.7 Prowlarr integrace
**Priorita:** MEDIUM | **Složitost:** M

Správa indexerů přes Prowlarr API — zobrazení stavu indexerů, test a sync.

**Implementace:**
- Backend: `backend/app/services/prowlarr.py`, `backend/app/routers/prowlarr.py`
- Endpointy: `/api/prowlarr/status`, `/api/prowlarr/indexers`
- Settings: `prowlarr_host`, `prowlarr_api_key`
- Frontend: sekce v Settings → Indexery (stávající sekce rozšířit o Prowlarr)

---

### 🟢 LOW priority

---

#### 3.1 Avatar upload na profil stránce
**Priorita:** LOW | **Složitost:** S

Uživatel si může nahrát profilový avatar (JPG/PNG/WebP/GIF, max 2 MB).

**Implementace:**
- Backend: `POST /api/users/me/avatar` — přijme multipart upload, uloží do `static/avatars/{user_id}.webp`, konvertuje pomocí Pillow
- Frontend: profilová sekce v Settings nebo nová stránka `/profile`

---

#### 3.2 Display preferences
**Priorita:** LOW | **Složitost:** S

Uživatelské preference uložené per-user (ne globálně).

**Chybí:**
- Výběr výchozí domovské stránky (Dashboard / Library / Calendar)
- Formát data/času (DD.MM.YYYY vs YYYY-MM-DD)
- Timezone per-user
- qBit auto-refresh interval
- UI density (compact / comfortable)

**Implementace:**
- DB model: `user_preferences(user_id, key, value)` nebo JSON blob v `user` tabulce
- Backend: `GET/PUT /api/users/me/preferences`
- Frontend: sekce v Settings → Profil

---

#### 3.3 Real-time notifikace (SSE/WebSocket)
**Priorita:** LOW | **Složitost:** M

Prismarr používá Mercure SSE pro cross-tab toasty (torrent dokončen → toast ve všech otevřených záložkách).

**Implementace:**
- Backend: FastAPI `StreamingResponse` nebo `asyncio.Queue` pro SSE endpoint `GET /api/events`
- Publish events při: dokončení downloadu (qBit webhook nebo polling), dokončení jobu
- Frontend: `useSSE()` hook navázaný na `EventSource`, napojit na Toast systém (existuje)
- Alternativa: existující Sonarr webhook → rozšířit o fan-out SSE event

---

#### 3.4 SSRF ochrana na user-provided URLs
**Priorita:** LOW | **Složitost:** S

Ochrana před SSRF útoky — filtrovat cloud-metadata IP adresy a zakázané protokoly.

**Implementace:**
- Utility funkce `validate_external_url(url)`:
  - Allowlist protokolů: `http`, `https`
  - Blocklist: `169.254.169.254` (AWS/GCP metadata), `100.100.100.200` (Alibaba), `fd00:ec2::254` (IPv6 metadata)
  - Odmítnout `localhost`, `127.x.x.x` v produkci (volitelné — homelab je LAN)
- Aplikovat ve všech místech kde uživatel zadává URL (Settings, quick-add)

---

#### 3.5 7-krokový setup wizard
**Priorita:** LOW | **Složitost:** M

Guided onboarding při prvním spuštění: vytvoření admina, připojení služeb, test.

**Implementace:**
- Backend: `GET /api/setup/status` — vrátí `{completed: bool}`
- DB flag `setup_completed` v `app_settings`
- Frontend: stránka `/setup` s multi-step formulářem (react-hook-form nebo vlastní stepper)
- Po dokončení redirect na Dashboard, nastavit `setup_completed = true`
- Pokud `setup_completed = false` a uživatel jde na jinou URL → redirect na `/setup`

---

## 2. Funkce které Anisubarr MÁ a Prismarr NEMÁ

Toto jsou **unikátní silné stránky** Anisubarr — důvod proč existuje jako samostatná aplikace.

| Funkce | Popis |
|--------|-------|
| **České titulky** | Stahování z Hiyori + HnS scraperů — Prismarr nemá žádnou subtitle integraci |
| **Subtitle editor** | In-browser editor SRT/ASS titulků s přepisy řádků |
| **AI překlad titulků** | Ollama integrace pro lokální AI překlad (qwen2.5, jiné modely) |
| **Subtitle sync (ALASS)** | Automatická synchronizace titulků pomocí ALASS nástroje |
| **NFO generátor** | Kodi/Emby kompatibilní `.nfo` metadata soubory |
| **Video nástroje (FFmpeg)** | Extrakce, záměna, odebrání titulkových stop z MKV |
| **In-browser video player** | Přímý stream a přehrávání epizod v prohlížeči |
| **AniList integrace** | Anime metadata (cover, synopsis, hodnocení, žánry) z AniList API |
| **Discord notifikace** | Webhook notifikace při stažení epizody / dostupnosti titulků |
| **Episode markers** | Vlastní sledování stavu epizod mimo Sonarr |
| **Sonarr webhooky** | Automatický sync při Sonarr On Download eventu |
| **Auto-unmonitor** | Automatické odmonitorování epizod po splnění podmínek |
| **Série promotion** | Přesouvání sérií mezi Sonarr root foldery (Incomplete → Complete) |
| **Glossář** | Animé terminologický slovník |
| **File browser** | Vestavěný správce souborů |
| **AI popis** | AI-generované popisy sérií (Ollama) |
| **SMB mount** | Připojení síťových složek pro přístup k mediím |
| **Job scheduler** | Plánované automatické úlohy s přehledem logů |

---

## 3. Funkce které mají OBĚ aplikace

| Funkce | Poznámka |
|--------|----------|
| Sonarr integrace | Anisubarr: jednoinstanční; Prismarr: multi-instance |
| qBittorrent integrace | Anisubarr: základní listing; Prismarr: plný dashboard |
| Seerr (Overseerr/Jellyseerr) | Oba: requests + issues |
| Kalendář epizod | Anisubarr: existuje; Prismarr: month/week/day + iCal |
| Uživatelé + RBAC | Admin / běžný uživatel |
| API klíče | Headless přístup |
| JWT autentizace | Login/logout |
| Settings stránka | Oba přes UI (Prismarr bez .env, Anisubarr kombinace .env + DB) |
| SQLite databáze | Zero-config |
| Toast notifikace | Oba mají systém toastů |
| Emby/Jellyfin integrace | Anisubarr: hlubší integrace; Prismarr: základní |

---

## 4. Souhrn priorit implementace

```
CELKEM CHYBĚJÍCÍCH FUNKCÍ: 19

HIGH   (6): Dashboard, Radarr, Ctrl+K search, Quick-add, Multi-instance, Discovery
MEDIUM (6): Gluetun, iCal export, Calendar views, Watchlist, Settings export/import, Login rate-limiter + Prowlarr
LOW    (5): Avatar upload, Display prefs, SSE real-time, SSRF ochrana, Setup wizard
```

### Doporučené pořadí implementace

1. **Ctrl+K search** (M) — největší UX win, využije existující data
2. **Unified Dashboard** (M) — přesune Library na `/library`, nová `/` stránka
3. **TMDb service + Discovery** (L) — potřebný pro Quick-add i Dashboard
4. **Quick-add modal** (M) — závisí na TMDb service
5. **iCal export** (S) — malá funkce, velká hodnota
6. **Login rate-limiter** (S) — bezpečnostní fix
7. **Settings export/import** (S) — jednoduchá utilita
8. **qBittorrent full dashboard** (M) — rozšíření existujícího
9. **Radarr integrace** (L) — velká funkce, pokud se chce rozšířit za anime
10. **Calendar month/week/day** (M) — UX vylepšení
11. **Watchlist** (S) — závisí na Discovery/TMDb
12. **Multi-instance** (L) — závisí na potřebě (nyní 1 Sonarr stačí?)
13. **Gluetun** (S) — pouze pokud uživatel používá Gluetun
14. **SSE real-time** (M) — nice-to-have
15. **Setup wizard** (M) — nice-to-have pro nové instalace
16. **Display preferences** (S) — nízká priorita
17. **Avatar upload** (S) — nízká priorita
18. **Prowlarr** (M) — pokud potřebná správa indexerů
19. **SSRF ochrana** (S) — security hardening

---

*Analýza provedena na základě Prismarr README (https://github.com/Shoshuo/Prismarr) a zdrojového kódu Anisubarr.*
