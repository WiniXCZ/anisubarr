# Anisubarr — Audit Report
*Datum: 2026-06-08 | 5-průchodový audit celého projektu*
*Aktualizace: 2026-06-12 | Pass 2 — celý projekt znovu projet*

---

## Souhrn (Pass 1, 2026-06-08)

| Závažnost | Počet nálezů |
|-----------|-------------|
| 🔴 Kritická | 8 |
| 🟠 Vysoká | 9 |
| 🟡 Střední | 10 |
| 🟢 Nízká | 7 |

> **Nejdůležitější:** 6 souborů importovaných v `main.py` má syntaktické chyby způsobené zkráceným zápisem (truncated write) — **aplikace se vůbec nespustí**. Toto musí být opraveno jako první.

---

## Pass 2 — Stav nálezů z Pass 1 + nové nálezy (2026-06-12)

### Co se mezitím opravilo ✅

- **#1–8 (truncated soubory, app se nespustí)** — všechny opraveny, žádný soubor není uřezaný, app naběhne.
- **#9/#18** scheduler čte credentials z DB (`read_setting`), ne z `.env`.
- **#10** `ep.series` v scheduleru je ošetřen None-checkem.
- **#11** N+1 dotaz na SK cooldown nahrazen batch dotazem.
- **#21** `_fetch_bytes` volán s `db=`.
- **#25/#26** `_has_cs_sub`/`_CS_LANGS` sjednoceny do `utils/__init__.py` (`has_cs_sub`, `CS_LANGS`).
- **#29** PGS/VobSub `NotImplementedError` se v `routers/video.py` převádí na čistý HTTP 422.
- **#31** webhook secret se ověřuje a loguje korektně.
- **#19** `seerr_external_url` se používá v `dashboard.py`.
- **#27** `overseerr.py` je teď v hlavičce souboru zdokumentovaný jako vědomě zaparkovaný dead code (stále nezaregistrovaný, stále duplicitní se `seerr.py` — klidně smazat, ale už to není skrytá nástraha).

### 🔴 NOVÉ KRITICKÉ — uživatelsky viditelné, padají hned

1. **`frontend/src/pages/Discover.jsx`** a **`frontend/src/components/QuickAddModal.jsx`** — obě volají `const { showToast } = useToast()`, ale hook vrací `{ success, error, info }`. `showToast` je `undefined` → **každé** zobrazení toastu (error i success) na stránce Discover a v Quick Add modalu vyhodí `TypeError`.
   - V `QuickAddModal.jsx` je nejhorší dopad na řádku ~82: po **úspěšném** přidání anime do Sonarru toast vyhodí chybu *před* `onClose()` → modal zůstane otevřený a uživatel nemá zpětnou vazbu, že to proběhlo (i když na serveru ano).
   - **Fix:** `const toast = useToast()` a volání `toast.success(...)/toast.error(...)/toast.info(...)`. Jednořádková oprava na obou místech, ale dopad je velký — watchlist, AniList objevování a Quick Add jsou prakticky nepoužitelné bez konzole.

2. **`backend/app/routers/subtitle_sync.py:617`** — endpoint `POST /api/subtitle-sync/bulk-series` volá `_run_alass_bulk_task(ep_ids)`, ale tahle funkce **nikde v kódu neexistuje** (správná je `_sync_episodes_bg`). Každé zavolání tohoto endpointu skončí `NameError` → 500. Hromadné spuštění alass synchronizace pro vybrané série je tedy úplně rozbité.
   - **Fix:** přejmenovat na `_sync_episodes_bg`.

### 🟠 NOVÉ VYSOKÉ

3. **`backend/app/routers/requests.py` — PATCH `/api/requests/{req_id}`** (schvalování/zamítání požadavků) používá jen `get_current_user`, ne `require_admin`. Jakýkoliv přihlášený uživatel (i role "viewer") může schvalovat/zamítat požadavky ostatních. `delete_request` to dělá správně (`require_admin`).
   - **Fix:** změnit dependency na `require_admin` / `require_permission(...)`.

4. **`backend/app/routers/discover.py`** — `_enrich_tvdb_ids()` čte `tvdb_api_key`/`tvdb_pin`, ale tyto klíče nejsou ani v `config.py`, ani v `EDITABLE_KEYS` → nelze je nikde nastavit, TVDB enrichment je **permanentně mrtvý** (vždy `return items` bez obohacení).
   - **Fix:** doplnit do `config.py` a `EDITABLE_KEYS`.

