import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { T } from "../theme";

// ── api calls ────────────────────────────────────────────────────────────────
const api = axios.create({ baseURL: "/api" });
api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem("token");
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

const fetchSummary  = () => api.get("/dashboard/summary").then(r => r.data);
const fetchUpcoming = () => api.get("/dashboard/upcoming?days=7").then(r => r.data);

// ── tiny helpers ──────────────────────────────────────────────────────────────
const Dot = ({ ok }) => (
  <span style={{
    display: "inline-block", width: 8, height: 8, borderRadius: "50%",
    background: ok ? T.statusDone : T.statusEnded,
    boxShadow: ok ? `0 0 6px ${T.statusDone}88` : `0 0 6px ${T.statusEnded}88`,
    flexShrink: 0,
    animation: ok ? "none" : "dot-offline-pulse 1.4s ease-in-out infinite",
  }} />
);

const CsBadge = ({ pct }) => {
  if (pct == null) return null;
  const color = pct >= 90 ? T.statusDone : pct >= 50 ? T.statusUpcoming : T.statusEnded;
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, fontFamily: "JetBrains Mono, monospace",
      background: `${color}22`, color, border: `1px solid ${color}44`,
      borderRadius: 5, padding: "1px 6px", flexShrink: 0,
    }}>CS {pct}%</span>
  );
};

function PlaceholderPoster({ size = 80 }) {
  return (
    <div style={{
      width: size, height: Math.round(size * 1.4), flexShrink: 0,
      background: T.panel2, borderRadius: 8,
      display: "flex", alignItems: "center", justifyContent: "center",
      color: T.textMute, border: `1px solid ${T.border}`,
    }}>
      <svg width={size * 0.35} height={size * 0.35} viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="4" width="20" height="14" rx="2"/>
        <path d="m10 8 5 4-5 4V8z"/>
      </svg>
    </div>
  );
}

function formatDate(str) {
  if (!str) return "—";
  try {
    return new Date(str).toLocaleDateString("cs-CZ", { day: "numeric", month: "short" });
  } catch { return str; }
}

// ── stat box ─────────────────────────────────────────────────────────────────
function StatBox({ label, value, accent }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? T.panel2 : T.panel,
        border: `1px solid ${hovered ? (accent || T.accent) + "44" : T.border}`,
        borderRadius: 12,
        padding: "18px 22px", flex: 1, minWidth: 120,
        display: "flex", flexDirection: "column", gap: 4,
        transition: "background 0.15s, border-color 0.15s",
        cursor: "default",
      }}>
      <div style={{ font: `700 28px "Space Grotesk"`, color: accent || T.accent }}>{value ?? "—"}</div>
      <div style={{ font: `500 12px "Space Grotesk"`, color: T.textDim }}>{label}</div>
    </div>
  );
}

// ── hero ─────────────────────────────────────────────────────────────────────
function HeroCard({ hero }) {
  if (!hero) {
    return (
      <div style={{
        background: T.panel, border: `1px solid ${T.border}`, borderRadius: 14,
        padding: 28, color: T.textMute, font: `500 14px "Space Grotesk"`,
        textAlign: "center",
      }}>
        Žádná propagovaná série
      </div>
    );
  }

  return (
    <div style={{
      background: `linear-gradient(135deg, ${T.panel} 0%, ${T.panel2} 100%)`,
      border: `1px solid ${T.borderStrong}`,
      borderRadius: 14, overflow: "hidden",
      display: "flex", gap: 0,
      position: "relative",
    }}>
      {/* Poster */}
      <div style={{ flexShrink: 0, width: 140, background: T.sunken }}>
        {hero.poster_url ? (
          <img
            src={hero.poster_url}
            alt={hero.title}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        ) : (
          <div style={{
            width: "100%", height: "100%", minHeight: 200,
            background: `linear-gradient(160deg, ${T.accentSoft} 0%, ${T.panel2} 60%, ${T.accent}22 100%)`,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: T.accent,
          }}>
            <svg width={48} height={48} viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="4" width="20" height="14" rx="2"/>
              <path d="m10 8 5 4-5 4V8z"/>
            </svg>
          </div>
        )}
      </div>

      {/* Content */}
      <div style={{ padding: "22px 24px", flex: 1, display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{
            font: `700 11px "Space Grotesk"`, textTransform: "uppercase", letterSpacing: "0.08em",
            color: T.accent, background: T.accentSoft, border: `1px solid ${T.accent}33`,
            borderRadius: 5, padding: "2px 7px",
          }}>Propagováno</span>
          <CsBadge pct={hero.cs_pct} />
          {hero.episode_count > 0 && (
            <span style={{ fontSize: 11, color: T.textMute, fontFamily: "JetBrains Mono, monospace" }}>
              {hero.episode_count} epizod
            </span>
          )}
        </div>

        <div style={{ font: `700 22px "Space Grotesk"`, color: T.text, lineHeight: 1.2 }}>
          {hero.title}
        </div>
        {hero.title_english && hero.title_english !== hero.title && (
          <div style={{ font: `500 13px "Space Grotesk"`, color: T.textDim }}>
            {hero.title_english}
          </div>
        )}

        {hero.overview_cs && (
          <p style={{
            margin: 0, font: `400 13px "Space Grotesk"`, color: T.textDim,
            lineHeight: 1.6, display: "-webkit-box", WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical", overflow: "hidden",
          }}>
            {hero.overview_cs}
          </p>
        )}

        <div style={{ marginTop: "auto", paddingTop: 8 }}>
          <Link
            to={`/series/${hero.id}`}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "8px 18px", borderRadius: 8,
              background: T.accentSoft, color: T.accent,
              border: `1px solid ${T.accent}44`,
              font: `600 13px "Space Grotesk"`, textDecoration: "none",
              transition: "background 0.12s",
            }}
          >
            Zobrazit
            <svg width={13} height={13} viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </Link>
        </div>
      </div>
    </div>
  );
}

