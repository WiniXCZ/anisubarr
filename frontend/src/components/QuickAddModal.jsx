import { useEffect, useState } from "react";
import { T } from "../theme";
import { useToast } from "../context/ToastContext";

function apiHeaders() {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}

async function apiFetch(url, opts = {}) {
  const res = await fetch(url, { headers: apiHeaders(), ...opts });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || res.statusText);
  }
  return res.json();
}

export default function QuickAddModal({ anime, onClose }) {
  const toast = useToast();
  const [rootFolders, setRootFolders] = useState([]);
  const [qualityProfiles, setQualityProfiles] = useState([]);
  const [selectedRoot, setSelectedRoot] = useState("");
  const [selectedProfile, setSelectedProfile] = useState("");
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [fetchError, setFetchError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function loadData() {
      setFetching(true);
      setFetchError(null);
      try {
        const [roots, profiles] = await Promise.all([
          apiFetch("/api/sonarr/root-folders"),
          apiFetch("/api/sonarr/quality-profiles"),
        ]);
        if (cancelled) return;
        setRootFolders(roots);
        setQualityProfiles(profiles);
        if (roots.length) setSelectedRoot(roots[0].path);
        if (profiles.length) setSelectedProfile(String(profiles[0].id));
      } catch (e) {
        if (!cancelled) setFetchError(e.message);
      } finally {
        if (!cancelled) setFetching(false);
      }
    }
    loadData();
    return () => { cancelled = true; };
  }, []);

  // Close on Escape
  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleAdd() {
    if (!anime.tvdb_id) {
      toast.error("Série nemá TVDB ID — nelze přidat do Sonarru");
      return;
    }
    if (!selectedRoot || !selectedProfile) {
      toast.error("Vyber složku a kvalitu");
      return;
    }
    setLoading(true);
    try {
      const result = await apiFetch("/api/sonarr/add", {
        method: "POST",
        body: JSON.stringify({
          tvdb_id: anime.tvdb_id,
          title: anime.title || anime.title_romaji || anime.title_english,
          root_folder_path: selectedRoot,
          quality_profile_id: parseInt(selectedProfile),
          season_folder: true,
        }),
      });
      toast.success(`✓ "${result.title}" přidáno do Sonarru`);
      onClose();
    } catch (e) {
      toast.error(`Chyba: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  const title = anime.title_english || anime.title_romaji || anime.title || "Neznámý název";

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 2000,
        background: "rgba(0,0,0,0.72)",
        backdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "20px",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: "min(520px, 95vw)",
          background: T.panel,
          border: `1px solid ${T.borderStrong}`,
          borderRadius: 16,
          overflow: "hidden",
          boxShadow: "0 32px 96px rgba(0,0,0,0.8)",
        }}
      >
        {/* Header */}
        <div style={{
          padding: "16px 20px",
          borderBottom: `1px solid ${T.border}`,
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <span style={{ font: '700 16px "Space Grotesk"', color: T.text }}>
            Přidat do Sonarru
          </span>
          <button
            onClick={onClose}
            style={{
              background: "transparent", border: "none",
              color: T.textDim, cursor: "pointer", fontSize: 20, lineHeight: 1,
            }}
          >×</button>
        </div>

        {/* Anime info */}
        <div style={{ display: "flex", gap: 16, padding: "20px" }}>
          {anime.poster_url && (
            <img
              src={anime.poster_url}
              alt=""
              style={{
                width: 80, height: 114, objectFit: "cover",
                borderRadius: 8, flexShrink: 0,
                border: `1px solid ${T.border}`,
              }}
            />
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              font: '700 18px "Space Grotesk"', color: T.text,
              marginBottom: 4,
              wordBreak: "break-word",
            }}>
              {title}
            </div>
            {anime.title_romaji && anime.title_romaji !== title && (
              <div style={{ font: "400 13px sans-serif", color: T.textDim, marginBottom: 4 }}>
                {anime.title_romaji}
              </div>
            )}
            {anime.year && (
              <div style={{
                display: "inline-block",
                font: "600 11px JetBrains Mono, monospace",
                color: T.textMute,
                background: T.panel2,
                border: `1px solid ${T.border}`,
                borderRadius: 6, padding: "2px 8px",
                marginTop: 4,
              }}>
                {anime.year}
              </div>
            )}
            {!anime.tvdb_id && (
              <div style={{
                marginTop: 8,
                font: "500 12px sans-serif",
                color: "#f87171",
              }}>
                ⚠ Chybí TVDB ID — přidání do Sonarru nemusí fungovat
              </div>
            )}
          </div>
        </div>

        {/* Form */}
        <div style={{ padding: "0 20px 20px" }}>
          {fetchError && (
            <div style={{
              padding: "10px 14px", marginBottom: 14,
              background: "rgba(239,68,68,0.12)",
              border: "1px solid rgba(239,68,68,0.3)",
              borderRadius: 8, color: "#f87171",
              font: "500 13px sans-serif",
            }}>
              {fetchError}
            </div>
          )}

          {/* Root folder */}
          <label style={{ display: "block", marginBottom: 12 }}>
            <div style={{ font: '600 12px "Space Grotesk"', color: T.textDim, marginBottom: 6 }}>
              Složka médií
            </div>
            <select
              value={selectedRoot}
              onChange={e => setSelectedRoot(e.target.value)}
              disabled={fetching || !!fetchError}
              style={{
                width: "100%", padding: "9px 12px",
                background: T.panel2, color: T.text,
                border: `1px solid ${T.border}`,
                borderRadius: 8, outline: "none",
                font: '500 13px "Space Grotesk"', cursor: "pointer",
              }}
            >
              {fetching && <option>Načítám…</option>}
              {!fetching && rootFolders.map(f => (
                <option key={f.path} value={f.path}>
                  {f.path}
                  {f.freeSpace > 0 ? `  (${(f.freeSpace / 1e9).toFixed(1)} GB volno)` : ""}
                </option>
              ))}
            </select>
          </label>

          {/* Quality profile */}
          <label style={{ display: "block", marginBottom: 20 }}>
            <div style={{ font: '600 12px "Space Grotesk"', color: T.textDim, marginBottom: 6 }}>
              Profil kvality
            </div>
            <select
              value={selectedProfile}
              onChange={e => setSelectedProfile(e.target.value)}
              disabled={fetching || !!fetchError}
              style={{
                width: "100%", padding: "9px 12px",
                background: T.panel2, color: T.text,
                border: `1px solid ${T.border}`,
                borderRadius: 8, outline: "none",
                font: '500 13px "Space Grotesk"', cursor: "pointer",
              }}
            >
              {fetching && <option>Načítám…</option>}
              {!fetching && qualityProfiles.map(p => (
                <option key={p.id} value={String(p.id)}>{p.name}</option>
              ))}
            </select>
          </label>

          {/* Buttons */}
          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={onClose}
              style={{
                flex: 1, padding: "10px 0",
                background: "transparent",
                border: `1px solid ${T.border}`,
                borderRadius: 8, color: T.textDim,
                font: '600 13px "Space Grotesk"', cursor: "pointer",
              }}
            >
              Zrušit
            </button>
            <button
              onClick={handleAdd}
              disabled={loading || fetching || !!fetchError}
              style={{
                flex: 2, padding: "10px 0",
                background: T.accentSoft,
                border: `1px solid rgba(167,139,250,0.3)`,
                borderRadius: 8, color: T.accent,
                font: '700 13px "Space Grotesk"', cursor: "pointer",
                opacity: (loading || fetching || !!fetchError) ? 0.5 : 1,
                transition: "opacity 0.15s",
              }}
            >
              {loading ? "Přidávám…" : "➕ Přidat do Sonarru"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
