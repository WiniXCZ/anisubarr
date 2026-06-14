import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { T } from "../theme";

const SEARCH_ICON = (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
);

const STAR_ICON = (
  <svg width={12} height={12} viewBox="0 0 24 24" fill={T.accent3} stroke="none">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
  </svg>
);

export default function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef(null);
  const debounceRef = useRef(null);
  const navigate = useNavigate();

  // Keyboard shortcut: Ctrl+K / Cmd+K
  useEffect(() => {
    function onKeyDown(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setOpen(v => !v);
      }
      if (e.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Focus input on open
  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setActiveIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Debounced fetch
  const fetchResults = useCallback((q) => {
    clearTimeout(debounceRef.current);
    if (q.trim().length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const token = localStorage.getItem("token");
        const res = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}&limit=10`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error("search failed");
        const data = await res.json();
        setResults(data);
        setActiveIdx(0);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
  }, []);

  function handleChange(e) {
    const q = e.target.value;
    setQuery(q);
    fetchResults(q);
  }

  // Arrow key navigation + Enter
  function handleKeyDown(e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results[activeIdx]) {
      selectItem(results[activeIdx]);
    }
  }

  function selectItem(item) {
    setOpen(false);
    navigate(`/series/${item.id}`);
  }

  if (!open) return null;

  const showEmpty = !loading && query.trim().length >= 2 && results.length === 0;

  return (
    <div
      onClick={() => setOpen(false)}
      className="animate-fade-backdrop"
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(0,0,0,0.65)",
        backdropFilter: "blur(4px)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        paddingTop: "12vh",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: "min(640px, 92vw)",
          background: T.panel,
          border: `1px solid ${T.borderStrong}`,
          borderRadius: 14,
          overflow: "hidden",
          boxShadow: "0 24px 80px rgba(0,0,0,0.7)",
        }}
      >
        {/* Input row */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "12px 16px",
          borderBottom: results.length > 0 || showEmpty || loading
            ? `1px solid ${T.border}`
            : "none",
        }}>
          <span style={{ color: T.textDim, flexShrink: 0 }}>{SEARCH_ICON}</span>
          <input
            ref={inputRef}
            value={query}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder="Hledat anime… (Ctrl+K)"
            style={{
              flex: 1, background: "transparent", border: "none", outline: "none",
              font: '500 15px "Space Grotesk", sans-serif',
              color: T.text,
              caretColor: T.accent,
            }}
          />
          {loading && (
            <span style={{
              width: 14, height: 14, border: `2px solid ${T.accentSoft}`,
              borderTopColor: T.accent, borderRadius: "50%",
              animation: "gs-spin 0.7s linear infinite", flexShrink: 0,
            }} />
          )}
          <kbd style={{
            font: "500 11px JetBrains Mono, monospace",
            color: T.textMute,
            background: T.panel2,
            border: `1px solid ${T.border}`,
            borderRadius: 5, padding: "2px 6px", flexShrink: 0,
          }}>Esc</kbd>
        </div>

        {/* Results */}
        {results.length > 0 && (
          <ul style={{ margin: 0, padding: "6px 0", listStyle: "none", maxHeight: 400, overflowY: "auto" }}>
            {results.map((item, idx) => (
              <li
                key={item.id}
                onClick={() => selectItem(item)}
                onMouseEnter={() => setActiveIdx(idx)}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "8px 16px", cursor: "pointer",
                  background: idx === activeIdx ? T.accentSoft : "transparent",
                  transition: "background 0.1s",
                }}
              >
                {/* Poster thumbnail */}
                {item.poster_url ? (
                  <img
                    src={item.poster_url}
                    alt=""
                    style={{
                      width: 32, height: 46, objectFit: "cover",
                      borderRadius: 4, flexShrink: 0,
                      border: `1px solid ${T.border}`,
                    }}
                  />
                ) : (
                  <div style={{
                    width: 32, height: 46, borderRadius: 4, flexShrink: 0,
                    background: T.panel2, border: `1px solid ${T.border}`,
                  }} />
                )}

                {/* Title block */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    font: '600 14px "Space Grotesk", sans-serif',
                    color: T.text,
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  }}>
                    {item.title}
                  </div>
                  {item.title_english && item.title_english !== item.title && (
                    <div style={{
                      font: "400 12px sans-serif",
                      color: T.textDim,
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                      marginTop: 2,
                    }}>
                      {item.title_english}
                    </div>
                  )}
                </div>

                {/* Badges */}
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                  {item.is_promoted && (
                    <span title="Propagováno" style={{ display: "flex", alignItems: "center" }}>
                      {STAR_ICON}
                    </span>
                  )}
                  <span style={{
                    font: "600 11px JetBrains Mono, monospace",
                    color: item.cs_subtitle_pct >= 80 ? T.statusDone
                         : item.cs_subtitle_pct >= 40 ? T.accent3
                         : T.textMute,
                    background: T.panel2,
                    border: `1px solid ${T.border}`,
                    borderRadius: 6, padding: "2px 7px",
                  }}>
                    CS {item.cs_subtitle_pct}%
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Empty state */}
        {showEmpty && (
          <div style={{
            padding: "28px 16px", textAlign: "center",
            font: '500 13px "Space Grotesk", sans-serif',
            color: T.textMute,
            display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
          }}>
            <span style={{ fontSize: 24 }}>🔍</span>
            <span>Nic nenalezeno pro <strong style={{ color: T.textDim }}>„{query}"</strong></span>
          </div>
        )}
      </div>

      {/* Spinner keyframes */}
      <style>{`@keyframes gs-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
