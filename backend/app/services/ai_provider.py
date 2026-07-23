"""
ai_provider.py — Universal AI translation/generation provider.

Provider priority when ai_translation_provider is not set (auto-detect):
  DeepSeek → OpenRouter → LocalAI → Claude → Ollama

OpenAI-compatible providers (DeepSeek, OpenRouter, LocalAI) share the same
HTTP call path — they differ only in base_url, api_key, and model.
"""
from __future__ import annotations

import logging
import os
from typing import Optional

log = logging.getLogger("anisubarr.ai_provider")

PROVIDER_DEEPSEEK    = "deepseek"
PROVIDER_OPENROUTER  = "openrouter"
PROVIDER_LOCALAI     = "localai"
PROVIDER_OLLAMA      = "ollama"
PROVIDER_CLAUDE      = "claude"

_OPENAI_COMPAT = (PROVIDER_DEEPSEEK, PROVIDER_OPENROUTER, PROVIDER_LOCALAI)

_DEFAULTS: dict[str, dict] = {
    PROVIDER_DEEPSEEK:   {"base_url": "https://api.deepseek.com",     "model": "deepseek-chat"},
    PROVIDER_OPENROUTER: {"base_url": "https://openrouter.ai/api/v1", "model": "anthropic/claude-3-haiku"},
    PROVIDER_LOCALAI:    {"base_url": "http://localhost:8080",         "model": "gpt-4"},
    PROVIDER_OLLAMA:     {"base_url": "http://localhost:11434",        "model": "llama3"},
    PROVIDER_CLAUDE:     {"model": "claude-haiku-4-5"},
}


def _db_get(db, key: str) -> Optional[str]:
    try:
        from ..models.app_settings import AppSetting
        row = db.query(AppSetting).filter(AppSetting.key == key).first()
        if row and row.value:
            return row.value
    except Exception:
        pass
    return os.environ.get(key.upper())


_PROVIDER_CONFIG_KEYS = {
    PROVIDER_DEEPSEEK:   lambda db: _db_get(db, "deepseek_api_key"),
    PROVIDER_OPENROUTER: lambda db: _db_get(db, "openrouter_api_key"),
    PROVIDER_LOCALAI:    lambda db: _db_get(db, "localai_url"),
    PROVIDER_CLAUDE:     lambda db: _db_get(db, "anthropic_api_key"),
    PROVIDER_OLLAMA:     lambda db: _db_get(db, "ollama_host"),
}


def _auto_detect_provider(db) -> str:
    import json
    order_json = _db_get(db, "ai_provider_order")
    if order_json:
        try:
            order = json.loads(order_json)
            for entry in order:
                pid = entry.get("id", "")
                if not entry.get("enabled", True):
                    continue
                check = _PROVIDER_CONFIG_KEYS.get(pid)
                if check and check(db):
                    return pid
            return ""
        except (json.JSONDecodeError, TypeError, AttributeError):
            pass

    # Fallback to hardcoded order when ai_provider_order is not set
    if _db_get(db, "deepseek_api_key"):
        return PROVIDER_DEEPSEEK
    if _db_get(db, "openrouter_api_key"):
        return PROVIDER_OPENROUTER
    if _db_get(db, "localai_url"):
        return PROVIDER_LOCALAI
    if _db_get(db, "anthropic_api_key"):
        return PROVIDER_CLAUDE
    if _db_get(db, "ollama_host"):
        return PROVIDER_OLLAMA
    return ""


