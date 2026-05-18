import { useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Loader2, Star, Languages, FileText, Eye, Download,
  Send, AlertTriangle, ExternalLink, CheckCircle2, Clock,
  Timer, CheckSquare, Square, X, Tag, FolderOpen, Pencil, Trash2,
  BadgeCheck, FolderInput, Filter,
} from "lucide-react";
import {
  getSeriesById, translateSeries, writeAllNfo, previewSeriesNfo,
  downloadAllSubtitles, setWatchStatus,
  overseerrSeriesIssues, overseerrRequest,
  syncSeriesTiming, syncBulkTiming,
  getSonarrTags, getSonarrRootFolders,
  updateSeriesTags, updateSeriesRootFolder,
  downloadBestBulk, writeEpisodesNfo,
  deleteSubsByEpisodes, deleteSubsBySeries,
  publishSeries, demoteSeries,
} from "../api/client";
import WatchStatusButton from "../components/WatchStatusButton";
import EpisodeRow from "../components/EpisodeRow";
import Tooltip from "../components/Tooltip";
import api from "../api/client";
import clsx from "clsx";

// Fetch episodes from the backend
const getEpisodes = (seriesId) => api.get(`/series/${seriesId}/episodes`).then(r => r.data);

// ── Tag checkbox list — separated to allow useEffect for init ─────────────────
function TagCheckboxList({ allTags, seriesTags, selectedTagIds, setSelectedTagIds }) {
  // Initialize selection from series tags once allTags is available
  if (selectedTagIds === null && allTags.length > 0) {
    const initial = allTags.filter(t => seriesTags.includes(t.label)).map(t => t.id);
    setSelectedTagIds(initial);
    return null; // re-render with ids set
  }
  const ids = selectedTagIds ?? [];
  return allTags.map(tag => {
    const checked = ids.includes(tag.id);
    return (
      <label key={tag.id} className="flex items-center gap-2.5 cursor-pointer group">
        <input
          type="checkbox"
          checked={checked}
          onChange={() =>
            setSelectedTagIds(prev =>
              checked ? (prev ?? []).filter(i => i !== tag.id) : [...(prev ?? []), tag.id]
            )
          }
          className="w-4 h-4 rounded cursor-pointer"
        />
        <span className="text-sm text-text group-hover:text-accent transition-colors">{tag.label}</span>
      </label>
    );
  });
}

