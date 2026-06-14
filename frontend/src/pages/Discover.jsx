import { useEffect, useRef, useState } from "react";
import QuickAddModal from "../components/QuickAddModal";
import { useToast } from "../context/ToastContext";
import { T } from "../theme";

// ── API helpers ──────────────────────────────────────────────────────────────
function authHeaders() {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}
async function apiFetch(url, opts = {}) {
  const res = await fetch(url, {
    headers: { ...authHeaders(), "Content-Type": "application/json", ...opts.headers },
    ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || res.statusText);
  }
  return res.json();
}

// ── Score badge ───────────────────────────────────────────────────────────────
function ScoreBadge({ score }) {
  if (!score) return null;
  const pct = score / 100;
  const color = pct >= 0.8 ? "#4ade80" : pct >= 0.6 ? "#facc15" : "#f87171";
  return (
    <span style={{
      position: "absolute", top: 7, left: 7,
      font: "700 11px JetBrains Mono, monospace",
      background: "rgba(0,0,0,0.72)", color,
      borderRadius: 6, padding: "2px 7px",
      border: `1px solid ${color}40`,
    }}>
      {score}%
    </span>
  );
}

// ── Anime card ────────────────────────────────────────────────────────────────
function AnimeCard({ anime, inWatchlist, onToggleWatchlist, onQuickAdd }) {
  const [hovered, setHovered] = useState(false);
  const poster = anime.poster_url ||
    anime.coverImage?.extraLarge ||
    anime.coverImage?.large;
  const title = anime.title_english ||
    anime.title?.english ||
    anime.title_romaji ||
    anime.title?.romaji ||
    "—";

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative",
        flexShrink: 0,
        width: 140,
        cursor: "pointer",
        borderRadius: 10,
        overflow: "hidden",
        background: T.panel,
        border: `1px solid ${hovered ? T.borderStrong : T.border}`,
        transition: "border-color 0.15s, transform 0.15s",
        transform: hovered ? "translateY(-3px)" : "none",
      }}
    >
      {/* Poster */}
      <div style={{ position: "relative", aspectRatio: "2/3" }}>
        {poster
          ? <img src={poster} alt={title} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          : <div style={{ width: "100%", height: "100%", background: T.panel2 }} />
        }
        <ScoreBadge score={anime.score ?? anime.averageScore} />

        {/* Hover action strip */}
        {hovered && (
          <div style={{
            position: "absolute", inset: 0,
            background: "linear-gradient(to top, rgba(0,0,0,0.88) 0%, transparent 60%)",
            display: "flex", alignItems: "flex-end", justifyContent: "center",
            gap: 8, padding: "0 8px 10px",
          }}>
            <button
              onClick={(e) => { e.stopPropagation(); onToggleWatchlist(anime); }}
              title={inWatchlist ? "Odebrat z watchlistu" : "Přidat do watchlistu"}
              style={{
                width: 34, height: 34,
                borderRadius: 8,
                background: inWatchlist ? "rgba(167,139,250,0.35)" : "rgba(255,255,255,0.12)",
                border: `1px solid ${inWatchlist ? "rgba(167,139,250,0.6)" : "rgba(255,255,255,0.2)"}`,
                color: inWatchlist ? T.accent : "#fff",
                fontSize: 16, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              🔖
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onQuickAdd(anime); }}
              title="Přidat do Sonarru"
              style={{
                width: 34, height: 34,
                borderRadius: 8,
                background: "rgba(167,139,250,0.25)",
                border: "1px solid rgba(167,139,250,0.4)",
                color: T.accent,
                fontSize: 16, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              ➕
            </button>
          </div>
        )}
      </div>

      {/* Title */}
      <div style={{
        padding: "8px 9px",
        font: '600 12px "Space Grotesk"',
        color: T.text,
        lineHeight: 1.35,
        display: "-webkit-box",
        WebkitLineClamp: 2,
        WebkitBoxOrient: "vertical",
        overflow: "hidden",
      }}>
        {title}
      </div>
    </div>
  );
}

