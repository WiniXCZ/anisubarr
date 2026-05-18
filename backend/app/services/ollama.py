import httpx
from typing import Optional
from ..config import get_settings

settings = get_settings()


def _base_url() -> str:
    host = settings.ollama_host
    if not host.startswith("http"):
        host = f"http://{host}"
    return host


def _ollama_translate(text: str, context: str = "anime description") -> Optional[str]:
    """Translate text to Czech using local Ollama. Returns None on any failure."""
    prompt = (
        f"Přeložte následující {context} do češtiny. Zachovejte anime terminologii. "
        f"Odpovězte pouze překladem bez dalšího komentáře.\n\n{text}"
    )
    try:
        with httpx.Client(base_url=_base_url(), timeout=120) as c:
            r = c.post("/api/generate", json={
                "model": settings.ollama_model_translate,
                "prompt": prompt,
                "stream": False,
            })
            r.raise_for_status()
            result = r.json().get("response", "").strip()
            return result if result else None
    except Exception:
        return None


def _google_translate(text: str) -> Optional[str]:
    """Fallback translation to Czech via Google Translate unofficial API (no API key)."""
    try:
        import urllib.parse
        encoded = urllib.parse.quote(text)
        url = (
            f"https://translate.googleapis.com/translate_a/single"
            f"?client=gtx&sl=auto&tl=cs&dt=t&q={encoded}"
        )
        with httpx.Client(timeout=30) as c:
            r = c.get(url, headers={"User-Agent": "Mozilla/5.0"})
            r.raise_for_status()
            data = r.json()
            # Response: [[[translated, original, ...], ...], ...]
            # data[0] is a list of segments; each segment[0] is the translated chunk
            segments = data[0]
            translated = "".join(seg[0] for seg in segments if seg and seg[0])
            return translated if translated else None
    except Exception:
        return None


def translate_to_czech(text: str, context: str = "anime description") -> Optional[str]:
    """Translate text to Czech — tries Ollama first, falls back to Google Translate."""
    if not text or not text.strip():
        return text

    # Primary: local Ollama
    result = _ollama_translate(text, context)
    if result:
        return result

    # Fallback: Google Translate (unofficial, no API key)
    return _google_translate(text)


def test_connection() -> bool:
    try:
        with httpx.Client(base_url=_base_url(), timeout=5) as c:
            r = c.get("/api/tags")
            return r.status_code == 200
    except Exception:
        return False


def list_models() -> list[str]:
    try:
        with httpx.Client(base_url=_base_url(), timeout=10) as c:
            r = c.get("/api/tags")
            r.raise_for_status()
            return [m["name"] for m in r.json().get("models", [])]
    except Exception:
        return []
