"""
Subtitle file helpers — ported from subtitle_bazarr_alfa/utils/subtitle_utils.py
"""
import io
import logging
import os
import re
import sys
import subprocess
import tempfile
import zipfile

log = logging.getLogger("anisubarr.subtitle_utils")


def extract_subtitle_bytes(raw_bytes: bytes, rar_password: str | None = None) -> tuple[bytes, str]:
    """Given raw downloaded bytes, return (subtitle_bytes, extension).

    Handles ZIP archives, password-protected RAR, plain SRT/ASS text.
    Returns extension without leading dot ('srt' or 'ass').
    """
    if raw_bytes[:2] == b"PK":
        buf = io.BytesIO(raw_bytes)
        try:
            with zipfile.ZipFile(buf) as zf:
                for name in zf.namelist():
                    ext_lower = os.path.splitext(name)[1].lower()
                    if ext_lower in (".srt", ".ass", ".ssa"):
                        data = zf.read(name)
                        return data, ext_lower.lstrip(".")
        except zipfile.BadZipFile:
            pass
        raise ValueError("ZIP archiv neobsahuje žádný SRT/ASS soubor")

    if raw_bytes[:4] == b"Rar!":
        return extract_rar_subtitle(raw_bytes, rar_password)

    try:
        text = raw_bytes.decode("utf-8-sig", errors="replace")
    except Exception:
        text = ""

    if "[Script Info]" in text or "Dialogue:" in text:
        return raw_bytes, "ass"
    return raw_bytes, "srt"


def extract_rar_subtitle(raw_bytes: bytes, password: str | None = None) -> tuple[bytes, str]:
    """Extract a subtitle file from a RAR archive (optionally password-protected).

    Tries: 1) rarfile Python library, 2) 7-Zip subprocess (common on Windows).
    Returns (subtitle_bytes, extension) without leading dot.
    Raises ValueError if extraction fails or no SRT/ASS found.
    """
    _SUB_EXTS = (".srt", ".ass", ".ssa")

    # Write to a temp file — both rarfile and 7z need a file path
    with tempfile.NamedTemporaryFile(suffix=".rar", delete=False) as tmp:
        tmp.write(raw_bytes)
        tmp_path = tmp.name

    try:
        # ── Method 1: rarfile library ──────────────────────────────────────
        try:
            import rarfile  # pip install rarfile
            with rarfile.RarFile(tmp_path) as rf:
                if password:
                    rf.setpassword(password.encode())
                for name in rf.namelist():
                    ext = os.path.splitext(name)[1].lower()
                    if ext in _SUB_EXTS:
                        log.debug("RAR: extrahuju '%s' pomocí rarfile", name)
                        return rf.read(name), ext.lstrip(".")
            raise ValueError("RAR archiv neobsahuje žádný SRT/ASS soubor")
        except ImportError:
            log.debug("rarfile není dostupný, zkouším 7z")

        # ── Method 2: 7-Zip subprocess ─────────────────────────────────────
        _7Z_PATHS = [
            "7z",
            r"C:\Program Files\7-Zip\7z.exe",
            r"C:\Program Files (x86)\7-Zip\7z.exe",
        ]
        with tempfile.TemporaryDirectory() as out_dir:
            extracted = False
            for z7 in _7Z_PATHS:
                cmd = [z7, "e", tmp_path, f"-o{out_dir}", "-y"]
                if password:
                    cmd.append(f"-p{password}")
                try:
                    r = subprocess.run(cmd, capture_output=True, timeout=30)
                    if r.returncode == 0:
                        extracted = True
                        break
                    log.debug("7z selhal (rc=%d): %s", r.returncode, r.stderr[:200])
                except FileNotFoundError:
                    continue
                except subprocess.TimeoutExpired:
                    log.warning("7z timeout")
                    break

            if not extracted:
                raise ValueError(
                    "RAR extrakce selhala. Nainstaluj 'rarfile' (pip install rarfile) "
                    "nebo 7-Zip (https://7-zip.org) a přidej ho do PATH."
                )

            for fname in sorted(os.listdir(out_dir)):
                ext = os.path.splitext(fname)[1].lower()
                if ext in _SUB_EXTS:
                    log.debug("RAR: extrahuju '%s' pomocí 7z", fname)
                    with open(os.path.join(out_dir, fname), "rb") as f:
                        return f.read(), ext.lstrip(".")

            raise ValueError("RAR archiv neobsahuje žádný SRT/ASS soubor")
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass


