# Anisubarr – TODO / Backlog

## Zdroje titulků

- [ ] **ange.3mka.cz** — potenciální zdroj CZ titulků
  - Web je přístupný z ČR, nepotřebuje login
  - Hiyori.cz linkuje na ange.3mka.cz jako "direct" download URL
  - Server má zahraniční IP → blokováno (403); momentálně se tyto "direct" linky přeskakují
  - Řešení: napsat vlastní scraper pro ange.3mka.cz (podobně jako hiyori.py / hns.py)
    nebo přidat proxy / VPN pro stahování titulků z geo-blokovaných CZ zdrojů

## Výkon / stabilita

- [ ] **seerr_sync stuck job** — job se zaseknul v APScheduleru (timeout při HTTP requestu?),
  APScheduler pak přeskakoval všechny další běhy ("maximum instances reached").
  Fix: přidat `timeout` na httpx.get, nebo pustit v daemon threadu s kill timeoutem.

- [ ] **download_missing spam** — při stahování titulků pro tisíce epizod
  job projíždí vše v jednom běhu a může trvat hodiny.
  Zvážit: limit na počet epizod na jeden běh (např. max 50 za den).

## UI / Frontend

- [ ] **"u ostatních připojení jsou defaultní hodnoty"** — Sonarr, Emby apod. ukazují
  v nastavení prázdné/výchozí hodnoty místo uložených. Prošetřit načítání settings.

- [ ] **Knihovna se nenačte po restartu backendu** — browser drží stale JWT nebo
  stale index.html z cache. Přidat Cache-Control header na index.html response.

## Nasazení

- [ ] **Unraid deployment** — přesunout z Windows dev prostředí na Unraid Docker container
