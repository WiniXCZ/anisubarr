"""
Hiyori.cz scraper – Czech anime subtitles.
Ported from subtitle_bazarr_alfa/scraper/hiyori.py
"""
from __future__ import annotations

import logging
import re
import time
import httpx
from bs4 import BeautifulSoup

log = logging.getLogger("anisubarr.hiyori")

BASE_URL  = "https://hiyori.cz"
LOGIN_URL = f"{BASE_URL}/account/login"

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
            self._cookies = dict(c.cookies)
            log.info("Hiyori: přihlášení OK")

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

        if not self._cookies:
            self.login()

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
                    matching = self._filter_rows(rows, episode)
                    for row in matching:
                        results.extend(self._row_to_results(row))
                    if results:
                        break
                except Exception as e:
                    _log(f"chyba: {e}")

            _log(f"nalezeno {len(results)} titulků")
            return results

    # ── Download ──────────────────────────────────────────────────────

    def download(self, url: str) -> bytes:
        if not self._cookies:
            self.login()
        with self._make_client() as c:
            time.sleep(1)
            r = self._get(c, url)
            r.raise_for_status()
            ct = r.headers.get("content-type", "")
            if "text/html" in ct:
                soup = BeautifulSoup(r.text, "html.parser")
                if soup.find("form", {"action": re.compile(r"/account/login", re.I)}):
                    self._cookies = {}
                    self.login()
                    time.sleep(1)
                    with self._make_client() as c2:
                        r = self._get(c2, url)
                        r.raise_for_status()
                        ct = r.headers.get("content-type", "")
                        if "text/html" in ct:
                            raise PermissionError("Hiyori.cz: session expirovala")
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
        soup  = BeautifulSoup(r.text, "html.parser")
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

    def _filter_rows(self, rows: list[dict], episode: int) -> list[dict]:
        matching = []
        for row in rows:
            id_dil = row.get("id_dil", "").strip()
            nazev  = row.get("nazev", "").lower()
            is_whole = ("celá" in nazev or "cela" in nazev or "serie" in nazev
                        or "seri" in nazev or id_dil in ("", "0"))
            ep_match = False
            try:
                ep_match = (int(id_dil) == episode)
            except (ValueError, TypeError):
                pass
            if ep_match or is_whole:
                matching.append(row)
        return matching or rows

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
