import { useLang } from "../i18n/I18nContext";
import { LANGUAGE_OPTIONS } from "../i18n/translations";
import { T } from "../theme";

/**
 * Small CS/EN toggle for the admin UI language (persisted server-side as
 * the `ui_language` setting — shared across everyone using this install,
 * same as every other Nastavení value, not a per-browser preference).
 */
export default function LangSwitcher({ compact = false }) {
  const { lang, setLang } = useLang();

  if (compact) {
    return (
      <div style={{ display: "flex", gap: 6 }}>
        {LANGUAGE_OPTIONS.map(opt => (
          <button
            key={opt.value}
            onClick={() => setLang(opt.value)}
            style={{
              flex: 1, height: 36, borderRadius: 8,
              border: `1px solid ${lang === opt.value ? T.accent : T.border}`,
              background: lang === opt.value ? T.accentSoft : T.panel2,
              color: lang === opt.value ? T.accent : T.textDim,
              font: '600 12px "Space Grotesk"', cursor: "pointer",
            }}>
            {opt.value.toUpperCase()}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div style={{ display: "inline-flex", borderRadius: 8, border: `1px solid ${T.border}`, overflow: "hidden" }}>
      {LANGUAGE_OPTIONS.map(opt => (
        <button
          key={opt.value}
          onClick={() => setLang(opt.value)}
          title={opt.label}
          style={{
            padding: "6px 9px",
            background: lang === opt.value ? T.accentSoft : "transparent",
            color: lang === opt.value ? T.accent : T.textDim,
            border: "none", cursor: "pointer",
            font: '700 11px JetBrains Mono',
            transition: "background 0.12s, color 0.12s",
          }}>
          {opt.value.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
