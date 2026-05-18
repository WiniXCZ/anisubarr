"""
HnS.sk scraper – Czech/Slovak anime subtitles.
Ported from subtitle_bazarr_alfa/scraper/hns.py
"""
from __future__ import annotations

import logging
import time
import httpx
from bs4 import BeautifulSoup
from urllib.parse import urlencode, urlparse, parse_qs

log = logging.getLogger("anisubarr.hns")

BASE_URL   = "https://hns.sk"
LOGIN_URL  = f"{BASE_URL}/site/login"
SEARCH_URL = f"{BASE_URL}/animelist"

_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)


class HnsScraper:
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
        """GET with retry on 429."""
        for attempt in range(4):
            r = c.get(url, **kwargs)
            if r.status_code == 429:
                wait = max(int(r.headers.get("Retry-After", "10")), 5) * (attempt + 1)
                log.warning("HNS 429 – čekám %ds", wait)
                time.sleep(wait)
                continue
            return r
        r.raise_for_status()
        return r

    def _post(self, c: httpx.Client, url: str, **kwargs) -> httpx.Response:
        """POST with retry on 429."""
        for attempt in range(4):
            r = c.post(url, **kwargs)
            if r.status_code == 429:
                wait = max(int(r.headers.get("Retry-After", "10")), 5) * (attempt + 1)
                log.warning("HNS 429 – čekám %ds", wait)
                time.sleep(wait)
                continue
            return r
        r.raise_for_status()
        return r

    def login(self):
        with self._make_client() as c:
            r = self._get(c, LOGIN_URL)
            r.raise_for_status()

            if str(r.url).rstrip("/") != LOGIN_URL.rstrip("/"):
                self._cookies = dict(c.cookies)
                log.info("HNS: již přihlášen (cookie)")
                return  # already logged in

            soup = BeautifulSoup(r.text, "html.parser")
            form = soup.find("form")
            if not form:
                log.error("HNS: přihlašovací formulář nenalezen na %s", r.url)
                raise ValueError("hns.sk: přihlašovací formulář nenalezen")

            payload: dict = {}
            user_field = pass_field = None
            for inp in form.find_all("input"):
                name = inp.get("name", "").strip()
                typ  = inp.get("type", "text").lower()
                val  = inp.get("value", "")
                if not name or typ in ("submit", "button", "image", "reset"):
                    continue
                payload[name] = val
                name_l = name.lower()
                if typ == "password" or ("pass" in name_l and "user" not in name_l and "email" not in name_l):
                    if pass_field is None:
                        pass_field = name
                elif typ in ("text", "email") or any(k in name_l for k in ("user", "email", "mail")):
                    if user_field is None:
                        user_field = name

            if not user_field or not pass_field:
                log.error("HNS: nenalezena přihlašovací pole: %s", list(payload.keys()))
                raise ValueError(f"hns.sk: nenalezena přihlašovací pole ({list(payload.keys())})")

            payload[user_field] = self.username
            payload[pass_field] = self.password
            log.debug("HNS: přihlašuji se jako '%s' přes pole '%s'", self.username, user_field)

            action = form.get("action", LOGIN_URL)
            if not action.startswith("http"):
                action = BASE_URL + action

            time.sleep(1)
            r2 = self._post(c, action, data=payload)
            r2.raise_for_status()

            final_url = str(r2.url).rstrip("/")
            if LOGIN_URL.rstrip("/") in final_url:
                # Still on login page — check if it's actually showing logged-in state
                text_lower = r2.text.lower()
                if "odhl" not in text_lower and "logout" not in text_lower and "odhlas" not in text_lower:
                    log.error("HNS: přihlášení selhalo, final_url=%s", final_url)
                    raise PermissionError(f"hns.sk: přihlášení selhalo pro '{self.username}'")

            self._cookies = dict(c.cookies)
            log.info("HNS: přihlášení OK")

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
                status_cb(f"  [HNS] {msg}")

        if episode is None:
            return []

        if not self._cookies:
            self.login()

        with self._make_client() as c:
            _log(f"hledám slug pro '{title}'...")
            slug = self._find_slug(c, title)
            if not slug:
                _log("slug nenalezen")
                return []

            _log(f"slug={slug}, hledám ep{episode}...")
            ep_url = self._find_episode_url(c, slug, episode)
            if not ep_url:
                _log(f"URL epizody {episode} nenalezena")
                return []

            results = self._parse_episode_page(c, ep_url)
            _log(f"nalezeno {len(results)} titulků")
            return results

    # ── Download ──────────────────────────────────────────────────────

    def download(self, url: str, _retry: bool = False) -> bytes:
        if not self._cookies:
            self.login()

        parsed   = urlparse(url)
        params   = parse_qs(parsed.query)
        ep_url   = f"{parsed.scheme}://{parsed.netloc}{parsed.path}"
        sub_id   = params.get("_hns_id",   [""])[0]
        filename = params.get("_hns_name",  [""])[0]

        if not sub_id:
            # URL je přímý odkaz na HNS epizodu (např. z Hiyori) bez _hns_id.
            # Načteme stránku epizody a stáhneme první dostupný titulek.
            log.info("HNS: _hns_id chybí, parsuju epizodní stránku: %s", ep_url)
            with self._make_client() as c:
                try:
                    return self._download_from_episode_page(c, ep_url)
                except ValueError as e:
                    if not _retry and "html" in str(e).lower():
                        log.info("HNS: session expirovala (episode page), přihlašuji se znovu...")
                        self._cookies = {}
                        self.login()
                        with self._make_client() as c2:
                            return self._download_from_episode_page(c2, ep_url)
                    raise

        with self._make_client() as c:
            r = self._get(c, ep_url)
            r.raise_for_status()
            soup = BeautifulSoup(r.text, "html.parser")
            ci   = soup.find("input", {"name": "_csrf"})
            csrf = ci["value"] if ci else ""

            if not csrf:
                log.error("HNS: CSRF token chybí na %s", ep_url)
                raise ValueError(f"Nepodařilo se získat CSRF token z {ep_url}")

            time.sleep(1)
            r2 = self._post(c, ep_url, data={
                "id":     sub_id,
                "name":   filename,
                "_csrf":  csrf,
                "action": "download",
            })
            r2.raise_for_status()
            ct = r2.headers.get("content-type", "")
            if "text/html" in ct:
                if not _retry:
                    log.info("HNS: session expirovala, přihlašuji se znovu a zkouším ještě jednou...")
                    self._cookies = {}
                    return self.download(url, _retry=True)
                log.error("HNS: download vrátil HTML místo souboru i po re-loginu")
                raise ValueError("HNS: server vrátil HTML místo souboru — session možná expirovala")
            return r2.content

    def _download_from_episode_page(self, c: httpx.Client, ep_url: str) -> bytes:
        """
        Načte HNS epizodní stránku a stáhne první dostupný titulek přes POST formulář.
        Používá se, když máme přímý HNS odkaz bez _hns_id (např. link z Hiyori).
        """
        r = self._get(c, ep_url)
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "html.parser")

        for form in soup.find_all("form"):
            id_inp     = form.find("input", {"name": "id"})
            name_inp   = form.find("input", {"name": "name"})
            csrf_inp   = form.find("input", {"name": "_csrf"})
            action_inp = form.find("input", {"name": "action"})

            if not id_inp or not name_inp:
                continue
            if action_inp and action_inp.get("value") != "download":
                continue

            sub_id   = id_inp["value"]
            filename = name_inp["value"]
            csrf     = csrf_inp["value"] if csrf_inp else ""

            if not csrf:
                log.warning("HNS: _download_from_episode_page: CSRF chybí, zkouším bez něj")

            log.info("HNS: stahuju sub_id=%s filename=%s z %s", sub_id, filename, ep_url)
            time.sleep(1)
            r2 = self._post(c, ep_url, data={
                "id":     sub_id,
                "name":   filename,
                "_csrf":  csrf,
                "action": "download",
            })
            r2.raise_for_status()
            ct = r2.headers.get("content-type", "")
            if "text/html" in ct:
                log.error("HNS: _download_from_episode_page vrátil HTML (session expirovala?)")
                raise ValueError("HNS: server vrátil HTML místo souboru — session možná expirovala")
            return r2.content

        raise ValueError(f"HNS: na stránce {ep_url} nebyl nalezen žádný download formulář")

    # ── Internals ─────────────────────────────────────────────────────

    def _find_slug(self, c: httpx.Client, title: str) -> str | None:
        r = self._get(c, SEARCH_URL)
        r.raise_for_status()
        soup       = BeautifulSoup(r.text, "html.parser")
        csrf_input = soup.find("input", {"name": "_csrf"})
        csrf       = csrf_input["value"] if csrf_input else ""

        if not csrf:
            log.warning("HNS: _find_slug: CSRF token chybí na %s", SEARCH_URL)

        time.sleep(1)
        r2 = self._post(c, SEARCH_URL, data={
            "_csrf":                   csrf,
            "AnimelistSearch[nazev]":  title,
        })
        r2.raise_for_status()
        soup2 = BeautifulSoup(r2.text, "html.parser")
        for a in soup2.select('a[href^="/anime/"]'):
            href = a["href"]
            if "/episode/" not in href:
                slug = href[len("/anime/"):].split("/")[0]
                if slug:
                    log.debug("HNS: slug='%s' pro '%s'", slug, title)
                    return slug
        log.warning("HNS: slug nenalezen pro '%s'", title)
        return None

    def _find_episode_url(self, c: httpx.Client, slug: str, episode_num: int) -> str | None:
        time.sleep(1)
        r = self._get(c, f"{BASE_URL}/anime/{slug}")
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "html.parser")
        for a in soup.select('a[href*="/anime/episode/"]'):
            text  = a.get_text(strip=True)
            parts = text.split()
            if parts and parts[-1].isdigit() and int(parts[-1]) == episode_num:
                href = a["href"]
                if not href.startswith("http"):
                    href = BASE_URL + href
                return href
        return None

    def _parse_episode_page(self, c: httpx.Client, episode_url: str) -> list[dict]:
        time.sleep(1)
        r = self._get(c, episode_url)
        r.raise_for_status()
        soup    = BeautifulSoup(r.text, "html.parser")
        results = []

        for form in soup.find_all("form"):
            id_inp     = form.find("input", {"name": "id"})
            name_inp   = form.find("input", {"name": "name"})
            csrf_inp   = form.find("input", {"name": "_csrf"})
            action_inp = form.find("input", {"name": "action"})

            if not id_inp or not name_inp:
                continue
            if action_inp and action_inp.get("value") != "download":
                continue

            sub_id   = id_inp["value"]
            filename = name_inp["value"]
            csrf     = csrf_inp["value"] if csrf_inp else ""

            release = translator = date_str = version = ""
            row = (form.find_parent("tr") or form.find_parent("td") or form.find_parent("div"))
            if row:
                cells      = row.find_all("td")
                release    = cells[0].get_text(strip=True) if len(cells) > 0 else ""
                translator = cells[1].get_text(strip=True) if len(cells) > 1 else ""
                date_str   = cells[2].get_text(strip=True) if len(cells) > 2 else ""
                version    = cells[3].get_text(strip=True) if len(cells) > 3 else ""

            from .subtitle_utils import detect_language_from_name
            lang = detect_language_from_name(filename, f"{release} {translator} {version}")

            qs = urlencode({
                "_hns_id":   sub_id,
                "_hns_name": filename,
                "_hns_csrf": csrf,
            })
            results.append({
                "source":   "hns",
                "title":    f"{release} | {translator}".strip(" |"),
                "language": lang,
                "url":      f"{episode_url}?{qs}",
                "rating":   version,
                "uploader": translator,
                "notes":    date_str,
            })
        return results
