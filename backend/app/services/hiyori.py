"""
Hiyori.cz scraper – Czech anime subtitles.
Ported from subtitle_bazarr_alfa/scraper/hiyori.py
"""
from __future__ import annotations

import logging
import re
import threading
import time
import httpx
from bs4 import BeautifulSoup

log = logging.getLogger("anisubarr.hiyori")

BASE_URL  = "https://hiyori.cz"
LOGIN_URL = f"{BASE_URL}/account/login"

# Session cache — avoid logging in again for every scraper instance.
# A cached session is reused for SESSION_TTL_SECONDS; after that (or when
# a request reveals the session expired), a fresh "verification" login is
# performed and the cache is refreshed.
SESSION_TTL_SECONDS = 20 * 60  # 20 minut

_session_cache: dict[str, dict] = {}
_session_lock = threading.Lock()

_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)


class HiyoriScraper:
    def __init__(self, username: str, password: str, timeout: int = 15):
        self.username = username
        self.password = password
        self.timeout  = timeout
        self._cookies: dict = {}

    # ── Login ─────────────────────────────────────────────────────────

    def _make_client(self) -> httpx.Client:
        return httpx.Client(
            headers={"User-Agent": _UA},
            cookies=self._cookies,
            timeout=self.timeout,
            follow_redirects=True,
        )

    def _get(self, c: httpx.Client, url: str, **kwargs) -> httpx.Response:
        """GET with automatic retry on 429 (respects Retry-After header)."""
        for attempt in range(4):
            r = c.get(url, **kwargs)
            if r.status_code == 429:
                retry_after = int(r.headers.get("Retry-After", "10"))
                wait = max(retry_after, 5) * (attempt + 1)
                log.warning("Hiyori 429 – čekám %ds (pokus %d/4)", wait, attempt + 1)
                time.sleep(wait)
                continue
            return r
        r.raise_for_status()  # raise on final 429
        return r

    def _post(self, c: httpx.Client, url: str, **kwargs) -> httpx.Response:
        """POST with automatic retry on 429."""
        for attempt in range(4):
            r = c.post(url, **kwargs)
            if r.status_code == 429:
                retry_after = int(r.headers.get("Retry-After", "10"))
                wait = max(retry_after, 5) * (attempt + 1)
                log.warning("Hiyori 429 – čekám %ds (pokus %d/4)", wait, attempt + 1)
                time.sleep(wait)
                continue
            return r
        r.raise_for_status()
        return r

    def login(self):
        with self._make_client() as c:
            r = self._get(c, BASE_URL + "/")
            r.raise_for_status()
            soup = BeautifulSoup(r.text, "html.parser")

            login_form = soup.find("form", {"action": re.compile(r"/account/login", re.I)})
            extra: dict = {}
            if login_form:
                for hidden in login_form.find_all("input", {"type": "hidden"}):
                    name = hidden.get("name", "")
                    val  = hidden.get("value", "")
                    if name:
                        extra[name] = val

            payload = {
                "username":    self.username,
                "Password":    self.password,
                "remember_me": "1",
                **extra,
            }
            time.sleep(1)  # polite delay before POST
            r2 = self._post(c, LOGIN_URL, data=payload)
            r2.raise_for_status()

            final_url = str(r2.url).rstrip("/")
            if LOGIN_URL.rstrip("/") in final_url or BASE_URL.rstrip("/") + "/" == final_url + "/":
                text_lower = r2.text.lower()
                if "odhl" not in text_lower and "logout" not in text_lower:
                    raise PermissionError(
                        f"Hiyori.cz: přihlášení selhalo pro '{self.username}'"
                    )
            # Persist cookies
            self._cookies = {ck.name: ck.value for ck in c.cookies.jar}
            with _session_lock:
                _session_cache[self.username] = {
                    "cookies": dict(self._cookies),
                    "ts": time.monotonic(),
                }
            log.info("Hiyori: přihlášení OK")

    def _ensure_logged_in(self, verify: bool = False) -> None:
        """Reuse a cached session (<SESSION_TTL_SECONDS old) if available,
        otherwise perform a fresh login and refresh the cache.

        verify=True forces a fresh "verification" login regardless of the
        cache age (used when a request reveals the session expired)."""
        if not verify:
            with _session_lock:
                cached = _session_cache.get(self.username)
                if cached and (time.monotonic() - cached["ts"]) < SESSION_TTL_SECONDS:
                    self._cookies = dict(cached["cookies"])
                    return
        self._login_or_raise()

    # ── Search ────────────────────────────────────────────────────────

    def search(
        self,
        title: str,
        season: int | None = None,
        episode: int | None = None,
        language: str = "cs",
        status_cb=None,
    ) -> list[dict]:
        def _log(msg: str):
            if status_cb:
                status_cb(f"  [Hiyori] {msg}")

        if episode is None:
            return []

        self._ensure_logged_in()

        with self._make_client() as c:
            _log(f"autocomplete '{title}'...")
            try:
                r = self._get(
                    c,
                    f"{BASE_URL}/search/search",
                    params={"nazev": title},
                    headers={"Accept": "application/json"},
                )
                r.raise_for_status()
                candidates = r.json() if r.content else []
            except Exception as e:
                _log(f"autocomplete chyba: {e}")
                return []

            if not candidates:
                _log("0 kandidátů")
                return []

            results = []
            for item in candidates[:3]:
                anime_id = item.get("id_anime")
                name     = item.get("jmeno_orig", "?")
                if not anime_id:
                    continue
                _log(f"anime_id={anime_id} '{name}'...")
                try:
                    time.sleep(1)  # polite delay between anime page fetches
                    rows = self._parse_subtitle_table(c, anime_id)
                    matching = self._filter_rows(rows, episode, season)
                    for row in matching:
                        results.extend(self._row_to_results(row))
                    if results:
                        break
                except Exception as e:
                    _log(f"chyba: {e}")

            # Preferuj titulky v požadovaném jazyce (cs) před ostatními (např. sk)
            results.sort(key=lambda r: r.get("language") != language)

            _log(f"nalezeno {len(results)} titulků")
            return results

    # ── Audit Logic 4: planned / in-progress / revived check ────────────

    def check_planned_or_revived(self, title: str, keywords: list[str] | None = None) -> dict:
        """
        Check whether *title* appears on hiyori.cz as planned / in-progress /
        revived — i.e. the fansub team intends to or is currently working on
        subtitles for it, as opposed to the title only existing with old,
        finished subtitles (or not existing at all).

        Used by the audit system (Logic 4) before assigning the ABANDONED
        state: if planned/in-progress, PENDING_TRANSLATION is assigned
        instead.

        Returns:
            {"found": bool, "anime_id": int|None, "title": str|None,
             "planned": bool, "matched_keyword": str|None, "url": str|None}

        Does not require login — uses the public autocomplete + anime page.
        """
        if keywords is None:
            keywords = [
                "připravujeme", "pripravujeme", "chystáme", "chystame",
                "rozjíždíme", "rozjizdime", "rozjedeme",
                "probíhá", "probiha", "probíhající", "probihajici",
                "v překladu", "v prekladu", "překládáme", "prekladame",
                "coming soon", "in progress", "upcoming",
                "plánujeme", "planujeme", "naplánováno", "naplanovano",
            ]

        out = {
            "found": False, "anime_id": None, "title": None,
            "planned": False, "matched_keyword": None, "url": None,
        }

        with self._make_client() as c:
            try:
                r = self._get(
                    c, f"{BASE_URL}/search/search",
                    params={"nazev": title},
                    headers={"Accept": "application/json"},
                )
                r.raise_for_status()
                candidates = r.json() if r.content else []
            except Exception as e:
                log.warning("Hiyori check_planned_or_revived: autocomplete chyba: %s", e)
                return out

            if not candidates:
                return out

            item = candidates[0]
            anime_id = item.get("id_anime")
            if not anime_id:
                return out

            out["found"]    = True
            out["anime_id"] = anime_id
            out["title"]    = item.get("jmeno_orig") or item.get("jmeno")
            out["url"]      = f"{BASE_URL}/anime/{anime_id}"

            try:
                time.sleep(1)  # polite delay before detail fetch
                r2 = self._get(c, out["url"])
                r2.raise_for_status()
                page_text = r2.text.lower()
            except Exception as e:
                log.warning("Hiyori check_planned_or_revived: detail chyba: %s", e)
                return out

            for kw in keywords:
                if kw.lower() in page_text:
                    out["planned"]         = True
                    out["matched_keyword"] = kw
                    break

        return out

    # ── Download ──────────────────────────────────────────────────────

    def download(self, url: str) -> bytes:
        self._ensure_logged_in()
        with self._make_client() as c:
            time.sleep(1)
            r = self._get(c, url)
            r.raise_for_status()
            ct = r.headers.get("content-type", "")
            if "text/html" in ct:
                soup = BeautifulSoup(r.text, "html.parser")
                if soup.find("form", {"action": re.compile(r"/account/login", re.I)}):
                    self._cookies = {}
                    self._ensure_logged_in(verify=True)
                    time.sleep(1)
                    with self._make_client() as c2:
                        r = self._get(c2, url)
                        r.raise_for_status()
                        ct = r.headers.get("content-type", "")
                        if "text/html" in ct:
                            raise PermissionError(
                                "Hiyori: přihlášení selhalo — zkontroluj credentials v Nastavení → Indexery"
                            )
                        return r.content
                dl = (
                    soup.find("a", href=re.compile(r"\.(srt|zip|ass|ssa)($|\?)", re.I))
                    or soup.find("a", string=re.compile(r"stahnout|download", re.I))
                )
                if dl:
                    dl_url = dl["href"]
                    if not dl_url.startswith("http"):
                        dl_url = BASE_URL + dl_url
                    time.sleep(1)
                    r = self._get(c, dl_url)
                    r.raise_for_status()
                else:
                    raise ValueError("Hiyori.cz: server vrátil HTML místo souboru")
            return r.content

    # ── Internals ─────────────────────────────────────────────────────

    def _parse_subtitle_table(self, c: httpx.Client, anime_id: int) -> list[dict]:
        r = self._get(c, f"{BASE_URL}/anime/{anime_id}")
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "html.parser")
        table = soup.find("table", {"id": "AnimeSubs"})
        if not table:
            return []

        field_map: dict[str, int] = {}
        thead = table.find("thead")
        if thead:
            for i, th in enumerate(thead.find_all("th")):
                field = th.get("data-field")
                if field:
                    field_map[field] = i

        tbody = table.find("tbody")
        if not tbody:
            return []

        rows = []
        for tr in tbody.find_all("tr"):
            cells = tr.find_all("td")
            row: dict = {}
            for field, col_idx in field_map.items():
                if col_idx >= len(cells):
                    continue
                cell = cells[col_idx]
                if field == "moznosti":
                    row["moznosti_html"] = str(cell)
                elif field == "nazev_fansub":
                    row["nazev_fansub"] = cell.get_text(strip=True)
                else:
                    row[field] = cell.get_text(strip=True)
            rows.append(row)
        return rows

    def _filter_rows(self, rows: list[dict], episode: int, season: int | None = None) -> list[dict]:
        matching = []
        ova_matching = []  # OVA rows that match — lower priority for regular episodes
        for row in rows:
            id_dil = row.get("id_dil", "").strip()
            nazev  = row.get("nazev", "").lower()
            is_whole = ("celá" in nazev or "cela" in nazev or "serie" in nazev
                        or "seri" in nazev or id_dil in ("", "0"))
            is_ova = "ova" in nazev
            ep_match = False
            try:
                ep_match = (int(id_dil) == episode)
            except (ValueError, TypeError):
                pass
            if ep_match or is_whole:
                # Deprioritize OVA rows when searching for a regular episode (season > 0)
                if is_ova and season and season > 0:
                    ova_matching.append(row)
                else:
                    matching.append(row)
        # Regular matches first; OVA-only matches only if nothing else found
        return matching or ova_matching or rows

    def _row_to_results(self, row: dict) -> list[dict]:
        results = []
        moznosti_html = row.get("moznosti_html", "")
        if not moznosti_html:
            return results
        soup = BeautifulSoup(moznosti_html, "html.parser")
        for a in soup.find_all("a", href=True):
            href = a["href"]
            if href.startswith("javascript:"):
                continue
            if not href.startswith("http"):
                href = BASE_URL + href
            # Skip profile / fansub pages (not download links)
            if any(p in href for p in ("/profil/", "/fansuby/")):
                continue

            # Determine effective source based on URL domain
            from urllib.parse import urlparse as _up
            _host = _up(href).netloc.lower()
            if "hns.sk" in _host:
                source = "hns"
            elif "hiyori.cz" in _host:
                source = "hiyori"
            else:
                source = "direct"   # other external site — plain HTTP download

            jazyk = row.get("jazyk", "CZ").upper()
            lang = {"CZ": "cs", "CS": "cs", "SK": "sk", "EN": "en"}.get(jazyk, jazyk.lower())
            parts = []
            if row.get("nazev"):
                parts.append(row["nazev"])
            if row.get("release"):
                parts.append(f"[{row['release']}]")
            if row.get("nazev_fansub"):
                parts.append(f"({row['nazev_fansub']})")
            results.append({
                "source":   source,
                "title":    " ".join(parts) or "Hiyori titulek",
                "language": lang,
                "url":      href,
                "rating":   row.get("verze", ""),
                "uploader": row.get("nazev_fansub", ""),
                "notes":    row.get("pridano", ""),
            })
        return results

    def _login_or_raise(self):
        try:
            self.login()
        except PermissionError:
            raise PermissionError(
                "Hiyori: přihlášení selhalo — zkontroluj credentials v Nastavení → Indexery"
            )
