import { createContext, useContext, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getAppSettings, updateSettings } from "../api/client";
import { TRANSLATIONS } from "./translations";

const I18nContext = createContext(null);

const LOCAL_LANG_KEY = "anisubarr_prelogin_lang";

function _browserLangGuess() {
  // Best-effort guess from the browser for the pre-login screen, when there's
  // no persisted ui_language (not authenticated) and no local override either.
  try {
    const raw = (navigator.language || "cs").toLowerCase();
    if (raw.startsWith("sk")) return "sk";
    if (raw.startsWith("cs")) return "cs";
    if (raw.startsWith("en")) return "en";
  } catch { /* no navigator */ }
  return "cs";
}

function _readLocalOverride() {
  try {
    const v = localStorage.getItem(LOCAL_LANG_KEY);
    return TRANSLATIONS[v] ? v : null;
  } catch {
    return null;
  }
}

export function I18nProvider({ children }) {
  const qc = useQueryClient();
  const [localOverride, setLocalOverride] = useState(_readLocalOverride());

  // Shares the ['app-settings'] query cache with every page that already
  // fetches it — this doesn't add an extra network round-trip in practice.
  // Before login this 401s (no token yet) — that's expected, not a bug.
  const { data: cfg, isError } = useQuery({
    queryKey: ["app-settings"],
    queryFn: () => getAppSettings().then(r => r.data ?? r),
    retry: false,
  });

  // Once logged in, the DB-persisted ui_language (shared across everyone
  // using this install, like every other Nastavení value) is authoritative.
  // Before login there's no way to read/write that setting (auth required),
  // so we fall back to a same-browser localStorage override, then a guess
  // from navigator.language, so the Login screen isn't always forced to cs.
  const authenticated = !!cfg && !isError;
  const lang = authenticated && TRANSLATIONS[cfg.ui_language]
    ? cfg.ui_language
    : (localOverride || _browserLangGuess());

  const value = useMemo(() => {
    const dict = TRANSLATIONS[lang] || TRANSLATIONS.cs;
    const t = (key) => dict[key] ?? TRANSLATIONS.cs[key] ?? key;
    const setLang = async (newLang) => {
      if (authenticated) {
        await updateSettings({ ui_language: newLang });
        qc.invalidateQueries(["app-settings"]);
      } else {
        try { localStorage.setItem(LOCAL_LANG_KEY, newLang); } catch { /* ignore */ }
        setLocalOverride(newLang);
      }
    };
    return { lang, t, setLang, authenticated };
  }, [lang, qc, authenticated]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useT musí být použit uvnitř I18nProvider");
  return ctx.t;
}

export function useLang() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useLang musí být použit uvnitř I18nProvider");
  return ctx;
}