// ── Horizontal scroll row ─────────────────────────────────────────────────────
function ScrollRow({ title, items, watchlistIds, onToggleWatchlist, onQuickAdd, loading }) {
  const rowRef = useRef(null);

  function scroll(dir) {
    rowRef.current?.scrollBy({ left: dir * 600, behavior: "smooth" });
  }

  return (
    <section style={{ marginBottom: 40 }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 14,
      }}>
        <h2 style={{
          margin: 0,
          font: '700 18px "Space Grotesk"',
          color: T.text,
        }}>
          {title}
        </h2>
        <div style={{ display: "flex", gap: 6 }}>
          {["◀", "▶"].map((arrow, i) => (
            <button
              key={arrow}
              onClick={() => scroll(i === 0 ? -1 : 1)}
              style={{
                width: 30, height: 30, borderRadius: 8,
                background: T.panel2, border: `1px solid ${T.border}`,
                color: T.textDim, cursor: "pointer", fontSize: 12,
              }}
            >
              {arrow}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ color: T.textMute, font: "500 13px sans-serif", padding: "20px 0" }}>
          Načítám…
        </div>
      ) : (
        <div
          ref={rowRef}
          style={{
            display: "flex", gap: 12,
            overflowX: "auto", paddingBottom: 8,
            scrollbarWidth: "thin",
            scrollbarColor: `${T.border} transparent`,
          }}
        >
          {items.map((anime) => {
            const id = anime.anilist_id ?? anime.id;
            return (
              <AnimeCard
                key={id}
                anime={anime}
                inWatchlist={watchlistIds.has(id)}
                onToggleWatchlist={onToggleWatchlist}
                onQuickAdd={onQuickAdd}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

// ── Hero banner ───────────────────────────────────────────────────────────────
function HeroBanner({ anime, onQuickAdd, onToggleWatchlist, inWatchlist }) {
  if (!anime) return null;
  const title = anime.title_english || anime.title?.english || anime.title_romaji || anime.title?.romaji || "—";
  const genres = anime.genres || [];
  const banner = anime.banner_url || anime.bannerImage;
  const poster = anime.poster_url || anime.coverImage?.extraLarge || anime.coverImage?.large;
  const bg = banner || poster;
  const score = anime.score ?? anime.averageScore;
  const anilistId = anime.anilist_id ?? anime.id;

  return (
    <div style={{
      position: "relative",
      height: 320,
      borderRadius: 16,
      overflow: "hidden",
      marginBottom: 40,
      background: T.panel,
    }}>
      {bg && (
        <img
          src={bg}
          alt=""
          style={{
            position: "absolute", inset: 0,
            width: "100%", height: "100%",
            objectFit: "cover", objectPosition: "center 20%",
          }}
        />
      )}
      {/* Gradient overlay */}
      <div style={{
        position: "absolute", inset: 0,
        background: "linear-gradient(to right, rgba(10,10,20,0.92) 0%, rgba(10,10,20,0.6) 50%, rgba(10,10,20,0.2) 100%)",
      }} />

      {/* Content */}
      <div style={{
        position: "absolute", inset: 0,
        display: "flex", alignItems: "center",
        padding: "0 40px",
      }}>
        <div style={{ maxWidth: 520 }}>
          <div style={{
            font: '500 11px "Space Grotesk"',
            color: T.accent,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            marginBottom: 8,
          }}>
            #1 Trending
          </div>
          <h1 style={{
            margin: "0 0 10px",
            font: '800 30px "Space Grotesk"',
            color: "#fff",
            lineHeight: 1.15,
          }}>
            {title}
          </h1>

          {/* Genres */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
            {genres.slice(0, 4).map(g => (
              <span key={g} style={{
                font: '500 11px "Space Grotesk"',
                color: T.textDim,
                background: "rgba(255,255,255,0.08)",
                borderRadius: 6, padding: "3px 9px",
                border: `1px solid ${T.border}`,
              }}>{g}</span>
            ))}
            {score && (
              <span style={{
                font: "700 11px JetBrains Mono, monospace",
                color: "#4ade80",
                background: "rgba(74,222,128,0.1)",
                borderRadius: 6, padding: "3px 9px",
                border: "1px solid rgba(74,222,128,0.25)",
              }}>{score}%</span>
            )}
          </div>

          {/* Description */}
          {anime.description && (
            <p style={{
              margin: "0 0 20px",
              font: "400 13px sans-serif",
              color: "rgba(232,233,242,0.65)",
              lineHeight: 1.6,
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}>
              {anime.description}
            </p>
          )}

          {/* Actions */}
          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={() => onQuickAdd(anime)}
              style={{
                padding: "9px 20px", borderRadius: 9,
                background: T.accentSoft,
                border: "1px solid rgba(167,139,250,0.3)",
                color: T.accent,
                font: '700 13px "Space Grotesk"',
                cursor: "pointer",
              }}
            >
              ➕ Přidat do Sonarru
            </button>
            <button
              onClick={() => onToggleWatchlist(anime)}
              style={{
                padding: "9px 16px", borderRadius: 9,
                background: inWatchlist ? "rgba(167,139,250,0.2)" : "rgba(255,255,255,0.07)",
                border: `1px solid ${inWatchlist ? "rgba(167,139,250,0.4)" : T.border}`,
                color: inWatchlist ? T.accent : T.textDim,
                font: '600 13px "Space Grotesk"',
                cursor: "pointer",
              }}
            >
              {inWatchlist ? "🔖 Ve watchlistu" : "🔖 Watchlist"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Countdown helpers ────────────────────────────────────────────────────────
function daysUntil(startDate) {
  if (!startDate || !startDate.year) return null;
  const target = new Date(startDate.year, (startDate.month || 1) - 1, startDate.day || 1);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const diffMs = target - now;
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

function CountdownBadge({ startDate }) {
  const days = daysUntil(startDate);
  if (days == null) return null;
  let label;
  if (days < 0) label = "Brzy";
  else if (days === 0) label = "Dnes";
  else if (days === 1) label = "Zítra";
  else label = `Za ${days} dní`;
  return (
    <span style={{
      position: "absolute", top: 7, right: 7,
      font: "700 11px JetBrains Mono, monospace",
      background: "rgba(0,0,0,0.72)", color: T.accent3,
      borderRadius: 6, padding: "2px 7px",
      border: `1px solid ${T.accent3}40`,
    }}>
      {label}
    </span>
  );
}

// ── Anime card with countdown ───────────────────────────────────────────────
function CountdownCard({ anime, inWatchlist, onToggleWatchlist }) {
  const [hovered, setHovered] = useState(false);
  const poster = anime.poster_url || anime.coverImage?.extraLarge || anime.coverImage?.large;
  const title = anime.title_english || anime.title_romaji || "—";

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative", flexShrink: 0, width: 140,
        borderRadius: 10, overflow: "hidden", background: T.panel,
        border: `1px solid ${hovered ? T.borderStrong : T.border}`,
        transition: "border-color 0.15s, transform 0.15s",
        transform: hovered ? "translateY(-3px)" : "none",
      }}
    >
      <div style={{ position: "relative", aspectRatio: "2/3" }}>
        {poster
          ? <img src={poster} alt={title} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          : <div style={{ width: "100%", height: "100%", background: T.panel2 }} />
        }
        <CountdownBadge startDate={anime.start_date} />
        {hovered && (
          <div style={{
            position: "absolute", inset: 0,
            background: "linear-gradient(to top, rgba(0,0,0,0.88) 0%, transparent 60%)",
            display: "flex", alignItems: "flex-end", justifyContent: "center",
            gap: 8, padding: "0 8px 10px",
          }}>
            <button
              onClick={(e) => { e.stopPropagation(); onToggleWatchlist(anime); }}
              title={inWatchlist ? "Odebrat z watchlistu" : "Přidat do watchlistu"}
              style={{
                width: 34, height: 34, borderRadius: 8,
                background: inWatchlist ? "rgba(167,139,250,0.35)" : "rgba(255,255,255,0.12)",
                border: `1px solid ${inWatchlist ? "rgba(167,139,250,0.6)" : "rgba(255,255,255,0.2)"}`,
                color: inWatchlist ? T.accent : "#fff",
                fontSize: 16, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >🔖</button>
          </div>
        )}
      </div>
      <div style={{
        padding: "8px 9px",
        font: '600 12px "Space Grotesk"', color: T.text, lineHeight: 1.35,
        display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
      }}>
        {title}
      </div>
    </div>
  );
}

// ── Explorer section ──────────────────────────────────────────────────────────
const STATUS_OPTIONS = [
  { value: "", label: "Vše" },
  { value: "RELEASING", label: "Vysílá se" },
  { value: "FINISHED", label: "Dokončeno" },
  { value: "NOT_YET_RELEASED", label: "Připravuje se" },
  { value: "CANCELLED", label: "Zrušeno" },
  { value: "HIATUS", label: "Pozastaveno" },
];

function selectStyle() {
  return {
    background: T.panel2, color: T.text, border: `1px solid ${T.border}`,
    borderRadius: 8, padding: "7px 10px", font: '500 12px "Space Grotesk"',
    cursor: "pointer", outline: "none",
  };
}

function ExplorerSection({ genres, watchlistIds, onToggleWatchlist, onQuickAdd, toast }) {
  const [genre, setGenre] = useState("");
  const [year, setYear] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState([]);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(false);

  const currentYear = new Date().getFullYear();
  const years = [];
  for (let y = currentYear + 1; y >= 1990; y--) years.push(y);

  useEffect(() => {
    setPage(1);
    setItems([]);
  }, [genre, year, status]);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (genre) params.set("genre", genre);
    if (year) params.set("year", year);
    if (status) params.set("status", status);
    params.set("page", String(page));

    apiFetch(`/api/discover/explore?${params.toString()}`)
      .then(data => {
        setItems(prev => page === 1 ? data.items : [...prev, ...data.items]);
        setHasNext(data.has_next_page);
      })
      .catch(e => toast.error(`Explorer: ${e.message}`))
      .finally(() => setLoading(false));
  }, [genre, year, status, page]);

  return (
    <section style={{ marginBottom: 40 }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 14, flexWrap: "wrap", gap: 12,
      }}>
        <h2 style={{ margin: 0, font: '700 18px "Space Grotesk"', color: T.text }}>
          🧭 Explorer
        </h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select value={genre} onChange={e => setGenre(e.target.value)} style={selectStyle()}>
            <option value="">Všechny žánry</option>
            {genres.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
          <select value={year} onChange={e => setYear(e.target.value)} style={selectStyle()}>
            <option value="">Všechny roky</option>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select value={status} onChange={e => setStatus(e.target.value)} style={selectStyle()}>
            {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
      </div>

      {items.length === 0 && loading ? (
        <div style={{ color: T.textMute, font: "500 13px sans-serif", padding: "20px 0" }}>
          Načítám…
        </div>
      ) : items.length === 0 ? (
        <div style={{ color: T.textMute, font: "500 13px sans-serif", padding: "20px 0" }}>
          Žádné výsledky pro zvolené filtry
        </div>
      ) : (
        <>
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
            gap: 12,
          }}>
            {items.map(anime => (
              <AnimeCard
                key={anime.anilist_id}
                anime={anime}
                inWatchlist={watchlistIds.has(anime.anilist_id)}
                onToggleWatchlist={onToggleWatchlist}
                onQuickAdd={onQuickAdd}
              />
            ))}
          </div>
          {hasNext && (
            <div style={{ display: "flex", justifyContent: "center", marginTop: 16 }}>
              <button
                onClick={() => setPage(p => p + 1)}
                disabled={loading}
                style={{
                  padding: "8px 20px", borderRadius: 8,
                  background: T.panel2, border: `1px solid ${T.border}`,
                  color: T.text, font: '600 12px "Space Grotesk"',
                  cursor: loading ? "default" : "pointer", opacity: loading ? 0.6 : 1,
                }}
              >
                {loading ? "Načítám…" : "Načíst další"}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ── Countdown row ────────────────────────────────────────────────────────────
function CountdownRow({ items, watchlistIds, onToggleWatchlist, loading }) {
  const rowRef = useRef(null);

  function scroll(dir) {
    rowRef.current?.scrollBy({ left: dir * 600, behavior: "smooth" });
  }

  return (
    <section style={{ marginBottom: 40 }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 14,
      }}>
        <h2 style={{ margin: 0, font: '700 18px "Space Grotesk"', color: T.text }}>
          ⏳ Připravuje se
        </h2>
        <div style={{ display: "flex", gap: 6 }}>
          {["◀", "▶"].map((arrow, i) => (
            <button
              key={arrow}
              onClick={() => scroll(i === 0 ? -1 : 1)}
              style={{
                width: 30, height: 30, borderRadius: 8,
                background: T.panel2, border: `1px solid ${T.border}`,
                color: T.textDim, cursor: "pointer", fontSize: 12,
              }}
            >
              {arrow}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ color: T.textMute, font: "500 13px sans-serif", padding: "20px 0" }}>
          Načítám…
        </div>
      ) : !items.length ? (
        <div style={{ color: T.textMute, font: "500 13px sans-serif", padding: "20px 0" }}>
          Žádné nadcházející tituly
        </div>
      ) : (
        <div
          ref={rowRef}
          style={{
            display: "flex", gap: 12,
            overflowX: "auto", paddingBottom: 8,
            scrollbarWidth: "thin",
            scrollbarColor: `${T.border} transparent`,
          }}
        >
          {items.map((anime) => (
            <CountdownCard
              key={anime.anilist_id}
              anime={anime}
              inWatchlist={watchlistIds.has(anime.anilist_id)}
              onToggleWatchlist={onToggleWatchlist}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// ── Watchlist section ─────────────────────────────────────────────────────────
function WatchlistSection({ items, onRemove, onQuickAdd }) {
  if (!items.length) return null;
  return (
    <section style={{ marginBottom: 40 }}>
      <h2 style={{
        margin: "0 0 14px",
        font: '700 18px "Space Grotesk"',
        color: T.text,
      }}>
        🔖 Watchlist
      </h2>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {items.map(item => (
          <div key={item.anilist_id} style={{
            display: "flex", alignItems: "center", gap: 10,
            background: T.panel,
            border: `1px solid ${T.border}`,
            borderRadius: 10, padding: "8px 12px",
            minWidth: 200, maxWidth: 280,
          }}>
            {item.poster_url && (
              <img
                src={item.poster_url}
                alt=""
                style={{ width: 36, height: 52, objectFit: "cover", borderRadius: 6, flexShrink: 0 }}
              />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                font: '600 13px "Space Grotesk"', color: T.text,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {item.title || "—"}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <button
                onClick={() => onQuickAdd({ anilist_id: item.anilist_id, title_english: item.title, poster_url: item.poster_url })}
                title="Přidat do Sonarru"
                style={{
                  width: 28, height: 28, borderRadius: 6,
                  background: "rgba(167,139,250,0.15)",
                  border: "1px solid rgba(167,139,250,0.3)",
                  color: T.accent, cursor: "pointer", fontSize: 13,
                }}
              >➕</button>
              <button
                onClick={() => onRemove(item.anilist_id)}
                title="Odebrat"
                style={{
                  width: 28, height: 28, borderRadius: 6,
                  background: "rgba(239,68,68,0.1)",
                  border: "1px solid rgba(239,68,68,0.25)",
                  color: "#f87171", cursor: "pointer", fontSize: 13,
                }}
              >×</button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Discover() {
  const toast = useToast();
  const [trending, setTrending] = useState([]);
  const [seasonal, setSeasonal] = useState([]);
  const [upcoming, setUpcoming] = useState([]);
  const [genres, setGenres] = useState([]);
  const [watchlist, setWatchlist] = useState([]);
  const [loadingTrending, setLoadingTrending] = useState(true);
  const [loadingSeasonal, setLoadingSeasonal] = useState(true);
  const [loadingUpcoming, setLoadingUpcoming] = useState(true);
  const [quickAddAnime, setQuickAddAnime] = useState(null);

  const watchlistIds = new Set(watchlist.map(w => w.anilist_id));

  // ── Fetch data ──────────────────────────────────────────────────────────────
  useEffect(() => {
    apiFetch("/api/discover/trending")
      .then(data => setTrending(data))
      .catch(e => toast.error(`Trending: ${e.message}`))
      .finally(() => setLoadingTrending(false));

    apiFetch("/api/discover/seasonal")
      .then(data => setSeasonal(data))
      .catch(e => toast.error(`Seasonal: ${e.message}`))
      .finally(() => setLoadingSeasonal(false));

    apiFetch("/api/discover/upcoming")
      .then(data => setUpcoming(data))
      .catch(e => toast.error(`Upcoming: ${e.message}`))
      .finally(() => setLoadingUpcoming(false));

    apiFetch("/api/discover/genres")
      .then(data => setGenres(data))
      .catch(() => {}); // non-critical

    apiFetch("/api/watchlist")
      .then(data => setWatchlist(data))
      .catch(() => {}); // silent — user might not be logged in yet
  }, []);

  // ── Watchlist toggle ────────────────────────────────────────────────────────
  async function handleToggleWatchlist(anime) {
    const id = anime.anilist_id ?? anime.id;
    const title = anime.title_english || anime.title?.english || anime.title_romaji || anime.title?.romaji;
    const poster = anime.poster_url || anime.coverImage?.extraLarge || anime.coverImage?.large;

    if (watchlistIds.has(id)) {
      // Remove
      try {
        await apiFetch(`/api/watchlist/${id}`, { method: "DELETE" });
        setWatchlist(prev => prev.filter(w => w.anilist_id !== id));
        toast.success(`Odebráno z watchlistu`);
      } catch (e) {
        toast.error(`Chyba: ${e.message}`);
      }
    } else {
      // Add
      try {
        await apiFetch("/api/watchlist", {
          method: "POST",
          body: JSON.stringify({ anilist_id: id, title, poster_url: poster }),
        });
        setWatchlist(prev => [...prev, { anilist_id: id, title, poster_url: poster }]);
        toast.success(`Přidáno do watchlistu`);
      } catch (e) {
        if (e.message?.includes("409") || e.message?.includes("již")) {
          toast.info("Již ve watchlistu");
        } else {
          toast.error(`Chyba: ${e.message}`);
        }
      }
    }
  }

  const hero = trending[0] ?? null;
  const heroId = hero ? (hero.anilist_id ?? hero.id) : null;

  return (
    <div style={{
      flex: 1,
      overflowY: "auto",
      overflowX: "hidden",
      padding: "28px 28px 40px",
      maxWidth: 1400,
      margin: "0 auto",
      width: "100%",
      boxSizing: "border-box",
    }}>
      {/* Hero */}
      {!loadingTrending && hero && (
        <HeroBanner
          anime={hero}
          onQuickAdd={setQuickAddAnime}
          onToggleWatchlist={handleToggleWatchlist}
          inWatchlist={heroId !== null && watchlistIds.has(heroId)}
        />
      )}

      {/* Trending */}
      <ScrollRow
        title="🔥 Trending nyní"
        items={trending}
        watchlistIds={watchlistIds}
        onToggleWatchlist={handleToggleWatchlist}
        onQuickAdd={setQuickAddAnime}
        loading={loadingTrending}
      />

      {/* Seasonal */}
      <ScrollRow
        title="🌸 Tato sezóna"
        items={seasonal}
        watchlistIds={watchlistIds}
        onToggleWatchlist={handleToggleWatchlist}
        onQuickAdd={setQuickAddAnime}
        loading={loadingSeasonal}
      />

      {/* Upcoming / countdown */}
      <CountdownRow
        items={upcoming}
        watchlistIds={watchlistIds}
        onToggleWatchlist={handleToggleWatchlist}
        loading={loadingUpcoming}
      />

      {/* Explorer */}
      <ExplorerSection
        genres={genres}
        watchlistIds={watchlistIds}
        onToggleWatchlist={handleToggleWatchlist}
        onQuickAdd={setQuickAddAnime}
        toast={toast}
      />

      {/* Watchlist */}
      <WatchlistSection
        items={watchlist}
        onRemove={async (id) => {
          try {
            await apiFetch(`/api/watchlist/${id}`, { method: "DELETE" });
            setWatchlist(prev => prev.filter(w => w.anilist_id !== id));
            toast.success("Odebráno z watchlistu");
          } catch (e) {
            toast.error(`Chyba: ${e.message}`);
          }
        }}
        onQuickAdd={setQuickAddAnime}
      />

      {/* QuickAdd modal */}
      {quickAddAnime && (
        <QuickAddModal
          anime={quickAddAnime}
          onClose={() => setQuickAddAnime(null)}
        />
      )}
    </div>
  );
}