def detect_language_from_name(name: str, context: str = "") -> str:
    """Detect subtitle language from a filename, URL, or surrounding context text.

    Checks (in order):
    1. Language code embedded in the filename with word boundaries:
       e.g.  Show.S01E01.cs.srt  →  "cs"
             Show.S01E01.sk.srt  →  "sk"
    2. Context text keywords (link label, table cell text, etc.)
    3. Returns "cs" as default (Czech is the primary language of this app).

    Supported codes: cs/cz/ces → "cs",  sk/slo/slk → "sk",
                     en/eng → "en",  pl/pol → "pl",  de/ger/deu → "de"
    """
    # Mapping: normalised code → canonical BCP-47-ish code
    _LANG_MAP = {
        "cs": "cs", "cz": "cs", "ces": "cs", "cze": "cs",
        "sk": "sk", "slo": "sk", "slk": "sk",
        "en": "en", "eng": "en",
        "pl": "pl", "pol": "pl",
        "de": "de", "ger": "de", "deu": "de",
        "hu": "hu", "hun": "hu",
        "ro": "ro", "ron": "ro",
        "fr": "fr", "fra": "fr",
        "es": "es", "spa": "es",
        "pt": "pt", "por": "pt",
        "ru": "ru", "rus": "ru",
        "jp": "ja", "ja": "ja", "jpn": "ja",
    }

    # ── 1. Known English release groups (highest priority) ────────────────────
    # These groups exclusively produce English subtitles — checked before any
    # filename-based heuristic so a file named "show.cz.srt" from HorribleSubs
    # is still tagged "en".
    _EN_GROUPS = {
        "horriblesubs", "subsplease", "erai-raws", "judas", "commie",
        "fff", "gjm", "nysubs", "damedesuyo", "reaktor",
        "underwater", "beatrice-raws", "erairaw", "sallysubs", "tenshi",
        "eclipse", "chihiro", "gg", "doki", "frostii", "sage",
        "hiryuu", "asenshi", "ntr", "coalgirls", "thora",
    }
    combined_lower = f"{name} {context}".lower()
    for group in _EN_GROUPS:
        if group in combined_lower:
            return "en"

    # ── 2. Filename / URL ──────────────────────────────────────────────────────
    # Strip query string if it's a URL
    fname = re.sub(r"\?.*$", "", name)
    # Get just the basename (handles both / and \)
    fname = re.split(r"[/\\]", fname)[-1].lower()
    for raw, canonical in _LANG_MAP.items():
        # Pattern: surrounded by non-alphanumeric (or start/end)
        pat = rf"(?:^|[._\-\s\[({{(])({re.escape(raw)})(?:[._\-\s\])}}),]|$)"
        if re.search(pat, fname, re.IGNORECASE):
            return canonical

    # ── 3. Context text keywords ───────────────────────────────────────────────
    ctx = context.lower()
    _KEYWORDS: list[tuple[str, str]] = [
        # Czech
        ("česky",       "cs"), ("cesky",    "cs"), ("czech",  "cs"),
        (" cz ",        "cs"), ("[cz]",      "cs"), ("(cz)",   "cs"),
        # Slovak
        ("slovensky",   "sk"), ("slovenska", "sk"), ("slovak", "sk"),
        (" sk ",        "sk"), ("[sk]",       "sk"), ("(sk)",   "sk"),
        # English
        ("english",     "en"), ("anglicky",   "en"),
        (" en ",        "en"), ("[en]",        "en"), ("(en)",  "en"),
        # Polish
        ("polsky",      "pl"), ("polish",      "pl"),
        # German
        ("nemecky",     "de"), ("německy",     "de"), ("german", "de"),
        # Japanese
        ("japonsky",    "ja"), ("japanese",    "ja"),
    ]
    for keyword, lang in _KEYWORDS:
        if keyword in ctx:
            return lang

    # ── 4. Default ─────────────────────────────────────────────────────────────
    return "cs"


def smb_authenticate(smb_host: str, smb_user: str, smb_pass: str,
                      share: str = "IPC$") -> tuple[bool, str]:
    """Authenticate to a Windows SMB share using 'net use'. Windows only.

    Before connecting, disconnects ALL existing net use mappings for this host
    to prevent Windows error 1219 (multiple connections with different usernames).
    """
    if sys.platform != "win32":
        return True, "not Windows – skipped"
    if not smb_user:
        return False, "SMB uživatelské jméno není nastaveno"

    host = smb_host.strip("\\").strip("/")
    unc  = f"\\\\{host}\\{share}"

    # Disconnect ALL existing net use entries for this server to avoid error 1219.
    # Windows doesn't allow two connections to the same host under different usernames.
    try:
        list_result = subprocess.run(
            ["net", "use"],
            capture_output=True, text=True, encoding="cp852", timeout=5,
        )
        for line in list_result.stdout.splitlines():
            m = re.search(r"(\\\\[^\s]+)", line)
            if m:
                existing_unc = m.group(1).rstrip("\\")
                existing_host = existing_unc.lstrip("\\").split("\\")[0].lower()
                if existing_host == host.lower():
                    subprocess.run(
                        ["net", "use", existing_unc, "/delete", "/yes"],
                        capture_output=True, text=True, timeout=5,
                    )
    except Exception:
        pass  # best-effort cleanup

    cmd = ["net", "use", unc]
    if smb_pass:
        cmd.append(smb_pass)
    cmd += [f"/user:{smb_user}"]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
        if result.returncode == 0:
            return True, f"SMB auth OK ({unc})"
        err = (result.stdout + result.stderr).strip()
        return False, f"net use selhal: {err[:200]}"
    except subprocess.TimeoutExpired:
        return False, "net use timeout"
    except FileNotFoundError:
        return False, "net use není dostupný"
