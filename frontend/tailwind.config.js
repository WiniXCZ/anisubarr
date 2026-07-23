/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Anisubarr design system — dark theme tokens
        bg:           "#0e1220",
        panel:        "#161a2a",
        panel2:       "#1d2237",
        sunken:       "#0a0d18",
        border:       "rgba(255,255,255,0.06)",
        "border-strong": "rgba(255,255,255,0.12)",
        text:         "#e8e9f2",
        "text-dim":   "rgba(232,233,242,0.62)",
        "text-mute":  "rgba(232,233,242,0.38)",
        accent:       "#a78bfa",   // violet
        "accent2":    "#22d3ee",   // cyan
        "accent3":    "#fbbf24",   // amber (AI)
        "accent-soft":"rgba(167,139,250,0.16)",
        // Status
        "status-airing":   "#3b82f6",
        "status-done":     "#22c55e",
        "status-upcoming": "#f59e0b",
        "status-ended":    "#ef4444",
        // Legacy aliases for components that still use old names
        surface:      "#161a2a",
        muted:        "rgba(232,233,242,0.38)",
      },
      fontFamily: {
        sans:  ['"Space Grotesk"', "ui-sans-serif", "system-ui", "sans-serif"],
        mono:  ['"JetBrains Mono"', "ui-monospace", "monospace"],
        jp:    ['"Noto Sans JP"', "sans-serif"],
      },
      keyframes: {
        "toast-in": {
          "0%":   { opacity: "0", transform: "translateY(12px) scale(0.95)" },
          "100%": { opacity: "1", transform: "translateY(0)   scale(1)" },
        },
      },
      animation: {
        "toast-in": "toast-in 0.2s ease-out both",
      },
    },
  },
  plugins: [],
};