export default function SeriesDetail() {
  const { id }    = useParams();
  const qc        = useQueryClient();
  const [seasonFilter, setSeasonFilter] = useState(null);
  const [nfoPreview, setNfoPreview]     = useState(null);
  const [nfoPreviewOpen, setNfoPreviewOpen] = useState(false);

  // ── Multi-select state ────────────────────────────────────────────────────
  const [selectMode,       setSelectMode]       = useState(false);
  const [selectedEpisodes, setSelectedEpisodes] = useState(new Set());
  const [deleteSubsLang,   setDeleteSubsLang]   = useState("");  // "" = all languages

  const toggleEpisode = useCallback((epId) => {
    setSelectedEpisodes(prev => {
      const next = new Set(prev);
      if (next.has(epId)) next.delete(epId); else next.add(epId);
      return next;
    });
  }, []);

  function selectAll(eps) {
    setSelectedEpisodes(new Set(eps.map(e => e.id)));
  }
  function clearSelection() {
    setSelectedEpisodes(new Set());
  }
  function exitSelectMode() {
    setSelectMode(false);
    setSelectedEpisodes(new Set());
  }

  // ── Data queries ──────────────────────────────────────────────────────────
  const { data: series, isLoading } = useQuery({
    queryKey: ["series", id],
    queryFn: () => getSeriesById(id).then((r) => r.data),
  });

  const { data: episodes = [], isLoading: epsLoading } = useQuery({
    queryKey: ["episodes", id],
    queryFn: () => getEpisodes(id),
    enabled: !!series,
  });

  // ── Mutations ─────────────────────────────────────────────────────────────
  const translateMutation = useMutation({
    mutationFn: () => translateSeries(id),
    onSuccess: () => setTimeout(() => qc.invalidateQueries(["series", id]), 3000),
  });

  const nfoMutation = useMutation({
    mutationFn: () => writeAllNfo(id),
    onSuccess: () => alert("NFO soubory zapsány vedle video souborů."),
  });

  const watchMutation = useMutation({
    mutationFn: (status) => setWatchStatus(id, status),
    onSuccess: () => qc.invalidateQueries(["series", id]),
  });

  // Overseerr
  const { data: overseerr } = useQuery({
    queryKey: ["overseerr-series", id],
    queryFn: () => overseerrSeriesIssues(id).then(r => r.data),
    enabled: !!series,
    staleTime: 60_000,
  });

  const [overseerrMsg, setOverseerrMsg] = useState("");
  const overseerrMutation = useMutation({
    mutationFn: () => overseerrRequest(id),
    onSuccess: () => {
      setOverseerrMsg("Požadavek odeslán do Overseerr ✓");
      setTimeout(() => setOverseerrMsg(""), 5000);
      qc.invalidateQueries(["overseerr-series", id]);
    },
    onError: (e) => {
      setOverseerrMsg(e?.response?.data?.detail || "Chyba při odesílání požadavku");
      setTimeout(() => setOverseerrMsg(""), 5000);
    },
  });

  const [bulkMsg, setBulkMsg] = useState("");
  const bulkMutation = useMutation({
    mutationFn: () => downloadAllSubtitles(id),
    onSuccess: (res) => {
      const count = res.data?.count ?? "?";
      setBulkMsg(`Stahování spuštěno — ${count} epizod ve frontě. Průběh vidíš v Activity logu.`);
      setTimeout(() => setBulkMsg(""), 8000);
    },
    onError: (e) => {
      setBulkMsg(e?.response?.data?.detail || "Chyba při spouštění hromadného stahování.");
      setTimeout(() => setBulkMsg(""), 6000);
    },
  });

  // ── Sonarr tag / root-folder editing ─────────────────────────────────────
  const [posterOpen,       setPosterOpen]       = useState(false);
  const [tagEditorOpen,    setTagEditorOpen]    = useState(false);
  const [folderEditorOpen, setFolderEditorOpen] = useState(false);
  const [selectedTagIds,   setSelectedTagIds]   = useState(null); // null = not yet loaded
  const [sonarrMsg,        setSonarrMsg]        = useState("");

  const { data: allTags = [] } = useQuery({
    queryKey: ["sonarr-tags"],
    queryFn:  () => getSonarrTags().then(r => r.data),
    enabled:  tagEditorOpen,
    staleTime: 60_000,
  });

  const { data: rootFolders = [] } = useQuery({
    queryKey: ["sonarr-root-folders"],
    queryFn:  () => getSonarrRootFolders().then(r => r.data),
    enabled:  folderEditorOpen,
    staleTime: 60_000,
  });

  const tagsMutation = useMutation({
    mutationFn: () => updateSeriesTags(id, selectedTagIds),
    onSuccess: (res) => {
      setSonarrMsg("Tagy uloženy ✓");
      setTimeout(() => setSonarrMsg(""), 4000);
      setTagEditorOpen(false);
      qc.invalidateQueries(["series", id]);
    },
    onError: (e) => {
      setSonarrMsg(e?.response?.data?.detail || "Chyba při ukládání tagů");
      setTimeout(() => setSonarrMsg(""), 5000);
    },
  });

  const folderMutation = useMutation({
    mutationFn: (path) => updateSeriesRootFolder(id, path),
    onSuccess: () => {
      setSonarrMsg("Složka změněna ✓");
      setTimeout(() => setSonarrMsg(""), 4000);
      setFolderEditorOpen(false);
      qc.invalidateQueries(["series", id]);
    },
    onError: (e) => {
      setSonarrMsg(e?.response?.data?.detail || "Chyba při změně složky");
      setTimeout(() => setSonarrMsg(""), 5000);
    },
  });

  function openTagEditor() {
    setSelectedTagIds(null); // TagCheckboxList will init from allTags once loaded
    setTagEditorOpen(true);
  }

  // alass — sync all CZ subs in series
  const [syncMsg, setSyncMsg] = useState("");
  const syncSeriesMutation = useMutation({
    mutationFn: () => syncSeriesTiming(id),
    onSuccess: (res) => {
      setSyncMsg(`Sync spuštěn — ${res.data?.count ?? "?"} epizod ve frontě.`);
      setTimeout(() => setSyncMsg(""), 8000);
    },
    onError: (e) => {
      setSyncMsg(e?.response?.data?.detail || "Chyba při spouštění sync.");
      setTimeout(() => setSyncMsg(""), 6000);
    },
  });

  // alass — sync selected episodes (bulk)
  const syncBulkMutation = useMutation({
    mutationFn: () => syncBulkTiming([...selectedEpisodes]),
    onSuccess: (res) => {
      setSyncMsg(`Sync spuštěn — ${res.data?.count ?? "?"} epizod ve frontě.`);
      setTimeout(() => setSyncMsg(""), 8000);
      exitSelectMode();
    },
    onError: (e) => {
      setSyncMsg(e?.response?.data?.detail || "Chyba při spouštění sync.");
      setTimeout(() => setSyncMsg(""), 6000);
    },
  });

  // bulk download for selected episodes
  const dlBulkMutation = useMutation({
    mutationFn: () => downloadBestBulk([...selectedEpisodes]),
    onSuccess: (res) => {
      setBulkMsg(`Stahování spuštěno — ${res.data?.count ?? "?"} epizod ve frontě.`);
      setTimeout(() => setBulkMsg(""), 8000);
      exitSelectMode();
    },
    onError: (e) => {
      setBulkMsg(e?.response?.data?.detail || "Chyba při spouštění stahování.");
      setTimeout(() => setBulkMsg(""), 6000);
    },
  });

  // bulk NFO write for selected episodes
  const nfoBulkMutation = useMutation({
    mutationFn: () => writeEpisodesNfo([...selectedEpisodes]),
    onSuccess: (res) => {
      setBulkMsg(`NFO zapsáno — ${res.data?.count ?? "?"} epizod.`);
      setTimeout(() => setBulkMsg(""), 6000);
      exitSelectMode();
    },
    onError: (e) => {
      setBulkMsg(e?.response?.data?.detail || "Chyba při zápisu NFO.");
      setTimeout(() => setBulkMsg(""), 6000);
    },
  });

  // bulk subtitle delete for selected episodes (language-filtered)
  const deleteSubsMutation = useMutation({
    mutationFn: () => deleteSubsByEpisodes([...selectedEpisodes], deleteSubsLang || null),
    onSuccess: (res) => {
      const langLabel = deleteSubsLang ? ` (${deleteSubsLang.toUpperCase()})` : "";
      setBulkMsg(`Smazáno ${res.data?.deleted ?? "?"} titulků${langLabel}.`);
      setTimeout(() => setBulkMsg(""), 6000);
      exitSelectMode();
      qc.invalidateQueries({ queryKey: ["episodes", id] });
    },
    onError: (e) => {
      setBulkMsg(e?.response?.data?.detail || "Chyba při mazání titulků.");
      setTimeout(() => setBulkMsg(""), 6000);
    },
  });

  // bulk subtitle delete for all episodes in current view (language-filtered)
  const deleteAllSubsMutation = useMutation({
    mutationFn: ({ lang, epIds }) => deleteSubsByEpisodes(epIds, lang || null),
    onSuccess: (res, { lang }) => {
      const langLabel = lang ? ` (${lang.toUpperCase()})` : "";
      setBulkMsg(`Smazáno ${res.data?.deleted ?? "?"} titulků${langLabel} z celé série.`);
      setTimeout(() => setBulkMsg(""), 8000);
      qc.invalidateQueries({ queryKey: ["episodes", id] });
    },
    onError: (e) => {
      setBulkMsg(e?.response?.data?.detail || "Chyba při mazání titulků.");
      setTimeout(() => setBulkMsg(""), 6000);
    },
  });

  // publish / demote
  const [promoMsg, setPromoMsg] = useState("");
  const publishMutation = useMutation({
    mutationFn: () => publishSeries(id),
    onSuccess: () => {
      setPromoMsg("Publikování spuštěno — Sonarr přesouvá soubory na pozadí. Může trvat několik minut.");
      setTimeout(() => setPromoMsg(""), 12000);
      // Refresh after a delay to pick up the promoted flag once Sonarr finishes
      setTimeout(() => {
        qc.invalidateQueries(["series", id]);
        qc.invalidateQueries(["series"]);
      }, 10000);
    },
    onError: (e) => {
      setPromoMsg(e?.response?.data?.detail || "Chyba při publikování.");
      setTimeout(() => setPromoMsg(""), 6000);
    },
  });

  const demoteMutation = useMutation({
    mutationFn: () => demoteSeries(id),
    onSuccess: () => {
      setPromoMsg("Přesun spuštěn — Sonarr přesouvá soubory na pozadí. Může trvat několik minut.");
      setTimeout(() => setPromoMsg(""), 12000);
      setTimeout(() => {
        qc.invalidateQueries(["series", id]);
        qc.invalidateQueries(["series"]);
      }, 10000);
    },
    onError: (e) => {
      setPromoMsg(e?.response?.data?.detail || "Chyba při přesouvání do inkomplete.");
      setTimeout(() => setPromoMsg(""), 6000);
    },
  });

  async function handleNfoPreview() {
    try {
      const res = await previewSeriesNfo(id);
      setNfoPreview(res.data);
      setNfoPreviewOpen(true);
    } catch (e) {
      alert("Chyba při generování NFO náhledu.");
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted gap-2">
        <Loader2 size={20} className="animate-spin" /> Načítám…
      </div>
    );
  }

  if (!series) return <div className="text-red-400">Seriál nenalezen.</div>;

  // Seasons list for filter
  const seasons = [...new Set(episodes.map(e => e.season_number))].sort((a, b) => a - b);
  const filteredEps = seasonFilter !== null
    ? episodes.filter(e => e.season_number === seasonFilter)
    : episodes;

  // Count episodes with a file in current view (for "select all with file")
  const filteredWithFile = filteredEps.filter(e => e.has_file);

  return (
    <div className="flex flex-col gap-6">
      {/* Banner */}
      {series.banner_url && (
        <div className="relative h-40 sm:h-52 rounded-xl overflow-hidden -mx-4 sm:mx-0">
          <img src={series.banner_url} alt="" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/60 to-transparent" />
        </div>
      )}

      {/* Header */}
      <div className="flex gap-5">
        {series.cover_url && (
          <button
            onClick={() => setPosterOpen(true)}
            className="hidden sm:block w-28 flex-shrink-0 -mt-16 relative z-10 focus:outline-none group"
            title="Zobrazit plakát"
          >
            <img
              src={series.cover_url}
              alt={series.title}
              className="w-full rounded-xl border border-border shadow-xl group-hover:border-accent transition-colors"
            />
          </button>
        )}
        <div className="flex flex-col gap-2 flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-text leading-tight">
              {series.title_romaji || series.title}
            </h1>
            {series.promoted && (
              <span className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-green-900/40 text-green-300 border border-green-700/50">
                <BadgeCheck size={13} className="text-green-400" />
                Publikováno
              </span>
            )}
            <WatchStatusButton
              status={series.watch_status}
              onChange={(s) => watchMutation.mutate(s)}
              isPending={watchMutation.isPending}
            />
          </div>
          {series.title_japanese && (
            <p className="text-muted text-sm">{series.title_japanese}</p>
          )}
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
            {series.year && <span>{series.year}</span>}
            {series.network && <span>{series.network}</span>}
            {series.runtime && <span>{series.runtime} min/ep</span>}
            {series.certification && <span className="border border-muted/30 px-1 rounded text-xs">{series.certification}</span>}
            {series.average_score > 0 && (
              <span className="flex items-center gap-1 text-yellow-400">
                <Star size={12} fill="currentColor" />
                {series.average_score.toFixed(1)}
                {series.rating_votes && <span className="text-muted text-xs">({series.rating_votes.toLocaleString()})</span>}
              </span>
            )}
            {series.status && <span className="capitalize">{series.status?.toLowerCase()}</span>}
            {series.size_on_disk_human && <span className="text-muted/60">💾 {series.size_on_disk_human}</span>}
          </div>
          {series.genres?.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {series.genres.map((g) => (
                <span key={g} className="text-xs bg-accent/10 text-accent px-2 py-0.5 rounded-full">{g}</span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Overview */}
      {series.overview && (
        <div className="bg-surface border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xs font-semibold text-text-dim uppercase tracking-wide">Popis</h2>
            {!series.overview_cs && (
              <button
                onClick={() => translateMutation.mutate()}
                disabled={translateMutation.isPending}
                className="flex items-center gap-1 text-xs text-accent hover:text-accent-hover disabled:opacity-50 transition-colors"
              >
                <Languages size={11} />
                {translateMutation.isPending ? "Překládám…" : "Přeložit"}
              </button>
            )}
          </div>
          <p className="text-sm text-text leading-relaxed">{series.overview}</p>
        </div>
      )}

      {/* ── Overseerr issue banner — shown prominently when series has an open issue ── */}
      {series.has_issue && (
        <div className="border border-orange-700/50 bg-orange-950/30 rounded-xl p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-orange-400 flex-shrink-0" />
            <p className="text-sm font-semibold text-orange-300">Otevřená issue v Overseerr</p>
            {overseerr?.overseerr_url && (
              <a href={overseerr.overseerr_url} target="_blank" rel="noreferrer"
                className="ml-auto text-orange-400/70 hover:text-orange-300 transition-colors flex items-center gap-1 text-xs">
                <ExternalLink size={12} /> Otevřít
              </a>
            )}
          </div>

          {/* Subtitle issues */}
          {overseerr?.subtitle_issues?.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs text-orange-400/70 font-semibold uppercase tracking-wide">
                Problémy s titulky ({overseerr.subtitle_issues.length})
              </p>
              {overseerr.subtitle_issues.map(issue => (
                <div key={issue.id} className="flex items-start gap-2 text-xs bg-black/20 rounded-lg px-3 py-2">
                  <span className={clsx("flex-shrink-0 mt-0.5 text-base leading-none",
                    issue.status === 1 ? "text-yellow-400" : "text-green-400")}>
                    {issue.status === 1 ? "●" : "✓"}
                  </span>
                  <span className="flex-1 text-text-dim leading-relaxed">
                    {issue.message || "Bez popisu"}
                    {issue.reported_by && <span className="text-muted ml-1">— {issue.reported_by}</span>}
                  </span>
                  <span className={clsx("flex-shrink-0 text-xs",
                    issue.status === 1 ? "text-yellow-500" : "text-green-600")}>
                    {issue.status_label}
                  </span>
                  {issue.overseerr_url && (
                    <a href={issue.overseerr_url} target="_blank" rel="noreferrer"
                      className="text-muted hover:text-accent flex-shrink-0">
                      <ExternalLink size={11} />
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Other open issues */}
          {overseerr?.other_issues?.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs text-orange-400/70 font-semibold uppercase tracking-wide">
                Ostatní problémy ({overseerr.other_issues.length})
              </p>
              {overseerr.other_issues.map(issue => (
                <div key={issue.id} className="flex items-center gap-2 text-xs bg-black/20 rounded-lg px-3 py-2">
                  <span className="text-muted flex-shrink-0">{issue.type_label}</span>
                  <span className="flex-1 text-text-dim truncate">{issue.message || "Bez popisu"}</span>
                  {issue.overseerr_url && (
                    <a href={issue.overseerr_url} target="_blank" rel="noreferrer"
                      className="text-muted hover:text-accent flex-shrink-0">
                      <ExternalLink size={11} />
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Fallback when issues not loaded yet / Overseerr not configured */}
          {!overseerr?.subtitle_issues?.length && !overseerr?.other_issues?.length && (
            <p className="text-xs text-orange-400/60">
              {overseerr?.overseerr_configured === false
                ? "Overseerr není nakonfigurován — detaily issue nejsou dostupné."
                : "Načítám detaily issue…"}
            </p>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2 items-center">
        <Tooltip text={"Automaticky prohledá Hiyori + HnS\na stáhne CZ titulky pro všechny\nepizody, které je ještě nemají.\n\nBěží na pozadí — průběh vidíš\nv Activity logu (ikona vlevo)."}>
          <button
            onClick={() => bulkMutation.mutate()}
            disabled={bulkMutation.isPending}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded-lg transition-colors"
          >
            {bulkMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
            Stáhnout chybějící CZ titulky
          </button>
        </Tooltip>
        <Tooltip text={"Spustí alass synchronizaci časování\npro všechny CZ titulky v celé sérii.\n\nOpraví posuny způsobené rozdílnými\nzdrojovými soubory.\nBěží na pozadí."}>
          <button
            onClick={() => syncSeriesMutation.mutate()}
            disabled={syncSeriesMutation.isPending}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-surface border border-border hover:border-accent text-muted hover:text-text rounded-lg transition-colors disabled:opacity-50"
          >
            {syncSeriesMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <Timer size={12} />}
            Sync časování CZ
          </button>
        </Tooltip>
        <Tooltip text={"Zapíše .nfo soubory vedle každého\nvideo souboru — série i epizody.\n\nEmby / Jellyfin použijí tyto soubory\npro zobrazení metadat, hodnocení,\nposteru a CZ popisu."}>
          <button
            onClick={() => nfoMutation.mutate()}
            disabled={nfoMutation.isPending}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-surface border border-border hover:border-accent text-muted hover:text-text rounded-lg transition-colors disabled:opacity-50"
          >
            {nfoMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />}
            Zapsat NFO (Emby/Jellyfin)
          </button>
        </Tooltip>
        <Tooltip text={"Zobrazí náhled .nfo souboru\nbez zápisu na disk.\n\nUkáže přesný obsah, který by\nbyl zapsán do tvrzení.nfo."}>
          <button
            onClick={handleNfoPreview}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-surface border border-border hover:border-accent text-muted hover:text-text rounded-lg transition-colors"
          >
            <Eye size={12} />
            Náhled NFO
          </button>
        </Tooltip>
        {/* Publish / demote */}
        {!series.promoted ? (
          <Tooltip text={"Přesune anime do složky anime_series\na přidá Sonarr tag 'tit'.\n\nPodmínky: všechny díly mají soubor\na 1. díl má CZ titulky.\nOdešle notifikaci do Discordu."}>
            <button
              onClick={() => publishMutation.mutate()}
              disabled={publishMutation.isPending || demoteMutation.isPending}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white rounded-lg transition-colors font-medium"
            >
              {publishMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <BadgeCheck size={12} />}
              Publikovat
            </button>
          </Tooltip>
        ) : (
          <Tooltip text={"Přesune anime zpět do složky\ninkomplete a odebere příznak publikace."}>
            <button
              onClick={() => demoteMutation.mutate()}
              disabled={demoteMutation.isPending || publishMutation.isPending}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-surface border border-green-700/50 hover:border-red-500/70 text-green-400 hover:text-red-400 disabled:opacity-50 rounded-lg transition-colors"
            >
              {demoteMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <FolderInput size={12} />}
              Přesunout do inkomplete
            </button>
          </Tooltip>
        )}

        {/* ── Delete subtitles by language (whole series) ── */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="flex items-center gap-1 text-xs text-muted/60 flex-shrink-0">
            <Filter size={10} />
            Jazyk:
          </div>
          <select
            value={deleteSubsLang}
            onChange={e => setDeleteSubsLang(e.target.value)}
            className="text-xs bg-surface border border-border hover:border-accent text-muted rounded px-1.5 py-1.5 focus:outline-none focus:border-accent transition-colors"
          >
            <option value="">Všechny jazyky</option>
            <option value="cs">CS – Čeština</option>
            <option value="en">EN – Angličtina</option>
            <option value="ja">JA – Japonština</option>
            <option value="de">DE – Němčina</option>
            <option value="fr">FR – Francouzština</option>
            <option value="pl">PL – Polština</option>
            <option value="sk">SK – Slovenština</option>
          </select>
          <Tooltip text={`Smaže ${deleteSubsLang ? deleteSubsLang.toUpperCase() + " " : ""}titulky u všech epizod v aktuálním pohledu${seasonFilter !== null ? ` (sezóna ${seasonFilter})` : ""}.`}>
            <button
              onClick={() => {
                const lang = deleteSubsLang;
                const label = lang ? `${lang.toUpperCase()} ` : "";
                const scope = seasonFilter !== null ? `sezóny ${seasonFilter}` : "celé série";
                const count = filteredEps.length;
                if (!window.confirm(`Smazat ${label}titulky u všech ${count} epizod ${scope}?`)) return;
                deleteAllSubsMutation.mutate({ lang, epIds: filteredEps.map(e => e.id) });
              }}
              disabled={deleteAllSubsMutation.isPending || filteredEps.length === 0}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-surface border border-red-800/40 hover:border-red-600/70 text-red-400/70 hover:text-red-300 disabled:opacity-40 rounded-lg transition-colors"
            >
              {deleteAllSubsMutation.isPending
                ? <Loader2 size={12} className="animate-spin" />
                : <Trash2 size={12} />}
              Smazat{deleteSubsLang ? ` ${deleteSubsLang.toUpperCase()}` : ""} titulky ({filteredEps.length})
            </button>
          </Tooltip>
        </div>

        {(bulkMsg || syncMsg || promoMsg) && (
          <span className={clsx(
            "text-xs px-2 py-1 rounded-lg",
            (bulkMsg || syncMsg || promoMsg).includes("Chyba")
              ? "text-red-400 bg-red-900/20"
              : "text-green-400 bg-green-900/20"
          )}>
            {promoMsg || bulkMsg || syncMsg}
          </span>
        )}
      </div>

      {/* Overseerr */}
      {overseerr?.overseerr_configured && (
        <div className="flex flex-col gap-3">
          {/* Request button + existing requests */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => overseerrMutation.mutate()}
              disabled={overseerrMutation.isPending}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-surface border border-border hover:border-accent text-muted hover:text-text rounded-lg transition-colors disabled:opacity-50"
            >
              {overseerrMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
              Požádat v Overseerr
            </button>

            {overseerr.existing_requests?.length > 0 && overseerr.existing_requests.map(req => (
              <span key={req.id} className={clsx(
                "flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border",
                req.status === 1 ? "bg-yellow-900/20 border-yellow-800/30 text-yellow-300"
                : req.status === 2 ? "bg-green-900/20 border-green-800/30 text-green-300"
                : "bg-surface border-border text-muted"
              )}>
                {req.status === 2 ? <CheckCircle2 size={10} /> : <Clock size={10} />}
                Overseerr: {req.status === 1 ? "čeká na schválení" : req.status === 2 ? "schváleno" : "zpracovává se"}
              </span>
            ))}

            {overseerrMsg && (
              <span className={clsx("text-xs px-2 py-1 rounded-lg",
                overseerrMsg.includes("Chyba") ? "text-red-400 bg-red-900/20" : "text-green-400 bg-green-900/20"
              )}>
                {overseerrMsg}
              </span>
            )}
          </div>

          {/* Subtitle issues */}
          {overseerr.subtitle_issues?.length > 0 && (
            <div className="bg-yellow-900/10 border border-yellow-800/30 rounded-xl p-4 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <AlertTriangle size={14} className="text-yellow-400" />
                <p className="text-xs font-semibold text-yellow-300 uppercase tracking-wide">
                  Nahlášené problémy s titulky ({overseerr.subtitle_issues.length})
                </p>
              </div>
              {overseerr.subtitle_issues.map(issue => (
                <div key={issue.id} className="flex items-start gap-2 text-xs">
                  <span className={clsx("flex-shrink-0 mt-0.5", issue.status === 1 ? "text-yellow-400" : "text-green-400")}>
                    {issue.status === 1 ? "●" : "✓"}
                  </span>
                  <span className="flex-1 text-text-dim">
                    {issue.message || "Bez popisu"}
                    {issue.reported_by && <span className="text-muted ml-1">— {issue.reported_by}</span>}
                  </span>
                  <span className={clsx("flex-shrink-0", issue.status === 1 ? "text-yellow-500" : "text-green-600")}>
                    {issue.status_label}
                  </span>
                  {issue.overseerr_url && (
                    <a href={issue.overseerr_url} target="_blank" rel="noreferrer"
                      className="text-muted hover:text-accent flex-shrink-0" title="Otevřít v Overseerr">
                      <ExternalLink size={11} />
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Other open issues */}
          {overseerr.other_issues?.length > 0 && (
            <div className="bg-surface border border-border rounded-xl p-3 flex flex-col gap-1.5">
              <p className="text-xs font-semibold text-text-dim uppercase tracking-wide">
                Ostatní nahlášené problémy ({overseerr.other_issues.length})
              </p>
              {overseerr.other_issues.map(issue => (
                <div key={issue.id} className="flex items-center gap-2 text-xs">
                  <span className="text-muted flex-shrink-0">{issue.type_label}</span>
                  <span className="flex-1 text-text-dim truncate">{issue.message || "Bez popisu"}</span>
                  {issue.overseerr_url && (
                    <a href={issue.overseerr_url} target="_blank" rel="noreferrer"
                      className="text-muted hover:text-accent flex-shrink-0">
                      <ExternalLink size={11} />
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* NFO preview modal */}
      {nfoPreviewOpen && nfoPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onClick={() => setNfoPreviewOpen(false)}>
          <div className="bg-surface border border-border rounded-xl w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h3 className="text-sm font-semibold text-text">tvshow.nfo — náhled</h3>
              <span className="text-xs text-muted truncate ml-2 flex-1 text-right">{nfoPreview.path}</span>
              <button onClick={() => setNfoPreviewOpen(false)} className="ml-3 text-muted hover:text-text text-lg leading-none">×</button>
            </div>
            <pre className="overflow-auto p-4 text-xs font-mono text-text-dim leading-relaxed flex-1 whitespace-pre-wrap">
              {nfoPreview.content}
            </pre>
          </div>
        </div>
      )}

      {/* Tags */}
      {series.tags?.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {series.tags.slice(0, 12).map((t) => (
            <span key={t} className="text-xs bg-border text-text-dim px-2 py-0.5 rounded-full">
              {t}
            </span>
          ))}
        </div>
      )}

      {/* ── Sonarr management ─────────────────────────────────────────────── */}
      <div className="bg-surface border border-border rounded-xl p-4 flex flex-col gap-3">
        <h2 className="text-xs font-semibold text-text-dim uppercase tracking-wide">Správa Sonarr</h2>

        {/* Sonarr tags */}
        <div className="flex items-start gap-3">
          <Tag size={14} className="text-muted flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted mb-1">Sonarr tagy</p>
            <div className="flex flex-wrap items-center gap-1.5">
              {(series.sonarr_tags?.length > 0)
                ? series.sonarr_tags.map(t => (
                    <span key={t} className="text-xs bg-accent/10 text-accent px-2 py-0.5 rounded-full border border-accent/20">{t}</span>
                  ))
                : <span className="text-xs text-muted/50 italic">žádné tagy</span>
              }
              <button
                onClick={openTagEditor}
                className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border border-border text-muted hover:border-accent hover:text-text transition-colors"
              >
                <Pencil size={10} /> Upravit
              </button>
            </div>
          </div>
        </div>

        {/* Root folder */}
        <div className="flex items-start gap-3">
          <FolderOpen size={14} className="text-muted flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted mb-1">Kořenová složka</p>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-mono text-text-dim truncate max-w-xs">{series.path || "—"}</span>
              <button
                onClick={() => setFolderEditorOpen(true)}
                className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border border-border text-muted hover:border-accent hover:text-text transition-colors"
              >
                <Pencil size={10} /> Změnit
              </button>
            </div>
          </div>
        </div>

        {sonarrMsg && (
          <p className={clsx("text-xs px-2 py-1 rounded-lg",
            sonarrMsg.includes("Chyba") ? "bg-red-900/20 text-red-400" : "bg-green-900/20 text-green-400"
          )}>{sonarrMsg}</p>
        )}
      </div>

      {/* Tag editor modal */}
      {tagEditorOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70"
          onClick={() => setTagEditorOpen(false)}>
          <div className="bg-surface border border-border rounded-xl w-full max-w-sm flex flex-col max-h-[80vh]"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
              <h3 className="text-sm font-semibold text-text">Upravit Sonarr tagy</h3>
              <button onClick={() => setTagEditorOpen(false)} className="text-muted hover:text-text text-lg leading-none">×</button>
            </div>
            <div className="overflow-y-auto p-4 flex flex-col gap-2 flex-1">
              {allTags.length === 0 && (
                <p className="text-xs text-muted text-center py-4">
                  <Loader2 size={14} className="animate-spin inline mr-1" />
                  Načítám tagy ze Sonarr…
                </p>
              )}
              <TagCheckboxList
                allTags={allTags}
                seriesTags={series.sonarr_tags || []}
                selectedTagIds={selectedTagIds}
                setSelectedTagIds={setSelectedTagIds}
              />
            </div>
            <div className="px-4 py-3 border-t border-border flex gap-2 justify-end flex-shrink-0">
              <button onClick={() => setTagEditorOpen(false)}
                className="text-xs px-3 py-1.5 bg-surface border border-border text-muted hover:text-text rounded-lg transition-colors">
                Zrušit
              </button>
              <button
                onClick={() => tagsMutation.mutate()}
                disabled={tagsMutation.isPending || selectedTagIds === null}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded-lg transition-colors"
              >
                {tagsMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : null}
                Uložit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Root folder editor modal */}
      {folderEditorOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70"
          onClick={() => setFolderEditorOpen(false)}>
          <div className="bg-surface border border-border rounded-xl w-full max-w-sm flex flex-col"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h3 className="text-sm font-semibold text-text">Změnit kořenovou složku</h3>
              <button onClick={() => setFolderEditorOpen(false)} className="text-muted hover:text-text text-lg leading-none">×</button>
            </div>
            <div className="p-4 flex flex-col gap-3">
              {rootFolders.length === 0
                ? <p className="text-xs text-muted text-center py-4">
                    <Loader2 size={14} className="animate-spin inline mr-1" />
                    Načítám složky ze Sonarr…
                  </p>
                : rootFolders.map(f => (
                  <button
                    key={f.id}
                    onClick={() => folderMutation.mutate(f.path)}
                    disabled={folderMutation.isPending || f.path === series.path}
                    className={clsx(
                      "flex items-start gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors disabled:opacity-50",
                      f.path === series.path
                        ? "bg-accent/10 border-accent"
                        : "bg-bg border-border hover:border-accent"
                    )}
                  >
                    <FolderOpen size={14} className={clsx("flex-shrink-0 mt-0.5", f.path === series.path ? "text-accent" : "text-muted")} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-mono text-text truncate">{f.path}</p>
                      {f.freeSpace > 0 && (
                        <p className="text-xs text-muted mt-0.5">
                          Volné: {(f.freeSpace / 1024 / 1024 / 1024).toFixed(1)} GB
                        </p>
                      )}
                    </div>
                    {f.path === series.path && (
                      <CheckCircle2 size={14} className="text-accent flex-shrink-0 mt-0.5" />
                    )}
                    {folderMutation.isPending && (
                      <Loader2 size={14} className="animate-spin text-muted flex-shrink-0 mt-0.5" />
                    )}
                  </button>
                ))
              }
            </div>
          </div>
        </div>
      )}

      {/* Episodes section */}
      <div>
        {/* Header: title + season filter + multi-select toggle */}
        <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold text-text">
              Epizody
              {episodes.length > 0 && (
                <span className="text-muted text-sm font-normal ml-2">({filteredEps.length})</span>
              )}
            </h2>
            {/* Multi-select toggle */}
            {episodes.length > 0 && (
              <button
                onClick={() => selectMode ? exitSelectMode() : setSelectMode(true)}
                title={selectMode ? "Zrušit výběr" : "Vybrat epizody"}
                className={clsx(
                  "flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border transition-colors",
                  selectMode
                    ? "bg-accent/10 border-accent text-accent"
                    : "bg-surface border-border text-muted hover:border-accent hover:text-text"
                )}
              >
                {selectMode ? <CheckSquare size={12} /> : <Square size={12} />}
                {selectMode ? "Zrušit" : "Vybrat"}
              </button>
            )}
          </div>

          {/* Season filter */}
          {seasons.length > 1 && (
            <div className="flex gap-1.5 flex-wrap">
              <button
                onClick={() => setSeasonFilter(null)}
                className={clsx(
                  "text-xs px-2.5 py-1 rounded-full border transition-colors",
                  seasonFilter === null
                    ? "bg-accent border-accent text-white"
                    : "bg-surface border-border text-muted hover:border-accent"
                )}
              >
                Vše
              </button>
              {seasons.map(s => (
                <button
                  key={s}
                  onClick={() => setSeasonFilter(s)}
                  className={clsx(
                    "text-xs px-2.5 py-1 rounded-full border transition-colors",
                    seasonFilter === s
                      ? "bg-accent border-accent text-white"
                      : "bg-surface border-border text-muted hover:border-accent"
                  )}
                >
                  S{String(s).padStart(2, "0")}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Bulk action bar — shown when selectMode is active */}
        {selectMode && (
          <div className="mb-3 flex flex-col gap-2 bg-surface border border-border rounded-xl px-4 py-3">
            {/* Row 1: count + selection shortcuts */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted flex-shrink-0">
                Vybráno: <span className="text-text font-semibold">{selectedEpisodes.size}</span>
              </span>
              <button
                onClick={() => selectAll(filteredWithFile)}
                className="text-xs px-2.5 py-1 bg-surface border border-border hover:border-accent text-muted hover:text-text rounded-lg transition-colors"
              >
                Vše se souborem ({filteredWithFile.length})
              </button>
              <button
                onClick={() => selectAll(filteredEps.filter(e => e.has_file && !e.has_cs_sub))}
                className="text-xs px-2.5 py-1 bg-surface border border-border hover:border-accent text-muted hover:text-text rounded-lg transition-colors"
              >
                Bez CZ titulku ({filteredEps.filter(e => e.has_file && !e.has_cs_sub).length})
              </button>
              <button
                onClick={clearSelection}
                disabled={selectedEpisodes.size === 0}
                className="text-xs px-2.5 py-1 bg-surface border border-border hover:border-accent text-muted hover:text-text rounded-lg transition-colors disabled:opacity-40"
              >
                Odznačit vše
              </button>
              <div className="flex-1" />
              <button
                onClick={exitSelectMode}
                className="p-1.5 text-muted hover:text-text rounded-lg transition-colors"
                title="Zavřít výběr"
              >
                <X size={14} />
              </button>
            </div>
            {/* Row 2: bulk action buttons */}
            <div className="flex flex-wrap gap-2 pt-0.5 border-t border-border">
              <button
                onClick={() => dlBulkMutation.mutate()}
                disabled={selectedEpisodes.size === 0 || dlBulkMutation.isPending}
                title="Stáhnout nejlepší CZ titulky pro vybrané epizody"
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-accent hover:bg-accent-hover disabled:opacity-40 text-white rounded-lg transition-colors"
              >
                {dlBulkMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                Stáhnout titulky ({selectedEpisodes.size})
              </button>
              <button
                onClick={() => syncBulkMutation.mutate()}
                disabled={selectedEpisodes.size === 0 || syncBulkMutation.isPending}
                title="Srovnat časování CZ titulků u vybraných epizod pomocí alass"
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-surface border border-border hover:border-accent text-muted hover:text-text disabled:opacity-40 rounded-lg transition-colors"
              >
                {syncBulkMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <Timer size={12} />}
                Sync časování ({selectedEpisodes.size})
              </button>
              <button
                onClick={() => nfoBulkMutation.mutate()}
                disabled={selectedEpisodes.size === 0 || nfoBulkMutation.isPending}
                title="Zapsat NFO metadata pro vybrané epizody"
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-surface border border-border hover:border-accent text-muted hover:text-text disabled:opacity-40 rounded-lg transition-colors"
              >
                {nfoBulkMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />}
                Zapsat NFO ({selectedEpisodes.size})
              </button>
              <button
                onClick={() => {
                  const lang = deleteSubsLang;
                  const label = lang ? `${lang.toUpperCase()} ` : "";
                  if (!window.confirm(`Smazat ${label}titulky u ${selectedEpisodes.size} vybraných epizod?`)) return;
                  deleteSubsMutation.mutate();
                }}
                disabled={selectedEpisodes.size === 0 || deleteSubsMutation.isPending}
                title={`Smazat ${deleteSubsLang ? deleteSubsLang.toUpperCase() + " " : ""}titulky u vybraných epizod (jazyk vybraný v filtru výše)`}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-red-900/30 hover:bg-red-800/40 border border-red-800/50 text-red-300 hover:text-red-200 disabled:opacity-40 rounded-lg transition-colors"
              >
                {deleteSubsMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                Smazat{deleteSubsLang ? ` ${deleteSubsLang.toUpperCase()}` : ""} titulky ({selectedEpisodes.size})
              </button>
            </div>
          </div>
        )}

        {epsLoading && (
          <div className="flex items-center gap-2 text-muted text-sm py-6">
            <Loader2 size={14} className="animate-spin" /> Načítám epizody…
          </div>
        )}

        {!epsLoading && episodes.length === 0 && (
          <div className="text-muted text-sm bg-surface border border-border rounded-xl p-6 text-center">
            Epizody nejsou k dispozici. Spusť Sync ze Sonarr.
          </div>
        )}

        {filteredEps.length > 0 && (
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            {filteredEps.map((ep) => (
              <EpisodeRow
                key={ep.id}
                episode={ep}
                seriesId={id}
                seriesCoverUrl={series?.cover_url || series?.poster_url}
                selected={selectedEpisodes.has(ep.id)}
                onToggle={selectMode ? toggleEpisode : undefined}
              />
            ))}
          </div>
        )}
      </div>

      {/* Poster lightbox */}
      {posterOpen && series.cover_url && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          onClick={() => setPosterOpen(false)}
        >
          <div className="relative max-h-[90vh]" onClick={e => e.stopPropagation()}>
            <img
              src={series.poster_url || series.cover_url}
              alt={series.title}
              className="max-h-[85vh] max-w-[90vw] rounded-2xl shadow-2xl object-contain"
            />
            <button
              onClick={() => setPosterOpen(false)}
              className="absolute -top-3 -right-3 bg-surface border border-border rounded-full p-1.5 text-muted hover:text-text transition-colors shadow-lg"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
