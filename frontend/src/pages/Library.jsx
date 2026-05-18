import { useState, useEffect, useMemo, useCallback } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Search, Loader2, FileText, LayoutGrid, List,
  Star, ChevronLeft, ChevronRight, X, SlidersHorizontal, RefreshCw,
  CheckSquare, Square, Timer, Download, Trash2, FolderInput, Check, BadgeCheck,
} from "lucide-react";
import {
  getSeries, writeAllSeriesNfo, setWatchStatus, refreshCounts,
  getSonarrRootFolders, syncBulkSeries, downloadAllBulkSeries,
  deleteSubsBySeries, bulkRootFolderMove, publishSeries, getLibraryStats,
} from "../api/client";
import AnimeCard from "../components/AnimeCard";
import WatchStatusButton, { WATCH_OPTS } from "../components/WatchStatusButton";
import { useToast } from "../context/ToastContext";
import Tooltip from "../components/Tooltip";
import clsx from "clsx";

const PER_PAGE_OPTS = [25, 50, 100];

// ── Root folder helpers ───────────────────────────────────────────────────────

/** Extract the immediate parent folder name from a series path. */
function rootFolderOf(path) {
  if (!path) return null;
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : (parts[0] || null);
}

const ROOT_PALETTE = [
  { dot: "bg-amber-400",   ring: "ring-amber-600/40", badge: "bg-amber-900/40 text-amber-300 border-amber-800/40" },
  { dot: "bg-violet-400",  ring: "ring-violet-600/40", badge: "bg-violet-900/40 text-violet-300 border-violet-800/40" },
  { dot: "bg-teal-400",    ring: "ring-teal-600/40",  badge: "bg-teal-900/40 text-teal-300 border-teal-800/40" },
];

// ── Filter / sort option definitions ──────────────────────────────────────────

const STATUS_OPTS = [
  { label: "Stav: Vše",       value: "" },
  { label: "Vysílá se",       value: "RELEASING" },
  { label: "Dokončeno",       value: "FINISHED" },
  { label: "Chystá se",       value: "NOT_YET_RELEASED" },
  { label: "Zrušeno",         value: "CANCELLED" },
];

// Sonarr uses different status strings than AniList — normalise both
const STATUS_ALIASES = {
  Continuing: "RELEASING",
  Ended:      "FINISHED",
  Upcoming:   "NOT_YET_RELEASED",
  Deleted:    "CANCELLED",
};

const STATUS_LABEL = {
  FINISHED:         "Dokončeno",
  RELEASING:        "Vysílá se",
  NOT_YET_RELEASED: "Chystá se",
  CANCELLED:        "Zrušeno",
};
const STATUS_COLORS = {
  FINISHED:         "bg-green-900/40 text-green-300 border-green-800/40",
  RELEASING:        "bg-blue-900/40 text-blue-300 border-blue-800/40",
  NOT_YET_RELEASED: "bg-yellow-900/40 text-yellow-300 border-yellow-800/40",
  CANCELLED:        "bg-red-900/40 text-red-300 border-red-800/40",
};

const WATCH_FILTER_OPTS = [
  { label: "Sledování: Vše", value: "" },
  ...WATCH_OPTS.filter(o => o.value !== null).map(o => ({ label: o.label, value: o.value })),
  { label: "Neoznačeno",     value: "__none__" },
];

const CS_FILTER_OPTS = [
  { label: "CZ titulky: Vše",    value: "" },
  { label: "Všechny CZ titulky", value: "all" },
  { label: "Má CZ titulky",      value: "has" },
  { label: "Chybí CZ titulky",   value: "missing" },
  { label: "Bez CZ (žádný díl)", value: "none" },
];

const MISSING_FILTER_OPTS = [
  { label: "Díly: Vše",        value: "" },
  { label: "Chybějící díly",   value: "missing" },
  { label: "Kompletní",        value: "complete" },
];

const SORT_OPTS = [
  { label: "Název A–Z",        value: "title-asc" },
  { label: "Název Z–A",        value: "title-desc" },
  { label: "Hodnocení ↓",     value: "score-desc" },
  { label: "Rok ↓",            value: "year-desc" },
  { label: "Rok ↑",            value: "year-asc" },
  { label: "Přidáno (nové)",   value: "added-desc" },
  { label: "Přidáno (staré)",  value: "added-asc" },
  { label: "Epizody ↓",        value: "episodes-desc" },
  { label: "CZ titulky ↓",     value: "cs-desc" },
];

