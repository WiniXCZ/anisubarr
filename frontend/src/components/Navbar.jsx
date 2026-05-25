import { useEffect, useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { syncAll, getJobs } from "../api/client";
import JobsPanel from "./JobsPanel";
import { useIsMobile } from "../hooks/useIsMobile";

const NavIcon = ({ d, size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {d}
  </svg>
);

const ICONS = {
  library: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
  sched:   <><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></>,
  cal:     <><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><circle cx="8" cy="15" r="1"/><circle cx="12" cy="15" r="1"/><circle cx="16" cy="15" r="1"/></>,
  req:     <><path d="M22 2 L11 13"/><path d="M22 2 L15 22 L11 13 L2 9 Z"/></>,
  files:   <><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></>,
  sett:    <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06A2 2 0 1 1 4.4 16.96l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06A2 2 0 1 1 7.04 4.37l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></>,
  subs:    <><rect x="2" y="4" width="20" height="16" rx="2"/><line x1="6" y1="12" x2="10" y2="12"/><line x1="12" y1="12" x2="18" y2="12"/><line x1="6" y1="16" x2="14" y2="16"/></>,
  sync:    <><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/><path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14"/></>,
  pulse:   <><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></>,
  out:     <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></>,
  menu:    <><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></>,
  close:   <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>,
};

const NAV_ITEMS = [
  { to: "/",          icon: ICONS.library, label: "Knihovna" },
  { to: "/schedule",  icon: ICONS.sched,   label: "Harmonogram" },
  { to: "/calendar",  icon: ICONS.cal,     label: "Kalendář" },
  { to: "/requests",  icon: ICONS.req,     label: "Žádosti" },
  { to: "/files",     icon: ICONS.files,   label: "Soubory" },
  { to: "/settings",  icon: ICONS.sett,    label: "Nastavení" },
];

const LOGO = (size = 22) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#a78bfa"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="4" width="20" height="14" rx="2"/>
    <line x1="8" y1="21" x2="16" y2="21"/>
    <line x1="12" y1="18" x2="12" y2="21"/>
  </svg>
);

export default function Navbar() {
  const navigate  = useNavigate();
  const location  = useLocation();
  const isMobile  = useIsMobile();
  const [jobsOpen, setJobsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const syncMutation = useMutation({ mutationFn: syncAll });
  const { data: jobsData } = useQuery({
    queryKey: ["jobs"],
    queryFn:  () => getJobs().then(r => r.data),
    refetchInterval: 3000,
    staleTime: 2000,
  });
  const runningCount = jobsData?.running_count ?? 0;

  useEffect(() => { setMenuOpen(false); }, [location.pathname]);

  function logout() {
    localStorage.removeItem("token");
    navigate("/login");
  }

  const isActive = (to) =>
    to === "/" ? location.pathname === "/" : location.pathname.startsWith(to);

  // ── MOBILE ────────────────────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <>
        <header style={{
          height: 52, display: "flex", alignItems: "center",
          padding: "0 14px", gap: 10,
          background: "#161a2a",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          flexShrink: 0, position: "sticky", top: 0, zIndex: 50,
        }}>
          <Link to="/" style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
            {LOGO(20)}
            <span style={{ font: '700 16px "Space Grotesk"', color: "#a78bfa" }}>Anisubarr</span>
          </Link>

          {runningCount > 0 && (
            <span style={{
              font: "700 10px JetBrains Mono", background: "#a78bfa",
              color: "#fff", padding: "2px 7px", borderRadius: 99, flexShrink: 0,
            }}>{runningCount}</span>
          )}

          <button
            onClick={() => setMenuOpen(v => !v)}
            style={{
              width: 36, height: 36, flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: menuOpen ? "rgba(167,139,250,0.16)" : "transparent",
              border: "1px solid rgba(255,255,255,0.10)", borderRadius: 8,
              color: menuOpen ? "#a78bfa" : "rgba(232,233,242,0.8)", cursor: "pointer",
            }}
          >
            <NavIcon d={menuOpen ? ICONS.close : ICONS.menu} size={18} />
          </button>
        </header>

        {/* Full-screen slide-down menu */}
        {menuOpen && (
          <div style={{
            position: "fixed", top: 52, left: 0, right: 0, bottom: 0,
            background: "#161a2a", zIndex: 49, overflowY: "auto",
            borderTop: "1px solid rgba(255,255,255,0.06)",
            display: "flex", flexDirection: "column",
          }}>
            {[...NAV_ITEMS, { to: "/subtitles", icon: ICONS.subs, label: "Titulky" }].map(({ to, icon, label }) => {
              const active = isActive(to);
              return (
                <Link key={to} to={to} style={{
                  display: "flex", alignItems: "center", gap: 16,
                  padding: "0 20px", height: 52, minHeight: 52,
                  color: active ? "#a78bfa" : "rgba(232,233,242,0.78)",
                  background: active ? "rgba(167,139,250,0.10)" : "transparent",
                  borderLeft: `3px solid ${active ? "#a78bfa" : "transparent"}`,
                  borderBottom: "1px solid rgba(255,255,255,0.04)",
                  font: '600 15px "Space Grotesk"',
                  textDecoration: "none",
                }}>
                  <NavIcon d={icon} size={19} />
                  {label}
                </Link>
              );
            })}

            {/* Bottom utility row */}
            <div style={{
              marginTop: "auto", padding: "14px 16px",
              borderTop: "1px solid rgba(255,255,255,0.08)",
              display: "flex", gap: 8,
            }}>
              <button
                onClick={() => syncMutation.mutate()}
                disabled={syncMutation.isPending}
                style={{
                  flex: 1, height: 44,
                  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
                  borderRadius: 8, background: "rgba(167,139,250,0.16)",
                  color: "#a78bfa", border: "1px solid rgba(167,139,250,0.2)",
                  font: '600 13px "Space Grotesk"', cursor: "pointer",
                  opacity: syncMutation.isPending ? 0.6 : 1,
                }}>
                <NavIcon d={ICONS.sync} size={14} />
                {syncMutation.isPending ? "Sync…" : "Sync"}
              </button>
              <button
                onClick={() => { setMenuOpen(false); setJobsOpen(v => !v); }}
                style={{
                  height: 44, padding: "0 14px",
                  display: "inline-flex", alignItems: "center", gap: 8,
                  borderRadius: 8, background: "rgba(255,255,255,0.06)",
                  color: "rgba(232,233,242,0.75)", border: "1px solid rgba(255,255,255,0.08)",
                  font: '600 13px "Space Grotesk"', cursor: "pointer",
                }}>
                <NavIcon d={ICONS.pulse} size={14} />
                Úlohy
              </button>
              <button
                onClick={logout}
                style={{
                  height: 44, padding: "0 14px",
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  borderRadius: 8, background: "rgba(255,255,255,0.06)",
                  color: "rgba(232,233,242,0.75)", border: "1px solid rgba(255,255,255,0.08)",
                  cursor: "pointer",
                }}>
                <NavIcon d={ICONS.out} size={16} />
              </button>
            </div>
          </div>
        )}

        <JobsPanel open={jobsOpen} onClose={() => setJobsOpen(false)} />
      </>
    );
  }

  // ── DESKTOP ───────────────────────────────────────────────────────────────────
  const navBtn = (to, icon, label) => {
    const active = isActive(to);
    return (
      <Link key={to} to={to} title={label} style={{
        display: "inline-flex", alignItems: "center", gap: 7,
        padding: "7px 12px", borderRadius: 8,
        background: active ? "rgba(167,139,250,0.16)" : "transparent",
        color: active ? "#a78bfa" : "rgba(232,233,242,0.62)",
        border: "1px solid transparent",
        font: '600 13px "Space Grotesk"', textDecoration: "none",
        transition: "background 0.12s, color 0.12s",
      }}>
        <NavIcon d={icon} size={15} />
        {label}
      </Link>
    );
  };

  return (
    <>
      <header style={{
        display: "flex", alignItems: "center", gap: 10, padding: "10px 18px",
        background: "#161a2a", borderBottom: "1px solid rgba(255,255,255,0.06)",
        flexShrink: 0, position: "sticky", top: 0, zIndex: 40,
      }}>
        <Link to="/" style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: 9 }}>
          {LOGO(22)}
          <div style={{ font: '700 17px "Space Grotesk"', color: "#a78bfa", letterSpacing: "-0.01em" }}>
            Anisubarr
          </div>
        </Link>

        <nav style={{ flex: 1, display: "flex", justifyContent: "center", gap: 4, flexWrap: "wrap" }}>
          {NAV_ITEMS.map(({ to, icon, label }) => navBtn(to, icon, label))}
        </nav>

        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {navBtn("/subtitles", ICONS.subs, "Titulky")}

          <button
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
            style={{
              display: "inline-flex", alignItems: "center", gap: 7,
              padding: "7px 12px", borderRadius: 8,
              background: "rgba(167,139,250,0.16)", color: "#a78bfa",
              border: "1px solid rgba(167,139,250,0.2)",
              font: '600 13px "Space Grotesk"', cursor: "pointer",
              opacity: syncMutation.isPending ? 0.6 : 1,
            }}>
            <NavIcon d={ICONS.sync} size={14} />
            {syncMutation.isPending ? "Sync…" : "Sync"}
            {runningCount > 0 && (
              <span style={{
                font: "700 10px JetBrains Mono", background: "#a78bfa",
                color: "#fff", padding: "1px 6px", borderRadius: 99, marginLeft: 2,
              }}>{runningCount}</span>
            )}
          </button>

          <button
            onClick={() => setJobsOpen(v => !v)}
            title="Úlohy na pozadí"
            style={{
              padding: "6px 7px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.06)",
              background: jobsOpen ? "rgba(167,139,250,0.16)" : "transparent",
              color: jobsOpen ? "#a78bfa" : "rgba(232,233,242,0.62)", cursor: "pointer",
            }}>
            <NavIcon d={ICONS.pulse} size={15} />
          </button>

          <button
            onClick={logout} title="Odhlásit se"
            style={{
              padding: "6px 7px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.06)",
              background: "transparent", color: "rgba(232,233,242,0.62)", cursor: "pointer",
            }}>
            <NavIcon d={ICONS.out} size={15} />
          </button>
        </div>
      </header>

      <JobsPanel open={jobsOpen} onClose={() => setJobsOpen(false)} />
    </>
  );
}