5. **`backend/app/routers/subtitles.py`** — `_kamui()` (řádek ~107) na rozdíl od `_hiyori`/`_hns` **nemá fallback na `.env`** (`settings.kamui_username/password`). Kdo má Kamui nastavený jen přes `.env`/Docker env, dostane `None` → Kamui se v hledání/stahování tiše vynechá.
   - **Fix:** doplnit `or settings.kamui_username` / `or settings.kamui_password` (+ `kamui_rar_password`).

6. **`backend/app/routers/subtitles.py`** — `_download_best_for_episode` (řádek ~426, auto-download přes webhook) čte `scraper_provider_order` → fallback `subtitle_provider_priority`. `_download_all_task` (řádek ~554, hromadné stahování) čte **jen** `subtitle_provider_priority`. Pokud uživatel v UI nastaví jen `scraper_provider_order` (#30), hromadné stahování ho ignoruje → **jiné pořadí providerů pro jednotlivé vs. hromadné stahování**.
   - **Fix:** sjednotit na jeden helper a jeden klíč (`scraper_provider_order`).

7. **`frontend/src/pages/Schedule.jsx`** (278 řádků) — celá stránka je nezaregistrovaná (`App.jsx` na ni nemá route, nikde se neodkazuje) → mrtvý kód. I kdyby byla zapnutá, má spoustu tlačítek bez `onClick` (Obnovit indexery, pause/cancel downloadu, Otevřít/Titulky/⋯). Nezaměňovat s funkční záložkou "Scheduled Jobs" v Settings, ta je OK.
   - **Fix:** smazat, nebo dopsat a routovat.

8. **`frontend/src/pages/Library.jsx`** — `BulkActionBar` (řádky ~409-418): "Publikovat", "Stáhnout z publ.", "Titulky", "Smazat titulky" jsou jen `alert('...')`, žádné reálné API volání (přitom `publishSeries`/`downloadAllBulkSeries`/atd. v `api/client.js` existují). `ScheduleModal` (~345-374) sbírá datum/čas, ale "Potvrdit" jen zavře dialog (`onClick={onClose}`) — nic se neuloží/nenaplánuje.
   - **Fix:** napojit na existující API, u "Smazat titulky" doplnit potvrzovací dialog.

### 🟡 NOVÉ STŘEDNÍ

9. **`backend/app/services/anilist.py` / `routers/sync.py`** (#13 trvá) — `_full_sync()` volá AniList API pro každou novou sérii bez prodlevy → riziko HTTP 429 při bulk syncu.

10. **`backend/app/services/scheduler.py` `trigger_now`** (#22 trvá) — žádný zámek/dedup proti souběžnému běhu stejného jobu (manuální "Run now" + scheduler).

11. **`backend/app/services/scheduler.py` `job_seerr_sync`** (#24 trvá) — chyba na libovolné stránce paginace → `break`, zbylé stránky se ztratí beze stopy.

12. **`backend/app/services/promotion.py` `run_all_promotions`** (#12 částečně) — finální smyčka `db.query(Series).all()` bez `subqueryload(episodes).subqueryload(subtitles)`, na rozdíl od ostatních kroků → N+1 lazy loady u velkých knihoven.

13. **`backend/app/routers/filebrowser.py`** — `/api/files/browse?path=...` je dostupný pro jakéhokoliv přihlášeného uživatele a nevaliduje, že `path` je pod `media_root`/`path_local_prefix` → běžný uživatel může procházet libovolné adresáře na serveru.
    - **Fix:** validovat, že resolved path je potomek media root, nebo `require_admin`.

14. **`backend/app/services/subtitle_langcheck.py`** — `check_and_fix_subtitle` porovnává `detected("cs")` se `stored_lang` bez normalizace aliasů `cze`/`ces`/`cz` → titulek uložený jako `cze` se "opraví" na `cs` (přejmenování souboru + změna DB), i když byl v pořádku. Falešně pozitivní "fix", zbytečný šum v logu.

15. **`backend/app/routers/subtitle_editor.py`** (řádky ~135,164,193) — `get/shift/save_subtitle` nepoužívají `unc_to_local()` jako zbytek pipeline → na Windows může editor vidět/zapisovat jinou cestu než download/sync, "file not found" v editoru pro existující titulky.

16. **`backend/app/routers/subtitles.py`** — duplicate-check (`existing = db.query(Subtitle).filter(file_path==...)`) probíhá **až po** zápisu souboru → souběžné/duplicitní stahování přepíše soubor na disku dřív, než se zjistí, že záznam v DB už existuje (race při dvojkliku / bulk + auto-download najednou).

17. **`backend/app/pages/AdminUsers.jsx`** — jedna sdílená `updateMutation` pro změnu role/aktivace/hesla u všech uživatelů → `isPending` zablokuje selecty/toggly u **všech** řádků, i když se upravuje jen jeden uživatel.

18. **`frontend/src/pages/Calendar.jsx`** (~100-107) — přepínače "Měsíc/Týden/Agenda" — jen "Měsíc" je funkční, zbylá dvě tlačítka nedělají nic a vypadají aktivně.

19. **`frontend/src/pages/Library.jsx`** (~533-534) — tlačítka "↑ Import" a "+ Přidat anime" v headeru nemají `onClick`.

20. **`backend/app/services/subtitle_utils.py`** (~206-221) — `server_path_to_unc`/`subtitle_save_path` jsou mrtvý kód (nepoužívá je nic, `path_resolver.subtitle_path_for` dělá totéž).

### 🟢 NOVÉ NÍZKÉ / drobnosti (přetrvávající)

- **#17** `subtitle_preferred_provider` je stále mrtvý setting (v `EDITABLE_KEYS`, nikde se nečte).
- **#16** `gensubs_username`/`gensubs_password` stále chybí v `EDITABLE_KEYS` (nízký dopad, GenSubs je veřejný bez loginu).
- **#15** `_seerr_config` dělá 2 DB dotazy místo jednoho `.in_()`.
- **#20** výchozí hodnoty pro promo/demote jsou napsané jako `or "2"`/`or "flag_only"` na více místech místo centrálního configu.
- **#23** `wal_checkpoint` job mimo `JOB_REGISTRY` (neviditelný v UI).
- `backend/app/services/kamui.py` (~336-338) — `pass` v podmínce pro multi-season filtrování, neimplementováno (nezpůsobuje chybu, jen no-op).
- `backend/app/services/tmdb.py:73` — `print()` místo `logging`.
- `backend/app/routers/logs.py:31` — proměnná `l` v list comprehension (PEP8 nit).
- `hiyori.py`/`hns.py`/`kamui.py`/`gensubs.py` — `_get`/`_post` retry-on-429 logika duplikovaná 3-4×, mírně nekonzistentní počty pokusů.
- `subtitle_postprocess.py:145` — `need_write` boolean výraz je správně, ale bez závorek (čitelnost).
- `lang_detect.py` — `_MIN_HITS=5` může u velmi krátkých titulků dát 0.80 confidence z malého vzorku → okrajový risk falešné "SK detekce".

### Prioritní pořadí pro tuto vlnu

1. **Hned** — oprava `useToast()` destructuringu (Discover.jsx, QuickAddModal.jsx) — 1 řádek × 2 soubory, ale rozbíjí Discover/Watchlist/Quick Add.
2. **Hned** — `subtitle_sync.py:617` `_run_alass_bulk_task` → `_sync_episodes_bg`.
3. **Brzy** — auth na `PATCH /api/requests/{id}` (#3), `filebrowser.py` path validace (#13).
4. **Tento sprint** — provider-order konzistence (#6), `_kamui()` env fallback (#5), TVDB klíče (#4), Library bulk akce / ScheduleModal (#8), Schedule.jsx (smazat nebo dopsat).
5. **Backlog** — zbytek streamů 9–20 a přetrvávající nízké nálezy z Pass 1.

---

## Průchod 1 — Chyby a crash-prone kód

### 🔴 APP NESPUSTÍ — Syntax chyby v souborech importovaných při startu

**1. `backend/app/routers/settings.py` — line 558 (truncated)**
Soubor končí uprostřed f-stringu: `"reason": "Tim` — zbytek funkce `_qbt_status_with_body` chybí.
Soubor je importován v `main.py` → **ImportError při startu, celá aplikace crashuje.**
```python
# Posledních 5 řádků:
    except httpx.TimeoutException:
        return {"connected": False, "reason": "Tim   ← soubor se zde seká
```
**Řešení:** Doplnit chybějící konec:
```python
    except httpx.TimeoutException:
        return {"connected": False, "reason": "Timeout"}
    except Exception as exc:
        return {"connected": False, "reason": str(exc)}
```

---

**2. `backend/app/routers/seerr.py` — line 603 (truncated)**
Soubor končí uvnitř dict literálu: `"demote_result": de` — `return {}` nikdy nedosáhne `}`.
Importován v `main.py` → **ImportError při startu.**
```python
# Posledních 2 řádky:
        "demoted":      should_demote,
        "demote_result": de   ← seká se
```
**Řešení:** Doplnit:
```python
        "demoted":      should_demote,
        "demote_result": demote_result,
    }
```

---

**3. `backend/app/routers/subtitle_sync.py` — line 615 (truncated)**
Soubor končí uvnitř `raise HTTPException(400, "Žádné epizody se soubory ve vybraných sériích"` — závorka nikdy neuzavřena.
Importován v `main.py` → **ImportError při startu.**
```python
# Posledních 2 řádky:
    if not ep_ids:
        raise HTTPException(400, "Žádné epizody se soubory ve vybraných sériích"   ← seká se
```
**Řešení:** Doplnit `)`.

---

**4. `backend/app/routers/qbittorrent.py` — line 128 (truncated)**
Soubor končí uvnitř string literálu: `"added` — klíč slovníku nikdy neuzavřen.
Importován v `main.py` → **ImportError při startu.**
```python
# Posledních 2 řádky:
                "save_path": t.get("save_path", ""),
                "added   ← seká se
```
**Řešení:** Doplnit zbytek funkce (pravděpodobně `"added_on": t.get("added_on", 0),` a zavřít struktury).

---

**5. `backend/app/routers/video_stream.py` — line 175 (truncated)**
Soubor končí uvnitř string literálu: `"durati` — return dict nikdy neuzavřen.
Importován v `main.py` → **ImportError při startu.**
```python
# Posledních 2 řádky:
        "to_seconds": body.to_seconds,
        "durati   ← seká se
```
**Řešení:** Doplnit `"duration": body.to_seconds - body.from_seconds,` a zavřít `}`.

---

**6. `backend/app/models/series.py` — line 180 (truncated)**
`Subtitle` model obsahuje neuzavřené volání `Column(DateTime...)`. Soubor je importován přes `create_all()` při startu → **ImportError při startu, databáze se nevytvoří.**
```python
# Posledních 2 řádky:
    detected_lang   = Column(String, nullable=True)
    downloaded_at   = Column(DateTime(timezone=True),   ← nikdy neuzavřeno
```
**Řešení:** Doplnit:
```python
    downloaded_at   = Column(DateTime(timezone=True), nullable=True)
```
A ověřit, zda za tím nechybí celý `__repr__` nebo vztahy (`relationship`).

---

### 🔴 Runtime crash při spuštění background tasku

**7. `backend/app/services/auto_unmonitor.py` — line 37 (syntax error)**
Řádek obsahuje `replace("\", ",")` — v Pythonu je `"\", "` řetězec obsahující `", ` ale v kontextu funkčního volání Python tokenizer vyhodí `unterminated string literal`.
Soubor je importován lazily v `sync.py` (background task) → **aplikace nastartuje, ale `auto-unmonitor` tasky vždy selžou s ImportError.**
```python
# Problematický řádek:
for token in ep.subtitles_in_file.replace("\", ",").split(","):
# Správný kód (viz series.py, kde je to udělané správně):
for token in ep.subtitles_in_file.replace("/", ",").split(","):
```
**Řešení:** Nahradit `"\"` za `"/"` na řádku 37.

---

### 🔴 DB connection leak + ztracená chybová hláška

**8. `backend/app/routers/sync.py` — line 480-482 (truncated funkce)**
Funkce `_auto_unmonitor_task` je zkrácena:
```python
    except Exception as e:
        job_log.finish   ← toto je platný Python (přístup k atributu), ale volání nikdy neproběhne
```
- `job_log.finish_run(run, "error", ...)` se nikdy nezavolá → chyba se v UI nezdá
- `db.close()` v chybějícím `finally:` bloku se nikdy nezavolá → **únik DB connection při každé chybě v auto-unmonitor tasku**

**Řešení:** Doplnit:
```python
    except Exception as e:
        job_log.finish_run(run, "error", str(e)[:300])
        log.error("[auto_unmonitor] task failed: %s", e)
    finally:
        db.close()
```

---

### 🟠 Scheduler čte přihlašovací údaje z .env místo z DB

**9. `backend/app/services/scheduler.py` — lines 42-46 + 84-86**
`job_download_missing` inicializuje scrapery z `get_settings()` (`.env` / Docker env vars):
```python
settings = get_settings()
if settings.hiyori_username and settings.hiyori_password:
    sources.append("hiyori")
# ...
scraper = HiyoriScraper(settings.hiyori_username, settings.hiyori_password)
```
Pokud uživatel aktualizuje hesla přes Settings UI (kde se ukládají do DB), scheduler job tato nová hesla nevidí — stále používá stará env values. Ostatní endpointy (subtitles.py) správně volají `_read_setting("hiyori_username", db)`.

**Řešení:**
```python
def job_download_missing():
    from ..database import SessionLocal
    from ..utils.settings_helper import read_setting
    db = SessionLocal()
    try:
        sources = []
        if read_setting("hiyori_username", db) and read_setting("hiyori_password", db):
            sources.append("hiyori")
        if read_setting("hns_username", db) and read_setting("hns_password", db):
            sources.append("hns")
        # ... pass db to _fetch_bytes
```

---

### 🟠 ep.series přístup bez None-checku v scheduleru

**10. `backend/app/services/scheduler.py` — line 89, 123**
```python
title=ep.series.title,   # line 89 — ep.series může být None (lazy load při jiném session)
```
`ep.series` je lazy-loaded relationship. Pokud je episode orphaned (series smazána) nebo session nevýhodná, `ep.series` vrátí `None` a `.title` vyhodí `AttributeError`. Celá epizoda se přeskočí ale s misleadingovou chybou.

**Řešení:**
```python
title=ep.series.title if ep.series else "",
```

---

## Průchod 2 — Performance a pomalé úseky

### 🟠 N+1 query: should_skip_due_to_sk_cooldown v scheduleru

**11. `backend/app/services/scheduler.py` — lines 69-73**
```python
missing = [
    ep for ep in candidates
    if ep.id not in subbed_ep_ids
    and not should_skip_due_to_sk_cooldown(db, ep.id)  # ← 1 DB query PER epizoda!
]
```
`should_skip_due_to_sk_cooldown` dělá `db.query(Subtitle).filter(...).first()` pro každou epizodu. S 200+ kandidáty = 200+ SQL dotazů.

**Řešení:** Pre-load všechna SK ID najednou:
```python
from datetime import datetime, timezone, timedelta
from ..models.series import Subtitle as _Sub
cutoff = datetime.now(timezone.utc) - timedelta(hours=LANGCHECK_COOLDOWN_HOURS)
sk_cooldown_ids = {
    sub.episode_id
    for sub in db.query(_Sub).filter(
        _Sub.detected_lang == "sk",
        _Sub.downloaded_at >= cutoff,
    ).all()
}
missing = [
    ep for ep in candidates
    if ep.id not in subbed_ep_ids
    and ep.id not in sk_cooldown_ids
]
```

---

### 🟠 N+1 query: run_all_promotions bez eager loadingu

**12. `backend/app/services/promotion.py` — line 640**
```python
for s in db.query(Series).all():   # načte všechny series, ale bez episodes/subtitles
    # ...
    _has_cs_sub(ep)  # ← pro každou epizodu → lazy load subtitles → N×M queries
```
S 50 sériemi × 12 epizod = 600+ lazy SQL dotazů.

**Řešení:**
```python
from sqlalchemy.orm import subqueryload
for s in (
    db.query(Series)
    .options(subqueryload(Series.episodes).subqueryload(Episode.subtitles))
    .all()
):
```

---

### 🟠 AniList HTTP volání bez rate limit delay v _full_sync

**13. `backend/app/routers/sync.py` — funkce `_sync_series_raw`**
Pro každou novou sérii volá `anilist_svc.search_anime(row.title)` — synchronní HTTP request k AniList API. Pro 100 nových sérií = 100 HTTP volání bez žádného zpoždění. AniList má rate limit ~90 req/min — bulk sync selže s HTTP 429.

**Řešení:** Přidat `import time; time.sleep(0.7)` mezi AniList volání, nebo batching.

---

### 🟡 Dva duplicitní settings klíče pro provider pořadí

**14. `backend/app/services/subtitles.py` — funkce `_download_best_for_episode`**
```python
order_raw = _rs("scraper_provider_order", db) or _rs("subtitle_provider_priority", db) or "hiyori,hns,kamui,gensubs"
```
Dva různé klíče dělají totéž. Pokud uživatel nastaví jeden, druhý se ignoruje. Matoucí.

---

### 🟡 promotion.py: dva separátní DB dotazy pro Seerr konfiguraci

**15. `backend/app/services/promotion.py` — lines 559-560**
```python
host_row = db.query(AppSetting).filter(AppSetting.key == "seerr_host").first()
key_row  = db.query(AppSetting).filter(AppSetting.key == "seerr_api_key").first()
```
Dva dotazy místo jednoho. Volá se při každé sérii v promotion loop.

**Řešení:**
```python
rows = {
    row.key: row.value
    for row in db.query(AppSetting).filter(
        AppSetting.key.in_(["seerr_host", "seerr_api_key"])
    ).all()
}
```

---

## Průchod 3 — Nastavení (Settings)

### 🟠 gensubs_username/gensubs_password nelze nastavit přes UI

**16. `backend/app/routers/settings.py` — EDITABLE_KEYS**
`subtitles.py` volá:
```python
u = _read_setting("gensubs_username", db)
p = _read_setting("gensubs_password", db)
```
Ale ani `gensubs_username` ani `gensubs_password` nejsou v `EDITABLE_KEYS` — nelze je nastavit přes `PUT /api/settings`. Frontend je sice zobrazuje jako "dostupný bez účtu", ale pokud by GenSubs.cz vyžadovalo přihlášení, není způsob jak credentials zadat.

**Řešení:** Přidat do `EDITABLE_KEYS`:
```python
"gensubs_username", "gensubs_password",
```

---

### 🟡 subtitle_preferred_provider je dead setting

**17. `backend/app/routers/settings.py` — EDITABLE_KEYS**
Klíč `subtitle_preferred_provider` je v `EDITABLE_KEYS` a zobrazený v UI, ale žádný kód ho nečte. `_download_best_for_episode` čte `scraper_provider_order` / `subtitle_provider_priority`, nikoliv `subtitle_preferred_provider`.

---

### 🟡 Scheduler ignoruje DB credentials pro Hiyori/HnS

**18. Viz nález #9 výše — opakující se téma**
Všechny ostatní funkce správně volají `_read_setting("hiyori_username", db)`. Pouze `job_download_missing` v scheduleru čte z `.env` přes `get_settings()`. Výsledek: uživatel nastaví credentials v UI, ale scheduler job je nepoužije.

---

### 🟢 seerr_external_url nemá viditelné využití v backendu

**19. `backend/app/config.py` — seerr_external_url**
Klíč je v EDITABLE_KEYS, ale v backendu se nečte (pouze `emby_external_url` se čte v `discord.py`). Frontend pravděpodobně tvoří linkování, ale backend jej nevyužívá ke generování URL v notifikacích.

---

### 🟢 Default hodnoty pro demote/promo settings nejsou v kódu, ale v komentářích

**20. `backend/app/routers/settings.py`**
Komentáře uvádějí default hodnoty (`# default 80`, `# default flag_only`), ale kód je explicitně neaplikuje — pokud není hodnota v DB, `_get_setting()` vrátí `None`. Volající kód pak musí každé místo ošetřit `or "default_value"`. Lépe by bylo mít centrální defaults dictionary.

---

## Průchod 4 — Background procesy a scheduler

### Přehled všech scheduled jobů

| job_id | Interval | Co dělá | Viditelný v UI |
|--------|----------|---------|----------------|
| `sonarr_sync` | daily 04:00 | Pull sérií a epizod ze Sonarr | ✅ |
| `download_missing` | daily 05:00 | Auto-download CZ titulků | ✅ |
| `anilist_refresh` | weekly Po 03:00 | Doplnění AniList metadat | ✅ |
| `ollama_translate` | daily 06:00 | Překlad popisů přes Ollama | ✅ |
| `nfo_refresh` | weekly Út 07:00 | Obnova NFO souborů | ✅ |
| `subtitle_langcheck` | daily 05:30 | Kontrola jazyka CZ titulků | ✅ |
| `promotion_check` | daily 08:00 | Povýšení/degradace sérií | ✅ |
| `seerr_sync` | každých 10 min | Sync Seerr requestů do cache | ✅ |
| `wal_checkpoint` | každou hodinu | SQLite WAL checkpoint | ❌ (interní) |

---

### 🟠 download_missing: _fetch_bytes volán bez db parametru

**21. `backend/app/services/scheduler.py` — line 106**
```python
raw_bytes = _fetch_bytes(best["source"], best["url"])  # ← chybí db=db
```
`_fetch_bytes` bez `db` arg inicializuje scrapery přes `get_settings()` (env), nikoliv DB. Pokud credentials jsou pouze v DB (nastaveny přes UI), stahování selže.

**Řešení:**
```python
raw_bytes = _fetch_bytes(best["source"], best["url"], db=db)
```

---

### 🟡 Žádná deduplication — job může běžet paralelně

**22. `backend/app/services/scheduler.py` — funkce `trigger_now`**
```python
def trigger_now(job_id: str):
    entry = JOB_REGISTRY.get(job_id)
    _wrap(job_id, entry["fn"])()  # ← spustí okamžitě, bez kontroly jestli již běží
```
Pokud uživatel manuálně spustí `download_missing` zatímco scheduler právě běží, oba joby běží paralelně. Stahují titulky pro stejné epizody, zapisují do stejné DB.

**Řešení:** Přidat `threading.Lock()` nebo kontrolu přes `_scheduler.get_job(job_id)` state.

---

### 🟡 wal_checkpoint job není v JOB_REGISTRY ani v DB

**23. `backend/app/services/scheduler.py` — lines 519-528**
`wal_checkpoint` se přidává přímo v `start()`, mimo JOB_REGISTRY a `_ensure_default_jobs()`. Nelze ho tedy:
- zobrazit v UI
- zakázat/upravit přes Settings
- logovat přes `_wrap()` (zapisuje jen do debug logu)

Toto je asi záměrné, ale stojí za zmínku.

---

### 🟡 seerr_sync: při chybě HTTP odpověď přeruší celou sync smyčku

**24. `backend/app/services/scheduler.py` — lines 240-248**
```python
try:
    r = httpx.get(...)
    r.raise_for_status()
    data = r.json()
except Exception as e:
    log.error(f"[scheduler] seerr_sync → fetch failed: {e}")
    break  # ← přeruší pagination loop, ztratí zbývající stránky
```
`break` při chybě znamená, že se synchronizují jen stránky načtené před chybou — zbytek se ztratí. Lepší by byl `continue` nebo retry.

---

## Průchod 5 — Nesrovnalosti a architektura

### 🟠 _has_cs_sub definována 3× s různou logikou

**25. Soubory: `series.py:175`, `auto_unmonitor.py:26`, `promotion.py:33`**

| Implementace | Kontroluje DB | Embedded tracks | Disk soubory |
|---|---|---|---|
| `series.py` | ✅ | ✅ | ✅ (s dir_cache) |
| `auto_unmonitor.py` | ✅ | ✅ | ✅ |
| `promotion.py` | ✅ | ❌ | ❌ |

**`promotion.py` verzí chybí embedded track a disk kontrola.** To znamená, že sériím s pouze embedded CZ titulky nebo s titulky jen na disku (ne v DB) promotion check nesprávně vyhodnotí, že nemají CZ titulky → špatné povýšení/degradace.

**Řešení:** Extrahovat sdílenou funkci do `subtitle_utils.py` nebo `series.py` a importovat ji.

---

### 🟠 _CS_LANGS definována 4× (copy-paste)

**26. Soubory: `series.py:157`, `subtitles.py:1195`, `subtitle_sync.py:101`, `auto_unmonitor.py:22`**
```python
_CS_LANGS = {"cs", "cze", "cz", "ces"}  # ve 4 různých souborech
```
Pokud se přidá nový alias, musí se aktualizovat na 4 místech.

**Řešení:** Přesunout do `backend/app/services/subtitle_utils.py` a importovat.

---

### 🟠 overseerr.py — dead code (neregistrovaný router)

**27. `backend/app/routers/overseerr.py`**
Soubor existuje s kompletní implementací (`/api/overseerr/*` endpointy), ale **není importován v `main.py`** ani nikde jinde. Všechna funcionalita je zduplikována v `seerr.py`.
- 400+ řádků mrtvého kódu
- Konfuzní pro budoucí vývojáře
- Zvyšuje riziko údržby (změny v `seerr.py` se nezrcadlí)

**Řešení:** Smazat soubor, nebo přidat do dokumentace proč existuje.

---

### 🟡 sync.py: _auto_unmonitor_task — truncated except block (viz #8)

**28. `backend/app/routers/sync.py` — lines 480-482**
Except blok je incomplete, `db.close()` nikdy nezavolá při výjimce.
(Viz detaily v nálezu #8.)

---

### 🟡 video.py: raise NotImplementedError pro PGS titulky

**29. `backend/app/services/video.py` — lines 152-156**
```python
if codec in ("hdmv_pgs_subtitle", "pgssub", "dvd_subtitle") and convert_to_srt:
    raise NotImplementedError(
        f"Track {stream_index} uses image-based codec '{codec}'. ..."
    )
```
Pokud uživatel klikne "extrahovat titulek" na epizodě s PGS/VobSub embedded titulky, volání vyhodí `NotImplementedError`. FastAPI to zachytí jako HTTP 500 bez smysluplného error message v UI.

**Řešení:** Vrátit `HTTPException(400, "...")` místo `NotImplementedError`.

---

### 🟡 Dvě různé funkce pro scraper order (duplicitní nastavení)

**30. `settings.py` EDITABLE_KEYS**
Existují klíče `scraper_provider_order` a `subtitle_provider_priority` — oba dělají totéž. `_download_best_for_episode` čte oba s OR fallback. V UI je zobrazený pouze jeden. Matoucí.

**Řešení:** Standardizovat na jeden klíč (`scraper_provider_order`), druhý deprecovat.

---

### 🟢 Webhook endpoint bez autentizace (by design, ale riziko)

**31. `backend/app/routers/webhooks.py` — POST /api/webhooks/sonarr**
```python
if cfg.webhook_secret:
    # ověř token
```
Pokud `webhook_secret` není nastaven, webhook je zcela otevřený — kdokoliv může triggerovat Sonarr sync (DoS riziko). Mělo by být alespoň logováno.

---

### 🟢 Scheduler imports: circular dependency risk

**32. `backend/app/services/scheduler.py`**
Scheduler importuje z routerů lazily (uvnitř funkcí):
```python
from ..routers.sync import _full_sync
from ..routers.subtitles import _fetch_bytes, _save_subtitle
from ..routers.seerr import _get_seerr_cfg
```
Lazy importy předcházejí circular import problémům při startu, ale pokud se architektura změní, je snadné do circular dependency spadnout. Lepší by bylo přesunout sdílenou logiku do `services/` a router imports eliminovat.

---

### 🟢 PlayerPage a video_stream: UNC cesta hardcoded

**33. `backend/app/routers/video_stream.py` — (truncated, ale pravděpodobně)**
`path_resolver.py` mapuje UNC cesty na lokální cesty — pokud Docker mount se změní, přestane fungovat přehrávání. Konfigurace mappingu je v `.env`, nikoliv v UI Settings.

---

## Závěr — Prioritní pořadí oprav

1. **Okamžitě:** Opravit 6 truncated souborů s ImportError — app v současném stavu nespustí (nálezy #1-6)
2. **Dnes:** Opravit `auto_unmonitor.py:37` (`"\"`→`"/"`) a dopsat `sync.py` except blok (nálezy #7, #8)
3. **Tenhle sprint:** Scheduler čte credentials z env místo DB (#9, #21); N+1 queries (#11, #12)
4. **Příští sprint:** Unifikovat `_has_cs_sub` (#25), `_CS_LANGS` (#26), smazat `overseerr.py` (#27)
5. **Backlog:** Dead settings (#17), webhook bez auth (#31), scheduler deduplication (#22)