function normStatus(s) {
  return STATUS_ALIASES[s] || s || "";
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function ls(key, def) {
  try { const v = localStorage.getItem(key); return v !== null ? v : def; }
  catch { return def; }
}
function lsSet(key, val) {
  try { localStorage.setItem(key, String(val)); } catch {}
}

// ── List row ──────────────────────────────────────────────────────────────────

function SeriesRow({ s, rootColor, rootFolder, selectionMode = false, selected = false, onToggle }) {
  const qc = useQueryClient();
  const watchMutation = useMutation({
    mutationFn: (status) => setWatchStatus(s.id, status),
    onSuccess: () => qc.invalidateQueries(["series"]),
  });

  const epTotal    = s.episodes_monitored ?? s.episode_count ?? 0;
  const epHasFile  = s.episodes_with_file ?? s.episode_file_count ?? 0;
  const epMissing  = epTotal - epHasFile;
  const epComplete = epTotal > 0 && epMissing === 0;
  const ongoing    = normStatus(s.status) === "RELEASING";

  const csTotal = epHasFile;
  const csCount = s.cs_sub_count ?? 0;
  const csAll   = csTotal > 0 && csCount >= csTotal;
  const csNone  = csCount === 0;

  const rowContent = (
    <>
      {/* Checkbox / root folder badge */}
      {selectionMode ? (
        <div className={clsx(
          "w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all",
          selected ? "bg-accent border-accent text-white" : "border-muted text-transparent"
        )}>
          <Check size={11} />
        </div>
      ) : rootColor && rootFolder ? (
        <span className={clsx(
          "text-[10px] font-semibold px-1.5 py-0.5 rounded border flex-shrink-0 whitespace-nowrap",
          rootColor.badge
        )}>
          {rootFolder}
        </span>
      ) : null}

      {/* Thumbnail */}
      <div className="w-10 h-14 flex-shrink-0 rounded-lg overflow-hidden bg-border">
        {s.cover_url
          ? <img src={s.cover_url} alt={s.title} className="w-full h-full object-cover" loading="lazy" />
          : <div className="w-full h-full flex items-center justify-center text-lg">🎌</div>
        }
      </div>

      {/* Title */}
      <div className="flex-1 min-w-0">
        <p className={clsx(
          "text-sm font-semibold truncate transition-colors flex items-center gap-1.5",
          selectionMode && selected ? "text-accent" : "text-text group-hover:text-accent"
        )}>
          {s.has_issue && !selectionMode && (
            <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-orange-500 text-white text-[10px] font-bold flex-shrink-0" title="Otevřená issue v Overseerr">!</span>
          )}
          {s.promoted && !selectionMode && !s.has_issue && (
            <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-green-500 flex-shrink-0" title="Publikováno">
              <svg viewBox="0 0 12 12" className="w-2.5 h-2.5 text-white fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="1.5,6 4.5,9 10.5,3" />
              </svg>
            </span>
          )}
          {s.title_romaji || s.title}
        </p>
        {s.title_romaji && s.title !== s.title_romaji && (
          <p className="text-xs text-muted truncate">{s.title}</p>
        )}
        <div className="flex items-center gap-2 mt-0.5 sm:hidden">
          {s.status && (
            <span className={clsx("text-xs px-1.5 py-0 rounded border", STATUS_COLORS[normStatus(s.status)])}>
              {STATUS_LABEL[normStatus(s.status)] || s.status}
            </span>
          )}
          {s.year && <span className="text-xs text-muted">{s.year}</span>}
        </div>
      </div>

      {/* Stats blok */}
      <div className="flex items-center gap-3 flex-shrink-0">

        {/* Epizody */}
        {epTotal > 0 && (
          <div className={clsx(
            "flex flex-col items-center min-w-[48px] px-2 py-1 rounded-lg border",
            epComplete  ? "bg-green-900/20 border-green-800/30"
            : ongoing   ? "bg-blue-900/20  border-blue-800/30"
                        : "bg-orange-900/20 border-orange-800/30"
          )}>
            <span className={clsx(
              "text-sm font-bold leading-tight",
              epComplete ? "text-green-400" : ongoing ? "text-blue-300" : "text-orange-300"
            )}>
              {epHasFile}/{epTotal}
            </span>
            <span className={clsx(
              "text-[10px] leading-tight",
              epComplete ? "text-green-600" : ongoing ? "text-blue-600" : "text-orange-600"
            )}>
              {epComplete ? "komplet" : ongoing ? "vysílá se" : `chybí ${epMissing}`}
            </span>
          </div>
        )}

        {/* CZ titulky */}
        {csTotal > 0 ? (
          <div className={clsx(
            "flex flex-col items-center min-w-[40px] px-2 py-1 rounded-lg border",
            csAll  ? "bg-accent/10 border-accent/30"
            : csNone ? "bg-surface border-border"
                     : "bg-yellow-900/20 border-yellow-800/30"
          )}>
            <span className={clsx(
              "text-sm font-bold leading-tight",
              csAll ? "text-accent" : csNone ? "text-muted/40" : "text-yellow-400"
            )}>
              {csCount}/{csTotal}
            </span>
            <span className={clsx(
              "text-[10px] leading-tight",
              csAll ? "text-accent/60" : csNone ? "text-muted/30" : "text-yellow-600"
            )}>
              cs
            </span>
          </div>
        ) : (
          <div className="flex flex-col items-center min-w-[40px] px-2 py-1 rounded-lg border border-border opacity-30">
            <span className="text-sm font-bold leading-tight text-muted">—</span>
            <span className="text-[10px] leading-tight text-muted">cs</span>
          </div>
        )}

        {/* Status + hodnocení */}
        <div className="hidden sm:flex flex-col items-end gap-1 min-w-[80px]">
          {s.status && (
            <span className={clsx("text-xs px-2 py-0.5 rounded-full border", STATUS_COLORS[normStatus(s.status)] || "border-border text-muted")}>
              {STATUS_LABEL[normStatus(s.status)] || s.status}
            </span>
          )}
          {s.average_score > 0 && (
            <span className="flex items-center gap-0.5 text-xs text-yellow-400">
              <Star size={10} fill="currentColor" />{s.average_score.toFixed(1)}
            </span>
          )}
        </div>

        {/* Watch status — hidden in selection mode */}
        {!selectionMode && (
          <div onClick={e => e.preventDefault()}>
            <WatchStatusButton
              status={s.watch_status}
              onChange={(status) => watchMutation.mutate(status)}
              size="sm"
              isPending={watchMutation.isPending}
            />
          </div>
        )}
      </div>
    </>
  );

  if (selectionMode) {
    return (
      <div
        onClick={() => onToggle?.(s.id)}
        className={clsx(
          "flex items-center gap-3 px-3 py-2.5 rounded-xl border bg-surface cursor-pointer transition-all group",
          selected ? "border-accent bg-accent/5" : "border-border hover:border-accent/60"
        )}
      >
        {rowContent}
      </div>
    );
  }

  return (
    <Link
      to={`/series/${s.id}`}
      className={clsx(
        "flex items-center gap-3 px-3 py-2.5 rounded-xl border bg-surface transition-all group",
        s.has_issue
          ? "border-orange-500 hover:border-orange-400 shadow-sm shadow-orange-500/20"
          : s.promoted
            ? "border-green-700/60 hover:border-green-500 shadow-sm shadow-green-700/20"
            : "border-border hover:border-accent hover:bg-accent/5"
      )}
    >
      {rowContent}
    </Link>
  );
}

// ── Bulk action bar ────────────────────────────────────────────────────────────

function BulkActionBar({ count, onSync, onDownload, onDelete, onMove, onPublish, onClearAll, onSelectAll, totalInView, syncing, downloading, deleting, moving, publishing }) {
  if (count === 0) return null;
  return (
    <div className="fixed bottom-0 left-0 right-0 z-30 flex justify-center pointer-events-none">
      <div className="mb-4 pointer-events-auto flex items-center gap-2 px-4 py-2.5 bg-surface border border-border rounded-2xl shadow-2xl shadow-black/40 backdrop-blur-md">
        {/* Count */}
        <span className="text-sm font-semibold text-accent whitespace-nowrap">{count} vybráno</span>
        <div className="w-px h-5 bg-border mx-1" />

        {/* Vybrat vše */}
        <button
          onClick={onSelectAll}
          className="text-xs px-2.5 py-1 border border-border rounded-lg text-muted hover:text-text hover:border-accent transition-colors whitespace-nowrap"
        >
          Vybrat vše ({totalInView})
        </button>

        {/* Zrušit výběr */}
        <button
          onClick={onClearAll}
          className="text-xs px-2.5 py-1 border border-border rounded-lg text-muted hover:text-red-400 hover:border-red-400 transition-colors"
        >
          <X size={12} />
        </button>

        <div className="w-px h-5 bg-border mx-1" />

        <Tooltip text={"Synchronizuje časování CZ titulků\npro všechna vybraná anime\npomocí alass.\n\nBěží na pozadí."} placement="top">
          <button
            onClick={onSync}
            disabled={syncing}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-border rounded-lg text-muted hover:text-accent hover:border-accent transition-colors disabled:opacity-50"
          >
            {syncing ? <Loader2 size={12} className="animate-spin" /> : <Timer size={12} />}
            Sync
          </button>
        </Tooltip>

        <Tooltip text={"Stáhne chybějící CZ titulky\npro všechna vybraná anime.\n\nPoužívá Hiyori + HnS.\nBěží na pozadí."} placement="top">
          <button
            onClick={onDownload}
            disabled={downloading}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-border rounded-lg text-muted hover:text-accent hover:border-accent transition-colors disabled:opacity-50"
          >
            {downloading ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
            Stáhnout
          </button>
        </Tooltip>

        <Tooltip text={"Přesune vybraná anime do jiné\nkořenové složky v Sonarru.\n\nSonarr fyzicky přesune soubory\nna disk — může trvat.\nBěží na pozadí."} placement="top">
          <button
            onClick={onMove}
            disabled={moving}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-border rounded-lg text-muted hover:text-accent hover:border-accent transition-colors disabled:opacity-50"
          >
            {moving ? <Loader2 size={12} className="animate-spin" /> : <FolderInput size={12} />}
            Přesunout
          </button>
        </Tooltip>

        <Tooltip text={"Publikuje vybraná anime —\npřesune do produkční složky\na přidá tag v Sonarru.\n\nBěží na pozadí."} placement="top">
          <button
            onClick={onPublish}
            disabled={publishing}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-green-900/60 rounded-lg text-green-400 hover:bg-green-900/20 hover:border-green-500 transition-colors disabled:opacity-50"
          >
            {publishing ? <Loader2 size={12} className="animate-spin" /> : <BadgeCheck size={12} />}
            Publikovat
          </button>
        </Tooltip>

        <Tooltip text={"Smaže všechny CZ titulky\npro vybraná anime.\n\nSmaže záznamy i soubory\nna disku!"} placement="top">
          <button
            onClick={onDelete}
            disabled={deleting}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-red-900/60 rounded-lg text-red-400 hover:bg-red-900/20 hover:border-red-500 transition-colors disabled:opacity-50"
          >
            {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
            Smazat titulky
          </button>
        </Tooltip>
      </div>
    </div>
  );
}


// ── Root folder modal ─────────────────────────────────────────────────────────

function RootFolderModal({ open, onClose, onConfirm, isPending }) {
  const { data: folders = [], isLoading: foldersLoading } = useQuery({
    queryKey: ["sonarrRootFolders"],
    queryFn: () => getSonarrRootFolders().then(r => r.data),
    enabled: open,
  });
  const [selected, setSelected] = useState("");

  // Reset selection every time the modal opens
  useEffect(() => {
    if (open) setSelected("");
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      {/* stopPropagation prevents clicks inside the modal from reaching the backdrop */}
      <div
        className="relative bg-surface border border-border rounded-2xl shadow-2xl p-5 w-80 z-10"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold text-text mb-3">Přesunout do kořenové složky</h2>
        <div className="flex flex-col gap-1.5 mb-4 max-h-60 overflow-y-auto">
          {foldersLoading && (
            <div className="flex items-center justify-center py-4 gap-2 text-muted text-xs">
              <Loader2 size={14} className="animate-spin" /> Načítám…
            </div>
          )}
          {!foldersLoading && folders.map(f => (
            <button
              key={f.path}
              type="button"
              onClick={(e) => { e.stopPropagation(); setSelected(f.path); }}
              className={clsx(
                "flex items-center justify-between px-3 py-2 rounded-lg border text-sm transition-colors text-left w-full",
                selected === f.path
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border hover:border-accent/60 text-text"
              )}
            >
              <span className="truncate">{f.path}</span>
              {selected === f.path && <Check size={14} className="flex-shrink-0 ml-2" />}
            </button>
          ))}
          {!foldersLoading && folders.length === 0 && (
            <p className="text-xs text-muted text-center py-4">Žádné kořenové složky v Sonarru</p>
          )}
        </div>
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="text-xs px-3 py-1.5 border border-border rounded-lg text-muted hover:text-text transition-colors"
          >
            Zrušit
          </button>
          <button
            type="button"
            onClick={() => { if (selected) onConfirm(selected); }}
            disabled={!selected || isPending}
            className="text-xs px-3 py-1.5 bg-accent text-white rounded-lg disabled:opacity-40 hover:bg-accent/80 transition-colors flex items-center gap-1.5"
          >
            {isPending ? <Loader2 size={12} className="animate-spin" /> : <FolderInput size={12} />}
            Přesunout {selected ? `→ ${selected.split(/[\\/]/).filter(Boolean).pop()}` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}


// ── Pagination ────────────────────────────────────────────────────────────────

function Pagination({ page, totalPages, perPage, onPage, onPerPage }) {
  const pages = [];
  const delta = 2;
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= page - delta && i <= page + delta))
      pages.push(i);
  }
  const withGaps = [];
  pages.forEach((p, idx) => {
    if (idx > 0 && p - pages[idx - 1] > 1) withGaps.push("…");
    withGaps.push(p);
  });

  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mt-2">
      {/* Per-page selector — vždy viditelný */}
      <div className="flex items-center gap-2 text-xs text-muted">
        <span>Na stránce:</span>
        {PER_PAGE_OPTS.map(n => (
          <button key={n} onClick={() => onPerPage(n)}
            className={clsx("px-2 py-0.5 rounded border transition-colors",
              perPage === n ? "bg-accent/20 border-accent text-accent" : "border-border hover:border-accent text-muted hover:text-text"
            )}>
            {n}
          </button>
        ))}
      </div>
      {/* Page controls — always visible, arrows disabled at boundaries */}
      <div className="flex items-center justify-center sm:justify-end gap-1">
        <button onClick={() => onPage(page - 1)} disabled={page === 1}
          className="p-1.5 rounded text-muted hover:text-text disabled:opacity-30 transition-colors">
          <ChevronLeft size={18} />
        </button>
        {totalPages <= 1 ? (
          <span className="text-xs text-muted px-2">strana 1 / 1</span>
        ) : (
          withGaps.map((p, i) =>
            p === "…" ? <span key={`g-${i}`} className="text-xs text-muted px-1">…</span> : (
              <button key={p} onClick={() => onPage(p)}
                className={clsx("w-8 h-8 rounded text-xs transition-colors",
                  p === page ? "bg-accent text-white" : "text-muted hover:text-text hover:bg-border"
                )}>
                {p}
              </button>
            )
          )
        )}
        <button onClick={() => onPage(page + 1)} disabled={page === totalPages}
          className="p-1.5 rounded text-muted hover:text-text disabled:opacity-30 transition-colors">
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}

// ── Compact filter select ─────────────────────────────────────────────────────

function FilterSelect({ value, onChange, opts, active }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className={clsx(
        "bg-surface border rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-accent transition-colors cursor-pointer",
        active ? "border-accent text-accent" : "border-border text-muted hover:border-accent hover:text-text"
      )}
    >
      {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Library() {
  const [search,        setSearch]        = useState("");
  const [status,        setStatus]        = useState(() => ls("lib_status",  ""));
  const [watchFilter,   setWatchFilter]   = useState(() => ls("lib_watch",   ""));
  const [csFilter,      setCsFilter]      = useState(() => ls("lib_cs",      ""));
  const [missingFilter, setMissingFilter] = useState(() => ls("lib_missing", ""));
  const [rootFilter,    setRootFilter]    = useState(() => ls("lib_root",    ""));
  const [sort,          setSort]          = useState(() => ls("lib_sort",    "title-asc"));
  const [view,          setView]          = useState(() => ls("libraryView", "grid"));
  const [page,          setPage]          = useState(1);
  const [perPage,       setPerPage]       = useState(() => Number(ls("libraryPerPage", "50")));
  const [filtersOpen,   setFiltersOpen]   = useState(false);

  // ── Selection mode ─────────────────────────────────────────────────────────
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds,   setSelectedIds]   = useState(new Set());
  const [movingModal,   setMovingModal]   = useState(false);

  const toggleSelection = useCallback((id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const queryClient            = useQueryClient();
  const toast                  = useToast();
  const nfoAllMutation         = useMutation({
    mutationFn: writeAllSeriesNfo,
    onSuccess: () => toast.success("NFO soubory zapsány"),
    onError:   (e) => toast.error(`NFO chyba: ${e?.response?.data?.detail || e.message}`),
  });
  const refreshCountsMutation  = useMutation({
    mutationFn: refreshCounts,
    onSuccess: () => {
      toast.info("Přepočítávám počty…");
      setTimeout(() => queryClient.invalidateQueries(["series"]), 3000);
    },
  });

  // Bulk mutations
  const syncBulkMutation = useMutation({
    mutationFn: (ids) => syncBulkSeries([...ids]),
    onSuccess: (_, ids) => {
      toast.success(`Sync spuštěn pro ${ids.size ?? [...ids].length} anime`);
      setSelectedIds(new Set());
    },
    onError: (e) => toast.error(`Chyba syncu: ${e?.response?.data?.detail || e.message}`),
  });
  const downloadBulkMutation = useMutation({
    mutationFn: (ids) => downloadAllBulkSeries([...ids]),
    onSuccess: (_, ids) => {
      toast.success(`Stahování titulků spuštěno pro ${ids.size ?? [...ids].length} anime`);
      setSelectedIds(new Set());
    },
    onError: (e) => toast.error(`Chyba stahování: ${e?.response?.data?.detail || e.message}`),
  });
  const deleteBulkMutation = useMutation({
    mutationFn: (ids) => deleteSubsBySeries([...ids]),
    onSuccess: (_, ids) => {
      toast.success(`Titulky smazány pro ${ids.size ?? [...ids].length} anime`);
      setSelectedIds(new Set());
      queryClient.invalidateQueries(["series"]);
    },
    onError: (e) => toast.error(`Chyba mazání: ${e?.response?.data?.detail || e.message}`),
  });
  const publishBulkMutation = useMutation({
    mutationFn: async (ids) => {
      const results = await Promise.allSettled([...ids].map(id => publishSeries(id)));
      const ok = results.filter(r => r.status === "fulfilled").length;
      return { ok, total: ids.size ?? [...ids].length };
    },
    onSuccess: ({ ok, total }) => {
      toast.success(`Publikováno: ${ok}/${total} anime`);
      setSelectedIds(new Set());
      queryClient.invalidateQueries(["series"]);
    },
    onError: (e) => toast.error(`Chyba publikování: ${e?.response?.data?.detail || e.message}`),
  });
  const moveBulkMutation = useMutation({
    mutationFn: ({ ids, rootFolderPath }) => bulkRootFolderMove([...ids], rootFolderPath),
    onSuccess: (res, { ids }) => {
      const count = ids.size ?? [...ids].length;
      toast.success(`Přesun spuštěn pro ${count} anime — Sonarr přesouvá soubory na pozadí`);
      setSelectedIds(new Set());
      setMovingModal(false);
      setTimeout(() => queryClient.invalidateQueries(["series"]), 8000);
    },
    onError: (e) => {
      toast.error(`Přesun selhal: ${e?.response?.data?.detail || e.message}`);
      setMovingModal(false);
    },
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ["series"],
    queryFn: () => getSeries().then(r => r.data),
    staleTime: 60_000,
  });

  const { data: stats } = useQuery({
    queryKey: ["library-stats"],
    queryFn: () => getLibraryStats().then(r => r.data),
    staleTime: 60_000,
    enabled: !isLoading && !error,
  });

  // Persist filter state
  useEffect(() => { lsSet("lib_status",  status);        }, [status]);
  useEffect(() => { lsSet("lib_watch",   watchFilter);   }, [watchFilter]);
  useEffect(() => { lsSet("lib_cs",      csFilter);      }, [csFilter]);
  useEffect(() => { lsSet("lib_missing", missingFilter); }, [missingFilter]);
  useEffect(() => { lsSet("lib_root",    rootFilter);    }, [rootFilter]);
  useEffect(() => { lsSet("lib_sort",    sort);          }, [sort]);

  // Reset page on any filter/sort change
  useEffect(() => { setPage(1); }, [search, status, watchFilter, csFilter, missingFilter, rootFilter, sort, perPage]);

  // Build root folder color map + filter options from data
  const rootColorMap = useMemo(() => {
    const roots = [...new Set((data || []).map(s => rootFolderOf(s.path)).filter(Boolean))].sort();
    return Object.fromEntries(roots.map((r, i) => [r, ROOT_PALETTE[i % ROOT_PALETTE.length]]));
  }, [data]);

  const rootFolderOpts = useMemo(() => {
    const roots = Object.keys(rootColorMap);
    if (roots.length < 1) return null;
    return [
      { label: "Složka: Vše", value: "" },
      ...roots.map(r => ({ label: r, value: r })),
    ];
  }, [rootColorMap]);

  // Clear stale rootFilter persisted from a previous session when it's no longer a valid option.
  // Guard: only clear after data has loaded (rootFolderOpts !== null means data has paths).
  useEffect(() => {
    if (!rootFilter) return;
    if (rootFolderOpts === null) return; // data not yet loaded, don't clear prematurely
    const valid = rootFolderOpts.some(o => o.value === rootFilter);
    if (!valid) setRootFilter("");
  }, [rootFilter, rootFolderOpts]);

  const activeFilterCount = [status, watchFilter, csFilter, missingFilter, rootFilter].filter(Boolean).length;

  function resetFilters() {
    setStatus(""); setWatchFilter(""); setCsFilter(""); setMissingFilter(""); setRootFilter("");
    setSearch("");
  }

  const filtered = useMemo(() => {
    let arr = data || [];

    // Text search
    if (search) {
      const q = search.toLowerCase();
      arr = arr.filter(s =>
        s.title?.toLowerCase().includes(q) ||
        s.title_romaji?.toLowerCase().includes(q) ||
        s.title_english?.toLowerCase().includes(q) ||
        s.title_japanese?.toLowerCase().includes(q)
      );
    }

    // Status filter (normalise Sonarr vs AniList values)
    if (status) {
      arr = arr.filter(s => normStatus(s.status) === status);
    }

    // Watch status filter
    if (watchFilter) {
      if (watchFilter === "__none__") {
        arr = arr.filter(s => !s.watch_status);
      } else {
        arr = arr.filter(s => s.watch_status === watchFilter);
      }
    }

    // CZ subtitles filter
    if (csFilter) {
      arr = arr.filter(s => {
        const epHasFile = s.episodes_with_file ?? s.episode_file_count ?? 0;
        const csCount   = s.cs_sub_count ?? 0;
        if (csFilter === "all")     return epHasFile > 0 && csCount >= epHasFile;
        if (csFilter === "has")     return csCount > 0;
        if (csFilter === "none")    return epHasFile > 0 && csCount === 0;
        if (csFilter === "missing") return epHasFile > 0 && csCount < epHasFile;
        return true;
      });
    }

    // Missing episodes filter
    if (missingFilter) {
      arr = arr.filter(s => {
        const epTotal   = s.episodes_monitored ?? s.episode_count ?? 0;
        const epHasFile = s.episodes_with_file ?? s.episode_file_count ?? 0;
        const missing   = epTotal - epHasFile;
        if (missingFilter === "missing")  return missing > 0;
        if (missingFilter === "complete") return epTotal > 0 && missing === 0;
        return true;
      });
    }

    // Root folder filter
    if (rootFilter) {
      arr = arr.filter(s => rootFolderOf(s.path) === rootFilter);
    }

    // Sort
    arr = [...arr].sort((a, b) => {
      switch (sort) {
        case "title-desc":
          return (b.title_romaji || b.title).localeCompare(a.title_romaji || a.title);
        case "score-desc":
          return (b.average_score || 0) - (a.average_score || 0);
        case "year-desc":
          return (b.year || 0) - (a.year || 0);
        case "year-asc":
          return (a.year || 0) - (b.year || 0);
        case "added-desc":
          return (b.sonarr_added || "").localeCompare(a.sonarr_added || "");
        case "added-asc":
          return (a.sonarr_added || "").localeCompare(b.sonarr_added || "");
        case "episodes-desc":
          return (b.episodes_with_file ?? b.episode_file_count ?? 0) - (a.episodes_with_file ?? a.episode_file_count ?? 0);
        case "cs-desc":
          return (b.cs_sub_count ?? 0) - (a.cs_sub_count ?? 0);
        default: // title-asc
          return (a.title_romaji || a.title).localeCompare(b.title_romaji || b.title);
      }
    });

    return arr;
  }, [data, search, status, watchFilter, csFilter, missingFilter, rootFilter, sort]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const safePage   = Math.min(page, totalPages);
  const paginated  = filtered.slice((safePage - 1) * perPage, safePage * perPage);

  function switchView(v)  { setView(v);   lsSet("libraryView", v); }
  function handlePerPage(n) { setPerPage(n); lsSet("libraryPerPage", n); }

  // Helper: get root color for a series
  const rootColorOf = (s) => rootColorMap[rootFolderOf(s.path)] ?? null;

  return (
    <div className="flex flex-col gap-3">
      {/* ── Stat cards ── */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Celkem",      value: stats.total       ?? 0, color: "#a78bfa" },
            { label: "Vysílá se",   value: stats.airing      ?? 0, color: "#3b82f6" },
            { label: "Chystá se",   value: stats.upcoming    ?? 0, color: "#f59e0b" },
            { label: "Dokončeno",   value: stats.finished    ?? 0, color: "#22c55e" },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-panel border border-border rounded-xl px-4 py-3 flex flex-col gap-1">
              <span className="text-xs text-text-dim font-medium">{label}</span>
              <span className="text-2xl font-bold" style={{ color }}>{value}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Header row ── */}
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-text flex-shrink-0">
          Knihovna
          {data && (
            <span className="text-muted text-sm ml-2 font-normal">
              ({filtered.length !== data.length
                ? `${filtered.length} / ${data.length}`
                : data.length})
            </span>
          )}
        </h1>
        <div className="flex items-center gap-2">
          <Tooltip text={selectionMode
            ? "Ukončit režim výběru\na zrušit výběr"
            : "Zapnout režim hromadného\nvýběru anime.\n\nPak můžeš vybrat více anime\na spustit akce najednou."}>
            <button
              onClick={() => { setSelectionMode(v => !v); setSelectedIds(new Set()); }}
              className={clsx(
                "flex items-center gap-1 text-xs px-2.5 py-1 border rounded-lg transition-colors",
                selectionMode
                  ? "bg-accent/20 border-accent text-accent"
                  : "bg-surface border-border hover:border-accent text-muted hover:text-text"
              )}
            >
              {selectionMode ? <CheckSquare size={11} /> : <Square size={11} />}
              {selectionMode ? "Ukončit" : "Vybrat"}
            </button>
          </Tooltip>
          <Tooltip text={"Přepočítá cached počty epizod\na CZ titulků pro všechna anime.\n\nSkontroluje skutečné soubory na disku.\nPotřebné po ručních změnách."}>
            <button
              onClick={() => refreshCountsMutation.mutate()}
              disabled={refreshCountsMutation.isPending}
              className="flex items-center gap-1 text-xs px-2.5 py-1 bg-surface border border-border hover:border-accent text-muted hover:text-text rounded-lg transition-colors disabled:opacity-50"
            >
              {refreshCountsMutation.isPending
                ? <Loader2 size={11} className="animate-spin" />
                : <RefreshCw size={11} />}
              {refreshCountsMutation.isPending ? "Počítám…" : refreshCountsMutation.isSuccess ? "Hotovo!" : "Přepočítat"}
            </button>
          </Tooltip>
          <Tooltip text={"Zapíše .nfo soubory pro VŠECHNA\nanime v knihovně.\n\nEmby / Jellyfin použijí tyto soubory\npro CZ popis, postery a metadata.\nMůže trvat i minuty."}>
            <button
              onClick={() => { if (window.confirm("Zapsat NFO soubory pro všechna anime? Může trvat delší dobu.")) nfoAllMutation.mutate(); }}
              disabled={nfoAllMutation.isPending}
              className="flex items-center gap-1 text-xs px-2.5 py-1 bg-surface border border-border hover:border-accent text-muted hover:text-text rounded-lg transition-colors disabled:opacity-50"
            >
              {nfoAllMutation.isPending ? <Loader2 size={11} className="animate-spin" /> : <FileText size={11} />}
              NFO
            </button>
          </Tooltip>
        </div>
      </div>

      {/* ── Search + view toggle row ── */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Hledat anime…"
            className="w-full bg-surface border border-border rounded-lg pl-8 pr-3 py-2 text-sm text-text placeholder-muted focus:outline-none focus:border-accent transition-colors"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-text">
              <X size={13} />
            </button>
          )}
        </div>

        {/* Filters toggle button */}
        <button
          onClick={() => setFiltersOpen(v => !v)}
          className={clsx(
            "flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border transition-colors flex-shrink-0",
            filtersOpen || activeFilterCount > 0
              ? "border-accent bg-accent/10 text-accent"
              : "border-border bg-surface text-muted hover:border-accent hover:text-text"
          )}
        >
          <SlidersHorizontal size={14} />
          Filtry
          {activeFilterCount > 0 && (
            <span className="flex items-center justify-center w-4 h-4 rounded-full bg-accent text-[9px] font-bold text-white leading-none">
              {activeFilterCount}
            </span>
          )}
        </button>

        {/* View toggle */}
        <div className="flex rounded-lg border border-border overflow-hidden flex-shrink-0">
          <button onClick={() => switchView("grid")}
            className={clsx("px-2.5 py-2 transition-colors",
              view === "grid" ? "bg-accent/20 text-accent" : "text-muted hover:text-text hover:bg-border"
            )} title="Mřížka"><LayoutGrid size={15} /></button>
          <button onClick={() => switchView("list")}
            className={clsx("px-2.5 py-2 transition-colors border-l border-border",
              view === "list" ? "bg-accent/20 text-accent" : "text-muted hover:text-text hover:bg-border"
            )} title="Seznam"><List size={15} /></button>
        </div>
      </div>

      {/* ── Expanded filter row ── */}
      {filtersOpen && (
        <div className="flex flex-wrap items-center gap-2 p-3 bg-surface border border-border rounded-xl">
          <FilterSelect
            value={status} onChange={setStatus}
            opts={STATUS_OPTS}
            active={!!status}
          />
          <FilterSelect
            value={watchFilter} onChange={setWatchFilter}
            opts={WATCH_FILTER_OPTS}
            active={!!watchFilter}
          />
          <FilterSelect
            value={csFilter} onChange={setCsFilter}
            opts={CS_FILTER_OPTS}
            active={!!csFilter}
          />
          <FilterSelect
            value={missingFilter} onChange={setMissingFilter}
            opts={MISSING_FILTER_OPTS}
            active={!!missingFilter}
          />
          {rootFolderOpts && (
            <FilterSelect
              value={rootFilter} onChange={setRootFilter}
              opts={rootFolderOpts}
              active={!!rootFilter}
            />
          )}

          {/* Divider */}
          <div className="w-px h-5 bg-border mx-1" />

          <FilterSelect
            value={sort} onChange={setSort}
            opts={SORT_OPTS}
            active={sort !== "title-asc"}
          />

          {/* Reset */}
          {(activeFilterCount > 0 || search) && (
            <button onClick={resetFilters}
              className="flex items-center gap-1 text-xs px-2.5 py-1.5 border border-red-800/50 text-red-400 hover:bg-red-900/20 rounded-lg transition-colors ml-auto">
              <X size={11} /> Resetovat
            </button>
          )}
        </div>
      )}

      {/* ── States ── */}
      {isLoading && (
        <div className="flex items-center justify-center py-24 text-muted gap-2">
          <Loader2 size={20} className="animate-spin" /> Načítám…
        </div>
      )}
      {error && (
        <div className="text-red-400 text-sm bg-red-900/20 border border-red-800 rounded-lg p-4">
          Chyba: {error.message}. Zkontroluj, zda je backend spuštěn.
        </div>
      )}
      {!isLoading && !error && filtered.length === 0 && (
        <div className="text-center py-24 text-muted flex flex-col items-center gap-3">
          <div className="text-5xl">🎌</div>
          {data?.length === 0
            ? <p>Žádné seriály. Spusť Sync ze Sonarr tlačítkem nahoře.</p>
            : <>
                <p>Žádné výsledky pro zadané filtry.</p>
                {activeFilterCount > 0 && (
                  <button
                    onClick={resetFilters}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-red-800/50 text-red-400 hover:bg-red-900/20 rounded-lg transition-colors"
                  >
                    <X size={11} /> Resetovat všechny filtry ({activeFilterCount})
                  </button>
                )}
              </>
          }
        </div>
      )}

      {/* ── Grid ── */}
      {paginated.length > 0 && view === "grid" && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {paginated.map(s => (
            <AnimeCard
              key={s.id}
              series={s}
              rootColor={rootColorOf(s)}
              rootFolder={rootFolderOf(s.path)}
              selectionMode={selectionMode}
              selected={selectedIds.has(s.id)}
              onToggle={toggleSelection}
            />
          ))}
        </div>
      )}

      {/* ── List ── */}
      {paginated.length > 0 && view === "list" && (
        <div className="flex flex-col gap-1.5">
          {paginated.map(s => (
            <SeriesRow
              key={s.id}
              s={s}
              rootColor={rootColorOf(s)}
              rootFolder={rootFolderOf(s.path)}
              selectionMode={selectionMode}
              selected={selectedIds.has(s.id)}
              onToggle={toggleSelection}
            />
          ))}
        </div>
      )}

      {/* ── Pagination ── */}
      {!isLoading && (
        <Pagination
          page={safePage} totalPages={totalPages}
          perPage={perPage} onPage={setPage} onPerPage={handlePerPage}
        />
      )}

      {/* Extra bottom padding when bulk bar is visible */}
      {selectionMode && selectedIds.size > 0 && <div className="h-16" />}

      {/* ── Bulk action bar ── */}
      {selectionMode && (
        <BulkActionBar
          count={selectedIds.size}
          totalInView={filtered.length}
          onSelectAll={() => setSelectedIds(new Set(filtered.map(s => s.id)))}
          onClearAll={() => setSelectedIds(new Set())}
          syncing={syncBulkMutation.isPending}
          downloading={downloadBulkMutation.isPending}
          deleting={deleteBulkMutation.isPending}
          moving={moveBulkMutation.isPending}
          publishing={publishBulkMutation.isPending}
          onSync={() => {
            if (selectedIds.size === 0) return;
            syncBulkMutation.mutate(selectedIds);
          }}
          onDownload={() => {
            if (selectedIds.size === 0) return;
            downloadBulkMutation.mutate(selectedIds);
          }}
          onDelete={() => {
            if (selectedIds.size === 0) return;
            if (window.confirm(`Smazat CZ titulky pro ${selectedIds.size} anime?`))
              deleteBulkMutation.mutate(selectedIds);
          }}
          onMove={() => setMovingModal(true)}
          onPublish={() => {
            if (selectedIds.size === 0) return;
            if (window.confirm(`Publikovat ${selectedIds.size} vybraných anime?`))
              publishBulkMutation.mutate(selectedIds);
          }}
        />
      )}

      {/* ── Root folder modal ── */}
      <RootFolderModal
        open={movingModal}
        onClose={() => setMovingModal(false)}
        isPending={moveBulkMutation.isPending}
        onConfirm={(path) => moveBulkMutation.mutate({ ids: selectedIds, rootFolderPath: path })}
      />
    </div>
  );
}
