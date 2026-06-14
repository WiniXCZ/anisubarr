"""
kamui-subs.cz scraper – Czech anime subtitles.

Kamui distributes subtitle archives as password-protected RAR files.
The RAR password is site-wide (stored in settings as kamui_rar_password).
"""
from __future__ import annotations

import logging
import os
import time
import httpx
from bs4 import BeautifulSoup
from urllib.parse import urljoin, urlparse

from .subtitle_utils import extract_rar_subtitle, detect_language_from_name

log = logging.getLogger("anisubarr.kamui")

BASE_URL  = "https://kamui-subs.cz"

_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)


class KamuiScraper:
    def __init__(self, username: str, password: str,
                 rar_password: str = "kamui", timeout: int = 20):
        self.username     = username
        self.password     = password
        self.rar_password = rar_password
        self.timeout      = timeout
        self._cookies: dict = {}

    # ── HTTP helpers ──────────────────────────────────────────────────

    def _make_client(self) -> httpx.Client:
        return httpx.Client(
            headers={"User-Agent": _UA},
            cookies=self._cookies,
            timeout=self.timeout,
            follow_redirects=True,
        )

    def _get(self, c: httpx.Client, url: str, **kw) -> httpx.Response:
        for attempt in range(3):
            r = c.get(url, **kw)
            if r.status_code == 429:
                wait = max(int(r.headers.get("Retry-After", "10")), 5) * (attempt + 1)
                log.warning("Kamui 429 – čekám %ds", wait)
                time.sleep(wait)
                continue
            return r
        r.raise_for_status()
        return r

    def _post(self, c: httpx.Client, url: str, **kw) -> httpx.Response:
        for attempt in range(3):
            r = c.post(url, **kw)
            if r.status_code == 429:
                wait = max(int(r.headers.get("Retry-After", "10")), 5) * (attempt + 1)
                log.warning("Kamui 429 – čekám %ds", wait)
                time.sleep(wait)
                continue
            return r
        r.raise_for_status()
        return r

    # ── Login ─────────────────────────────────────────────────────────

    def login(self):
        """Login to kamui-subs.cz. Detects existing session via cookie."""
        with self._make_client() as c:
            r = self._get(c, BASE_URL + "/")
            r.raise_for_status()
            text_lower = r.text.lower()

            # Check if already logged in
            if self._is_logged_in(r.text):
                self._cookies = dict(c.cookies)
                log.info("Kamui: již přihlášen (cookie)")
                return

            # Find login form
            soup = BeautifulSoup(r.text, "html.parser")
            login_url = BASE_URL + "/login"

            # Try to find a login link
            for a in soup.find_all("a", href=True):
                if "login" in a["href"].lower() or "prihlasit" in a["href"].lower():
                    login_url = urljoin(BASE_URL, a["href"])
                    break

            r2 = self._get(c, login_url)
            r2.raise_for_status()
            soup2 = BeautifulSoup(r2.text, "html.parser")

            def _find_login_form(soup: BeautifulSoup):
                """Return the first form that contains a password input field."""
                for candidate in soup.find_all("form"):
                    if any(
                        inp.get("type", "").lower() == "password"
                        for inp in candidate.find_all("input")
                    ):
                        return candidate
                return None

            # Find the login form — must contain a password field
            form = _find_login_form(soup2)
            if not form:
                # Try alternate login endpoints
                for path in ["/prihlaseni", "/user/login", "/account/login", "/auth/login"]:
                    r3 = self._get(c, BASE_URL + path)
                    if r3.status_code == 200:
                        soup3 = BeautifulSoup(r3.text, "html.parser")
                        form = _find_login_form(soup3)
                        if form:
                            r2 = r3
                            soup2 = soup3
                            login_url = BASE_URL + path
                            break

            if not form:
                raise ValueError("kamui-subs.cz: přihlašovací formulář nenalezen")

            # Build form payload
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
                if typ == "password" or "pass" in name_l:
                    if pass_field is None:
                        pass_field = name
                elif typ in ("text", "email") or any(k in name_l for k in ("user", "email", "login", "name")):
                    if user_field is None:
                        user_field = name

            # Fallback: if user field wasn't identified by name patterns,
            # use the first non-password, non-hidden input in the form
            if not user_field:
                for inp in form.find_all("input"):
                    name = inp.get("name", "").strip()
                    typ  = inp.get("type", "text").lower()
                    if name and name in payload and typ not in (
                        "password", "hidden", "submit", "button",
                        "image", "reset", "checkbox", "radio",
                    ):
                        user_field = name
                        log.debug("Kamui: záložní username pole '%s'", name)
                        break

            # Fallback: find any named password input in the form that the main
            # loop may have missed (e.g., inconsistent type-attribute defaults)
            if not pass_field:
                for inp in form.find_all("input"):
                    if inp.get("type", "").lower() == "password":
                        n = inp.get("name", "").strip()
                        if n:
                            pass_field = n
                            if n not in payload:
                                payload[n] = ""
                            log.debug("Kamui: záložní password pole '%s'", n)
                        break

            if not user_field or not pass_field:
                log.error("Kamui: nalezená pole: %s", list(payload.keys()))
                raise ValueError(
                    f"kamui-subs.cz: nenalezena přihlašovací pole "
                    f"(nalezeno: {list(payload.keys())})"
                )

            payload[user_field] = self.username
            payload[pass_field] = self.password

            action = form.get("action", login_url)
            if not action.startswith("http"):
                action = urljoin(BASE_URL, action)

            time.sleep(1)
            r_login = self._post(c, action, data=payload)
            r_login.raise_for_status()

            if not self._is_logged_in(r_login.text):
                # Check if still on login page (= wrong credentials)
                if "login" in str(r_login.url).lower() or "prihlaseni" in str(r_login.url).lower():
                    raise PermissionError(
                        f"kamui-subs.cz: přihlášení selhalo pro '{self.username}' — "
                        f"zkontroluj přihlašovací údaje"
                    )

            self._cookies = dict(c.cookies)
            log.info("Kamui: přihlášení OK jako '%s'", self.username)

    def _is_logged_in(self, html: str) -> bool:
        text_lower = html.lower()
        return (
            "odhlásit" in text_lower
            or "odhlasit" in text_lower
            or "logout" in text_lower
            or "odhl" in text_lower
        )

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
            log.debug(msg)
            if status_cb:
                status_cb(f"  [Kamui] {msg}")

        if episode is None:
            return []

        if not self._cookies:
            self.login()

        with self._make_client() as c:
            _log(f"hledám '{title}'...")
            anime_url = self._find_anime_url(c, title, _log)
            if not anime_url:
                _log("anime nenalezeno")
                return []

            _log(f"nalezeno: {anime_url}")
            ep_url = self._find_episode_url(c, anime_url, season, episode, _log)
            if not ep_url:
                _log(f"URL epizody S{season:02d}E{episode:02d} nenalezena")
                return []

            results = self._parse_subtitle_links(c, ep_url, title, season, episode)
            _log(f"nalezeno {len(results)} titulků")
            return results

    def _find_anime_url(self, c: httpx.Client, title: str, _log) -> str | None:
        """Search for anime on kamui-subs.cz by title."""
        # Try common search patterns
        for search_path in ["/search", "/hledani", "/anime"]:
            try:
                r = self._get(c, BASE_URL + search_path, params={"q": title, "search": title, "query": title})
                if r.status_code == 200:
                    soup = BeautifulSoup(r.text, "html.parser")
                    found = self._extract_anime_link(soup, title)
                    if found:
                        return found
            except Exception as e:
                log.debug("Kamui search path %s: %s", search_path, e)
                continue

        # Try direct URL guess (slug from title)
        slug = title.lower().replace(" ", "-").replace(":", "").replace("'", "")
        for path in [f"/anime/{slug}", f"/titulky/{slug}", f"/{slug}"]:
            try:
                r = self._get(c, BASE_URL + path)
                if r.status_code == 200 and "404" not in r.text[:200]:
                    return BASE_URL + path
            except Exception:
                pass

        return None

    def _extract_anime_link(self, soup: BeautifulSoup, title: str) -> str | None:
        """Find the best matching anime link from a search results page."""
        title_lower = title.lower()
        best: tuple[int, str] | None = None

        for a in soup.find_all("a", href=True):
            href = a["href"]
            text = a.get_text(strip=True).lower()
            # Score by title match
            score = 0
            if title_lower in text:
                score = 10
            elif any(w in text for w in title_lower.split() if len(w) > 3):
                score = 5
            if score == 0:
                continue
            # Prefer links that look like anime pages
            if any(k in href for k in ("/anime/", "/titulky/", "/serial/")):
                score += 3
            if best is None or score > best[0]:
                best = (score, urljoin(BASE_URL, href))

        return best[1] if best else None

    def _find_episode_url(
        self,
        c: httpx.Client,
        anime_url: str,
        season: int | None,
        episode: int,
        _log,
    ) -> str | None:
        """Find the URL for a specific episode on the anime page."""
        time.sleep(1)
        r = self._get(c, anime_url)
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "html.parser")

        ep_str     = str(episode)
        ep_padded  = f"{episode:02d}"

        # Look for links mentioning this episode
        for a in soup.find_all("a", href=True):
            href = a["href"]
            text = a.get_text(strip=True)

            # Match patterns like "E01", "Epizoda 1", "1. epizoda", etc.
            ep_match = (
                f"E{ep_padded}" in text
                or f"e{ep_padded}" in text
                or f"epizoda {ep_str}" in text.lower()
                or f"episode {ep_str}" in text.lower()
                or text.strip() == ep_str
                or text.strip() == ep_padded
            )
            if not ep_match:
                continue

            full_url = urljoin(BASE_URL, href)
            _log(f"nalezena epizoda: {full_url}")
            return full_url

        # If no episode link found, maybe the page IS the episode page
        # (for single-season shows, the anime page may list subtitles directly)
        if self._has_download_links(soup):
            return anime_url

        return None

    def _has_download_links(self, soup: BeautifulSoup) -> bool:
        """Check if a page has subtitle download links."""
        for a in soup.find_all("a", href=True):
            href = a["href"].lower()
            if any(k in href for k in (".srt", ".ass", ".rar", ".zip", "download", "stahnout", "stáhnout")):
                return True
        return False

    def _parse_subtitle_links(
        self,
        c: httpx.Client,
        ep_url: str,
        title: str,
        season: int | None,
        episode: int,
    ) -> list[dict]:
        """Parse subtitle download links from an episode page."""
        time.sleep(1)
        r = self._get(c, ep_url)
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "html.parser")

        results = []
        seen_urls: set[str] = set()

        for a in soup.find_all("a", href=True):
            href = a["href"]
            href_lower = href.lower()
            text = a.get_text(strip=True)

            is_sub_link = any(k in href_lower for k in (
                ".srt", ".ass", ".rar", ".zip",
                "download", "stahnout", "stáhnout", "titulek",
            ))
            if not is_sub_link:
                continue

            full_url = urljoin(BASE_URL, href)
            if full_url in seen_urls:
                continue
            seen_urls.add(full_url)

            ext_guess = "rar" if ".rar" in href_lower else ("zip" if ".zip" in href_lower else "srt")

            # Detect language from the link URL and surrounding text
            # Also check parent element text for language labels
            parent_text = ""
            parent = a.find_parent(["tr", "td", "li", "div", "p"])
            if parent:
                parent_text = parent.get_text(" ", strip=True)
            lang = detect_language_from_name(href, f"{text} {parent_text}")

            results.append({
                "source":   "kamui",
                "title":    text or f"Kamui S{season:02d}E{episode:02d}",
                "language": lang,
                "url":      full_url,
                "rating":   "",
                "uploader": "kamui-subs.cz",
                "notes":    ext_guess,
            })

        log.debug("Kamui: nalezeno %d odkazů na titulky na %s", len(results), ep_url)
        return results

    # ── Download ──────────────────────────────────────────────────────

    def download(self, url: str, _retry: bool = False) -> bytes:
        """Download subtitle from URL, extract from RAR if needed.

        Returns plain subtitle bytes (SRT/ASS), NOT the raw RAR archive.
        The RAR password (self.rar_password) is applied automatically.
        """
        if not self._cookies:
            self._login_or_raise()

        with self._make_client() as c:
            time.sleep(1)
            r = self._get(c, url)
            r.raise_for_status()

            ct = r.headers.get("content-type", "")
            is_html = "text/html" in ct or r.content[:9].lower().startswith(b"<!doctype")
            if is_html:
                if not _retry:
                    log.info("Kamui: session expirovala, přihlašuji se znovu...")
                    self._cookies = {}
                    self._login_or_raise()
                    return self.download(url, _retry=True)
                log.error("Kamui: download vrátil HTML i po re-loginu")
                raise PermissionError(
                    "Kamui: přihlášení selhalo — zkontroluj credentials v Nastavení → Indexery"
                )

            raw = r.content

        # If it's a RAR archive, extract subtitle using the site password
        if raw[:4] == b"Rar!":
            log.debug("Kamui: extrahuju RAR (heslo=%r)", self.rar_password)
            sub_bytes, _ = extract_rar_subtitle(raw, self.rar_password)
            return sub_bytes

        # ZIP or plain text — return as-is (extract_subtitle_bytes handles it)
        return raw

    def _login_or_raise(self):
        try:
            self.login()
        except PermissionError:
            raise PermissionError(
                "Kamui: přihlášení selhalo — zkontroluj credentials v Nastavení → Indexery"
            )