// ── upcoming panel ────────────────────────────────────────────────────────────
function UpcomingPanel({ data, isLoading }) {
  return (
    <div style={{
      background: T.panel, border: `1px solid ${T.border}`, borderRadius: 12,
      display: "flex", flexDirection: "column", overflow: "hidden",
    }}>
      <div style={{
        padding: "14px 16px", borderBottom: `1px solid ${T.border}`,
        font: `600 13px "Space Grotesk"`, color: T.text,
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none"
          stroke={T.accent2} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="16" rx="2"/>
          <line x1="3" y1="10" x2="21" y2="10"/>
          <circle cx="8" cy="15" r="1"/><circle cx="12" cy="15" r="1"/><circle cx="16" cy="15" r="1"/>
        </svg>
        Nadcházející (7 dní)
      </div>
      <div style={{ overflowY: "auto", flex: 1 }}>
        {isLoading ? (
          <div style={{ padding: 20, color: T.textMute, fontSize: 13 }}>Načítám…</div>
        ) : !data?.length ? (
          <div style={{ padding: 20, color: T.textMute, fontSize: 13 }}>Žádné epizody tento týden</div>
        ) : (
          data.map((ep, i) => (
            <Link
              key={i}
              to={`/series/${ep.series_id_local}`}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "9px 16px",
                borderBottom: i < data.length - 1 ? `1px solid ${T.border}` : "none",
                textDecoration: "none", color: T.text,
                background: "transparent",
              }}
            >
              <div style={{
                minWidth: 38, textAlign: "center",
                font: `600 11px "JetBrains Mono", monospace`,
                color: T.accent3, lineHeight: 1.3,
              }}>
                {formatDate(ep.air_date)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: T.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {ep.series_title}
                </div>
                <div style={{ fontSize: 11, color: T.textMute, fontFamily: "JetBrains Mono, monospace" }}>
                  S{String(ep.season).padStart(2, "0")}E{String(ep.episode).padStart(2, "0")}
                </div>
              </div>
              {ep.has_file && (
                <span style={{ fontSize: 10, color: T.statusDone, fontWeight: 700 }}>✓</span>
              )}
            </Link>
          ))
        )}
      </div>
    </div>
  );
}

// ── recently added panel ──────────────────────────────────────────────────────
function RecentPanel({ items }) {
  return (
    <div style={{
      background: T.panel, border: `1px solid ${T.border}`, borderRadius: 12,
      display: "flex", flexDirection: "column", overflow: "hidden",
    }}>
      <div style={{
        padding: "14px 16px", borderBottom: `1px solid ${T.border}`,
        font: `600 13px "Space Grotesk"`, color: T.text,
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none"
          stroke={T.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <polyline points="12 6 12 12 16 14"/>
        </svg>
        Naposledy přidáno
      </div>
      <div style={{ overflowY: "auto", flex: 1 }}>
        {!items?.length ? (
          <div style={{ padding: 20, color: T.textMute, fontSize: 13 }}>Žádné série</div>
        ) : (
          items.map((s, i) => (
            <Link
              key={s.id}
              to={`/series/${s.id}`}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "10px 16px",
                borderBottom: i < items.length - 1 ? `1px solid ${T.border}` : "none",
                textDecoration: "none", color: T.text,
              }}
            >
              {s.poster_url ? (
                <img src={s.poster_url} alt={s.title}
                  style={{ width: 32, height: 45, objectFit: "cover", borderRadius: 4, flexShrink: 0 }} />
              ) : (
                <PlaceholderPoster size={32} />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: T.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {s.title}
                </div>
                {s.title_english && s.title_english !== s.title && (
                  <div style={{ fontSize: 11, color: T.textMute, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {s.title_english}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
                {s.promoted && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, color: T.accent,
                    background: T.accentSoft, borderRadius: 4, padding: "1px 5px",
                  }}>P</span>
                )}
                <span style={{ fontSize: 11, color: T.textMute }}>{formatDate(s.added_at)}</span>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}

// ── pending Seerr requests panel ────────────────────────────────────────────────
function PendingRequestsPanel({ items }) {
  const statusColor = (status) => {
    switch (status) {
      case "Dostupné": return T.statusDone;
      case "Schváleno":
      case "Zpracovává se": return T.statusUpcoming;
      case "Odmítnuto": return T.statusEnded;
      default: return T.textMute;
    }
  };

  return (
    <div style={{
      background: T.panel, border: `1px solid ${T.border}`, borderRadius: 12,
      display: "flex", flexDirection: "column", overflow: "hidden",
    }}>
      <div style={{
        padding: "14px 16px", borderBottom: `1px solid ${T.border}`,
        font: `600 13px "Space Grotesk"`, color: T.text,
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none"
          stroke={T.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
        Žádosti (Seerr)
      </div>
      <div style={{ overflowY: "auto", flex: 1 }}>
        {!items?.length ? (
          <div style={{ padding: 20, color: T.textMute, fontSize: 13 }}>Žádné žádosti</div>
        ) : (
          items.map((r, i) => (
            <div
              key={i}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "9px 16px",
                borderBottom: i < items.length - 1 ? `1px solid ${T.border}` : "none",
              }}
            >
              {r.poster_url ? (
                <img src={r.poster_url} alt={r.title}
                  style={{ width: 32, height: 45, objectFit: "cover", borderRadius: 4, flexShrink: 0 }} />
              ) : (
                <PlaceholderPoster size={32} />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: T.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {r.title}
                </div>
                <div style={{ fontSize: 11, color: T.textMute, fontFamily: "JetBrains Mono, monospace" }}>
                  {formatDate(r.requested_at)}
                </div>
              </div>
              <span style={{
                fontSize: 10, fontWeight: 700, flexShrink: 0,
                color: statusColor(r.status),
                background: `${statusColor(r.status)}22`,
                border: `1px solid ${statusColor(r.status)}44`,
                borderRadius: 5, padding: "2px 6px",
              }}>{r.status}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── service health panel ──────────────────────────────────────────────────────
function ServicePanel({ health }) {
  const services = [
    { key: "sonarr", label: "Sonarr" },
    { key: "emby",   label: "Emby / Jellyfin" },
    { key: "seerr",  label: "Seerr" },
  ];

  return (
    <div style={{
      background: T.panel, border: `1px solid ${T.border}`, borderRadius: 12,
      display: "flex", flexDirection: "column", overflow: "hidden",
    }}>
      <div style={{
        padding: "14px 16px", borderBottom: `1px solid ${T.border}`,
        font: `600 13px "Space Grotesk"`, color: T.text,
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none"
          stroke={T.accent3} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
        </svg>
        Stav služeb
      </div>
      <div style={{ padding: "8px 0", flex: 1 }}>
        {services.map(({ key, label }) => {
          const svc = health?.[key];
          const ok = svc?.ok;
          const url = svc?.url || "";
          return (
            <div key={key} style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "10px 16px",
            }}>
              <Dot ok={ok} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{label}</div>
                {url && (
                  <div style={{
                    fontSize: 11, color: T.textMute,
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                    maxWidth: 200,
                  }}>{url}</div>
                )}
              </div>
              <span style={{
                fontSize: 11, fontWeight: 700,
                color: ok ? T.statusDone : (svc == null ? T.textMute : T.statusEnded),
              }}>
                {svc == null ? "—" : ok ? "Online" : "Offline"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── main page ─────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { data: summary, isLoading: loadingSum } = useQuery({
    queryKey: ["dashboard-summary"],
    queryFn: fetchSummary,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const { data: upcoming, isLoading: loadingUp } = useQuery({
    queryKey: ["dashboard-upcoming"],
    queryFn: fetchUpcoming,
    staleTime: 60_000,
  });

  return (
    <div style={{
      flex: 1, overflowY: "auto", padding: "20px 22px 32px",
      display: "flex", flexDirection: "column", gap: 18,
      maxWidth: 1400, margin: "0 auto", width: "100%",
    }}>
      <style>{`@keyframes dot-offline-pulse { 0%,100%{opacity:1} 50%{opacity:0.35} }`}</style>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <h1 style={{ margin: 0, font: `700 22px "Space Grotesk"`, color: T.text }}>Dashboard</h1>
        {loadingSum && (
          <span style={{ fontSize: 12, color: T.textMute }}>Načítám…</span>
        )}
      </div>

      {/* Hero */}
      <div className="slide-up">
        <HeroCard hero={summary?.hero} />
      </div>

      {/* 3-column grid */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
        gap: 14,
      }}>
        <UpcomingPanel data={upcoming} isLoading={loadingUp} />
        <RecentPanel items={summary?.recently_added} />
        <PendingRequestsPanel items={summary?.pending_requests} />
        <ServicePanel health={summary?.service_health} />
      </div>

      {/* Stats row */}
      <div className="slide-up" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <StatBox label="Celkem sérií" value={summary?.stats?.total_series} accent={T.accent} />
        <StatBox label="Publikované" value={summary?.stats?.promoted} accent={T.statusDone} />
        <StatBox label="Chybí CS titulky" value={summary?.stats?.missing_cs} accent={T.statusEnded} />
      </div>
    </div>
  );
}
