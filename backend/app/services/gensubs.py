"""
teamns.gensubs.cz scraper – Czech anime subtitles (GenSubs / TeamNS).

GenSubs distributes complete-series RAR archives (all episodes in one file).
The scraper encodes the episode number in a synthetic download URL so that
download() knows which subtitle file to extract from the archive.

Synthetic URL format:
    <real_rar_url>?_ep=<episode_number>&_season=<season>
"""
from __future__ import annotations

import logging
import os
import re
import time
import httpx
from bs4 import BeautifulSoup
from urllib.parse import urljoin, urlparse, parse_qs, urlencode

from .subtitle_utils import extract_rar_subtitle, detect_language_from_name

log = logging.getLogger("anisubarr.gensubs")

BASE_URL = "https://teamns.gensubs.cz"

_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)


class GenSubsScraper:
    """teamns.gensubs.cz scraper — public site, no login required."""

    def __init__(self, username: str = "", password: str = "", timeout: int = 30):
        # username/password kept for API compatibility but not used
        self.timeout = timeout

    # ── HTTP helpers ──────────────────────────────────────────────────

    def _make_client(self) -> httpx.Client:
        return httpx.Client(
            headers={"User-Agent": _UA},
            timeout=self.timeout,
            follow_redirects=True,
        )

    def _get(self, c: httpx.Client, url: str, **kw) -> httpx.Response:
        for attempt in range(3):
            r = c.get(url, **kw)
            if r.status_code == 429:
                wait = max(int(r.headers.get("Retry-After", "10")), 5) * (attempt + 1)
                log.warning("GenSubs 429 – čekám %ds", wait)
                time.sleep(wait)
                continue
            return r
        r.raise_for_status()
        return r

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
                status_cb(f"  [GenSubs] {msg}")

        if episode is None:
            return []

        with self._make_client() as c:
            _log(f"hledám '{title}' S{season:02d}E{episode:02d}...")
            rar_url = self._find_series_rar_url(c, title, season, _log)
            if not rar_url:
                _log("RAR archiv nenalezen")
                return []

            # Encode episode info in synthetic URL
            sep = "&" if "?" in rar_url else "?"
            synthetic_url = f"{rar_url}{sep}_ep={episode}&_season={season or 1}"

            # Best-effort language detection from the RAR filename/URL
            lang = detect_language_from_name(rar_url)

            return [{
                "source":   "gensubs",
                "title":    f"GenSubs S{season:02d}E{episode:02d}",
                "language": lang,
                "url":      synthetic_url,
                "rating":   "",
                "uploader": "teamns.gensubs.cz",
                "notes":    "rar-series",
            }]

    def _find_series_rar_url(
        self,
        c: httpx.Client,
        title: str,
        season: int | None,
        _log,
    ) -> str | None:
        """Search for the series RAR archive URL on gensubs.cz."""
        title_lower = title.lower()

        # Try search endpoint
        for search_path in ["/search", "/hledani", "/"]:
            try:
                r = self._get(c, BASE_URL + search_path,
                              params={"q": title, "search": title, "query": title})
                if r.status_code == 200:
                    soup = BeautifulSoup(r.text, "html.parser")
                    url = self._find_rar_in_page(soup, title_lower, season, _log)
                    if url:
                        return url
            except Exception as e:
                log.debug("GenSubs search %s: %s", search_path, e)

        # Try anime listing page
        for list_path in ["/titulky", "/anime", "/archiv"]:
            try:
                r = self._get(c, BASE_URL + list_path)
                if r.status_code == 200:
                    soup = BeautifulSoup(r.text, "html.parser")
                    # Find link to the anime
                    anime_link = self._find_anime_link(soup, title_lower)
                    if anime_link:
                        _log(f"nalezena stránka anime: {anime_link}")
                        r2 = self._get(c, anime_link)
                        r2.raise_for_status()
                        soup2 = BeautifulSoup(r2.text, "html.parser")
                        url = self._find_rar_in_page(soup2, title_lower, season, _log)
                        if url:
                            return url
            except Exception as e:
                log.debug("GenSubs listing %s: %s", list_path, e)

        return None

    def _find_anime_link(self, soup: BeautifulSoup, title_lower: str) -> str | None:
        """Find a link to an anime page by title matching."""
        best: tuple[int, str] | None = None
        for a in soup.find_all("a", href=True):
            text = a.get_text(strip=True).lower()
            score = 0
            if title_lower in text:
                score = 10
            elif any(w in text for w in title_lower.split() if len(w) > 3):
                score = 5
            if score == 0:
                continue
            href = a["href"]
            if any(k in href for k in ("/anime/", "/serial/", "/titulky/")):
                score += 3
            if best is None or score > best[0]:
                best = (score, urljoin(BASE_URL, href))
        return best[1] if best else None

    def _find_rar_in_page(
        self,
        soup: BeautifulSoup,
        title_lower: str,
        season: int | None,
        _log,
    ) -> str | None:
        """Find a RAR download link on a page. Prefer season-specific archives."""
        candidates: list[tuple[int, str]] = []  # (score, url)

        for a in soup.find_all("a", href=True):
            href = a["href"]
            href_l = href.lower()
            text = a.get_text(strip=True).lower()

            # Must be a download link
            if not any(k in href_l for k in (".rar", ".zip", "download", "stahnout")):
                continue

            score = 0
            # Prefer RAR
            if ".rar" in href_l:
                score += 5
            # Prefer season-specific
            if season and (
                f"s{season:02d}" in href_l
                or f"serie{season}" in href_l
                or f"season{season}" in href_l
                or f"s{season}" in href_l
            ):
                score += 10
            # Prefer title match in URL or text
            if any(w in href_l for w in title_lower.split() if len(w) > 3):
                score += 3
            if any(w in text for w in title_lower.split() if len(w) > 3):
                score += 2

            candidates.append((score, urljoin(BASE_URL, href)))

        if not candidates:
            return None

        # Pick highest score
        best = max(candidates, key=lambda x: x[0])
        _log(f"nalezen RAR (score={best[0]}): {best[1]}")
        return best[1]

    # ── Download ──────────────────────────────────────────────────────

    def download(self, url: str) -> bytes:
        """Download the series RAR and extract the correct episode subtitle.

        The URL must contain ?_ep=<N> (encoded by search()). If missing,
        the first found subtitle file is returned.
        """
        # Parse episode info from synthetic URL
        parsed  = urlparse(url)
        params  = parse_qs(parsed.query)
        episode = int(params.get("_ep", [0])[0])
        season  = int(params.get("_season", [1])[0])

        # Reconstruct the real download URL (strip our synthetic params)
        real_params = {k: v for k, v in params.items() if not k.startswith("_")}
        real_url = parsed._replace(
            query=urlencode({k: v[0] for k, v in real_params.items()})
        ).geturl()

        with self._make_client() as c:
            log.info("GenSubs: stahuji archiv ze %s", real_url)
            time.sleep(1)
            r = self._get(c, real_url)
            r.raise_for_status()

            ct = r.headers.get("content-type", "")
            if "text/html" in ct:
                raise ValueError(
                    "GenSubs: server vrátil HTML místo archivu — URL je neplatná nebo archiv neexistuje"
                )

        raw = r.content

        # Extract subtitle for the correct episode from the archive
        return self._extract_episode_subtitle(raw, season, episode)

    def _extract_episode_subtitle(self, raw: bytes, season: int, episode: int) -> bytes:
        """Extract the subtitle for a specific episode from a multi-episode RAR/ZIP."""
        import zipfile
        import io

        ep_str     = str(episode)
        ep_padded  = f"{episode:02d}"
        _SUB_EXTS  = (".srt", ".ass", ".ssa")

        def _ep_score(name: str) -> int:
            """Score how well a filename matches the target episode."""
            n = os.path.basename(name).lower()
            if os.path.splitext(name)[1].lower() not in _SUB_EXTS:
                return -1
            score = 0
            # Exact episode match patterns: E01, ep01, _01_, .01., etc.
            if re.search(rf"e0*{episode}\b", n) or re.search(rf"ep0*{episode}\b", n):
                score += 10
            if re.search(rf"\b0*{episode}\b", n):
                score += 5
            # Season match
            if re.search(rf"s0*{season}\b", n):
                score += 3
            return score

        # ── ZIP ──────────────────────────────────────────────────────
        if raw[:2] == b"PK":
            buf = io.BytesIO(raw)
            try:
                with zipfile.ZipFile(buf) as zf:
                    names = zf.namelist()
                    scored = [(name, _ep_score(name)) for name in names]
                    scored = [(n, s) for n, s in scored if s >= 0]
                    if not scored:
                        raise ValueError("ZIP archiv neobsahuje žádné SRT/ASS soubory")
                    best = max(scored, key=lambda x: x[1])
                    log.info("GenSubs: extrahuju '%s' (score=%d)", best[0], best[1])
                    return zf.read(best[0])
            except zipfile.BadZipFile:
                pass

        # ── RAR ──────────────────────────────────────────────────────
        if raw[:4] == b"Rar!":
            # extract_rar_subtitle extracts only the first matching file;
            # we need to pick the right episode. Use temp file + rarfile/7z.
            return self._extract_rar_episode(raw, season, episode, _ep_score)

        # Plain text — assume it's the right file already
        return raw

    def _extract_rar_episode(
        self,
        raw: bytes,
        season: int,
        episode: int,
        score_fn,
    ) -> bytes:
        """Extract the correct episode subtitle from a RAR using rarfile or 7z."""
        import tempfile
        import subprocess

        _SUB_EXTS = (".srt", ".ass", ".ssa")

        with tempfile.NamedTemporaryFile(suffix=".rar", delete=False) as tmp:
            tmp.write(raw)
            tmp_path = tmp.name

        try:
            # Method 1: rarfile
            try:
                import rarfile
                with rarfile.RarFile(tmp_path) as rf:
                    names  = rf.namelist()
                    scored = [(n, score_fn(n)) for n in names if score_fn(n) >= 0]
                    if scored:
                        best = max(scored, key=lambda x: x[1])
                        log.info("GenSubs: extrahuju '%s' z RAR (score=%d)", best[0], best[1])
                        return rf.read(best[0])
                    # Fallback: first subtitle file
                    for name in names:
                        if os.path.splitext(name)[1].lower() in _SUB_EXTS:
                            return rf.read(name)
            except ImportError:
                pass

            # Method 2: 7z to temp dir, then pick best file
            with tempfile.TemporaryDirectory() as out_dir:
                extracted = False
                for z7 in ["7z", r"C:\Program Files\7-Zip\7z.exe", r"C:\Program Files (x86)\7-Zip\7z.exe"]:
                    try:
                        r = subprocess.run(
                            [z7, "e", tmp_path, f"-o{out_dir}", "-y"],
                            capture_output=True, timeout=60,
                        )
                        if r.returncode == 0:
                            extracted = True
                            break
                    except (FileNotFoundError, subprocess.TimeoutExpired):
                        continue

                if not extracted:
                    raise ValueError(
                        "GenSubs RAR extrakce selhala. "
                        "Nainstaluj rarfile nebo 7-Zip."
                    )

                files = [
                    os.path.join(root, f)
                    for root, _, fns in os.walk(out_dir)
                    for f in fns
                ]
                scored = [(p, score_fn(p)) for p in files if score_fn(p) >= 0]
                if not scored:
                    raise ValueError("GenSubs archiv neobsahuje žádné SRT/ASS soubory")
                best = max(scored, key=lambda x: x[1])
                log.info("GenSubs: extrahuju '%s' (score=%d)", best[0], best[1])
                with open(best[0], "rb") as f:
                    return f.read()

        finally:
            try:
                os.unlink(tmp_path)
            except Exception:
                pass