def _resolve_config(provider: str, db) -> dict:
    defs = _DEFAULTS.get(provider, {})
    if provider == PROVIDER_DEEPSEEK:
        return {
            "api_key":  _db_get(db, "deepseek_api_key"),
            "model":    _db_get(db, "deepseek_model") or defs["model"],
            "base_url": defs["base_url"],
        }
    if provider == PROVIDER_OPENROUTER:
        return {
            "api_key":  _db_get(db, "openrouter_api_key"),
            "model":    _db_get(db, "openrouter_model") or defs["model"],
            "base_url": defs["base_url"],
        }
    if provider == PROVIDER_LOCALAI:
        url = _db_get(db, "localai_url") or defs["base_url"]
        return {
            "api_key":  _db_get(db, "localai_api_key"),
            "model":    _db_get(db, "localai_model") or defs["model"],
            "base_url": url.rstrip("/"),
        }
    if provider == PROVIDER_OLLAMA:
        host = _db_get(db, "ollama_host") or defs["base_url"]
        if not host.startswith("http"):
            host = "http://" + host
        return {
            "api_key":  None,
            "model":    _db_get(db, "ollama_model") or defs["model"],
            "base_url": host.rstrip("/"),
        }
    if provider == PROVIDER_CLAUDE:
        return {
            "api_key": _db_get(db, "anthropic_api_key"),
            "model":   defs["model"],
        }
    return {}


def get_provider_config(db) -> dict:
    """Return active provider name and its resolved config dict."""
    provider = _db_get(db, "ai_translation_provider") or _auto_detect_provider(db)
    if not provider:
        return {"provider": ""}
    return {"provider": provider, **_resolve_config(provider, db)}


def call_ai(messages: list[dict], db, timeout: int = 60) -> tuple[str, str]:
    """
    Call the configured AI provider with a messages list.

    messages: list of {role, content} dicts (include system message as first entry).
    Returns (response_text, model_identifier_string).
    Raises RuntimeError when no provider is configured.
    Raises provider-specific exceptions (httpx, anthropic) on API errors.
    """
    cfg = get_provider_config(db)
    provider = cfg.get("provider")
    if not provider:
        raise RuntimeError(
            "No AI provider configured. Set ai_translation_provider in Settings."
        )

    log.debug("AI call provider=%s model=%s", provider, cfg.get("model"))

    if provider in _OPENAI_COMPAT:
        return _call_openai_compat(
            messages=messages,
            base_url=cfg["base_url"],
            api_key=cfg.get("api_key"),
            model=cfg["model"],
            timeout=timeout,
            provider=provider,
        )
    if provider == PROVIDER_OLLAMA:
        return _call_ollama(messages, cfg["base_url"], cfg["model"], timeout)
    if provider == PROVIDER_CLAUDE:
        return _call_claude(messages, cfg.get("api_key"), cfg["model"])
    raise RuntimeError(f"Unknown provider: {provider!r}")


# ── Provider implementations ──────────────────────────────────────────────────

def _call_openai_compat(
    messages: list[dict],
    base_url: str,
    api_key: Optional[str],
    model: str,
    timeout: int,
    provider: str = "",
) -> tuple[str, str]:
    import httpx

    headers: dict[str, str] = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    if provider == PROVIDER_OPENROUTER:
        headers.setdefault("HTTP-Referer", "https://anisubarr")
        headers.setdefault("X-Title", "Anisubarr")

    resp = httpx.post(
        f"{base_url}/chat/completions",
        headers=headers,
        json={"model": model, "messages": messages, "temperature": 0.3},
        timeout=timeout,
    )
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"].strip(), f"{provider}/{model}"


def _call_ollama(
    messages: list[dict],
    base_url: str,
    model: str,
    timeout: int,
) -> tuple[str, str]:
    import httpx

    resp = httpx.post(
        f"{base_url}/api/chat",
        json={"model": model, "messages": messages, "stream": False},
        timeout=timeout,
    )
    resp.raise_for_status()
    return resp.json()["message"]["content"].strip(), f"ollama/{model}"


def _call_claude(
    messages: list[dict],
    api_key: Optional[str],
    model: str,
) -> tuple[str, str]:
    import anthropic

    system_parts = [m["content"] for m in messages if m["role"] == "system"]
    chat_msgs    = [m for m in messages if m["role"] != "system"]
    system_text  = "\n".join(system_parts)

    client = anthropic.Anthropic(api_key=api_key)
    kwargs: dict = {"model": model, "max_tokens": 2048, "messages": chat_msgs}
    if system_text:
        kwargs["system"] = system_text
    response = client.messages.create(**kwargs)
    return response.content[0].text.strip(), f"claude/{model}"
