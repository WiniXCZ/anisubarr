// Not imported anywhere — SeriesDetail.jsx uses its own local EpisodeRow (different props/layout).
import { memo, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown, ChevronRight, Download, Search, Loader2,
  CheckCircle2, XCircle, Film, FolderOpen, Upload, Eye, EyeOff,
  Timer, Trash2, Scissors, HardDrive, Cpu, Volume2, Clock, Calendar,
  Tag, ExternalLink, MoreVertical, Pencil, FileText, Play,
} from "lucide-react";
import clsx from "clsx";
import Tooltip from "./Tooltip";
import { useT } from "../i18n/I18nContext";
import {
  searchSubtitles, downloadSubtitle, downloadBest,
  getEpisodeSubs, extractAllSubtitles,
  getEpisodeSubFiles, uploadSubtitle, setEpisodeWatched,
  syncEpisodeTiming, deleteSubsBulk, stripEmbeddedSubs, deleteDiskFile,
} from "../api/client";

// Display names for language codes — UI chrome, translated per active
// language. Built from t() rather than a module-level const because it
// needs the active dictionary; call once per component via getLangNames(t).
function getLangNames(t) {
  const cs = t("epr_lang_cs");
  return {
    cs, en: t("epr_lang_en"), ja: t("epr_lang_ja"), de: t("epr_lang_de"),
    fr: t("epr_lang_fr"), es: t("epr_lang_es"), pl: t("epr_lang_pl"), sk: t("epr_lang_sk"),
    hu: t("epr_lang_hu"), it: t("epr_lang_it"), pt: t("epr_lang_pt"), ru: t("epr_lang_ru"),
    uk: t("epr_lang_uk"), zh: t("epr_lang_zh"), ko: t("epr_lang_ko"),
    cze: cs, ces: cs, cz: cs,
  };
}

const LANG_CODES = {
  "czech": "cs", "čeština": "cs", "ces": "cs", "cze": "cs", "cz": "cs",
  "english": "en", "angličtina": "en",
  "japanese": "ja", "japonština": "ja",
  "german": "de", "němčina": "de",
  "french": "fr", "francouzština": "fr",
  "spanish": "es", "španělština": "es",
  "polish": "pl", "polština": "pl",
  "slovak": "sk", "slovenština": "sk",
  "hungarian": "hu", "maďarština": "hu",
  "italian": "it", "italština": "it",
  "portuguese": "pt", "portugalština": "pt",
  "russian": "ru", "ruština": "ru",
  "ukrainian": "uk", "ukrajinština": "uk",
  "chinese": "zh", "čínština": "zh",
  "korean": "ko", "korejština": "ko",
};

// Display labels for subtitle sources — provider brand names (Hiyori, HnS,
// Kamui, GenSubs, MKV) are proper nouns and stay as-is; the rest are UI
// chrome and go through t(). Call once per component via getSourceLabelMeta(t).
function getSourceLabelMeta(t) {
  return {
    hiyori:  "Hiyori",
    hns:     "HnS",
    kamui:   "Kamui",
    gensubs: "GenSubs",
    direct:  t("epr_source_direct"),
    upload:  t("epr_source_upload"),
    embedded:"MKV",
    disk:    t("lib_stat_on_disk"),
  };
}

const SOURCE_STYLE = {
  hiyori:  "bg-purple-900/40 text-purple-300 border-purple-800/40",
  hns:     "bg-blue-900/40   text-blue-300   border-blue-800/40",
  kamui:   "bg-pink-900/40   text-pink-300   border-pink-800/40",
  gensubs: "bg-teal-900/40   text-teal-300   border-teal-800/40",
  direct:  "bg-orange-900/40 text-orange-300 border-orange-800/40",
  upload:  "bg-green-900/40  text-green-300  border-green-800/40",
  embedded:"bg-gray-800/60   text-gray-400   border-gray-700/40",
  disk:    "bg-gray-800/60   text-gray-400   border-gray-700/40",
};

function parseEmbeddedLangs(subtitlesInFile) {
  if (!subtitlesInFile) return [];
  return subtitlesInFile
    .split(/[,/]+/)
    .map(s => {
      const trimmed = s.trim();
      const code = LANG_CODES[trimmed.toLowerCase()];
      return code || (trimmed.length <= 3 ? trimmed.toLowerCase() : trimmed);
    })
    .filter(Boolean);
}

function langName(code, langNames) {
  return langNames[code?.toLowerCase()] || code?.toUpperCase() || "?";
}

// ── Upload panel ──────────────────────────────────────────────────────────────

function UploadPanel({ episodeId, onSuccess }) {
  const t = useT();
  const [lang, setLang]       = useState("cs");
  const [file, setFile]       = useState(null);
  const [error, setError]     = useState("");
  const fileRef               = useRef(null);

  const { mutate, isPending } = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append("episode_id", episodeId);
      fd.append("language", lang);
      fd.append("file", file);
      return uploadSubtitle(fd);
    },
    onSuccess: () => { setFile(null); setError(""); onSuccess(); },
    onError: (e) => setError(e?.response?.data?.detail || t("epr_upload_error")),
  });

  const langNames = getLangNames(t);

  return (
    <div className="flex flex-wrap items-center gap-2 bg-bg border border-border rounded-lg px-3 py-2">
      <select
        value={lang}
        onChange={e => setLang(e.target.value)}
        className="bg-surface border border-border rounded px-2 py-1 text-xs text-text focus:outline-none focus:border-accent"
      >
        {Object.entries(langNames).filter(([c]) => c.length === 2).map(([code, name]) => (
          <option key={code} value={code}>{code} · {name}</option>
        ))}
      </select>
      <input ref={fileRef} type="file" accept=".srt,.ass,.ssa,.vtt,.sub" className="hidden"
        onChange={e => setFile(e.target.files[0] || null)} />
      <button onClick={() => fileRef.current?.click()}
        className="flex items-center gap-1 text-xs px-2.5 py-1 bg-surface border border-border hover:border-accent text-muted hover:text-text rounded-lg transition-colors">
        <FolderOpen size={11} />
        {file ? file.name : t("epr_select_file")}
      </button>
      <button onClick={() => mutate()} disabled={!file || isPending}
        className="flex items-center gap-1 text-xs px-3 py-1 bg-accent hover:bg-accent-hover disabled:opacity-40 text-white rounded-lg transition-colors">
        {isPending ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
        {t("epr_upload_btn")}
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  );
}

// ── Language badge colours ────────────────────────────────────────────────────

const LANG_BADGE = {
  cs:  "bg-accent/20 text-accent border-accent/40",
  cze: "bg-accent/20 text-accent border-accent/40",
  ces: "bg-accent/20 text-accent border-accent/40",
  cz:  "bg-accent/20 text-accent border-accent/40",
  en:  "bg-blue-900/30 text-blue-300 border-blue-700/40",
  ja:  "bg-red-900/30 text-red-300 border-red-700/40",
  de:  "bg-amber-900/30 text-amber-300 border-amber-700/40",
  fr:  "bg-indigo-900/30 text-indigo-300 border-indigo-700/40",
  es:  "bg-yellow-900/30 text-yellow-300 border-yellow-700/40",
  pl:  "bg-rose-900/30 text-rose-300 border-rose-700/40",
  sk:  "bg-cyan-900/30 text-cyan-300 border-cyan-700/40",
  hu:  "bg-orange-900/30 text-orange-300 border-orange-700/40",
  it:  "bg-lime-900/30 text-lime-300 border-lime-700/40",
  pt:  "bg-teal-900/30 text-teal-300 border-teal-700/40",
  ru:  "bg-purple-900/30 text-purple-300 border-purple-700/40",
  uk:  "bg-yellow-900/30 text-yellow-200 border-yellow-600/40",
  zh:  "bg-pink-900/30 text-pink-300 border-pink-700/40",
  ko:  "bg-violet-900/30 text-violet-300 border-violet-700/40",
};

function LangBadge({ lang }) {
  const code = lang?.toLowerCase() || "?";
  const cls = LANG_BADGE[code] ?? "bg-surface text-muted border-border";
  const display = code.length <= 3 ? code.toUpperCase() : code.slice(0, 3).toUpperCase();
  return (
    <span className={clsx(
      "inline-flex items-center justify-center text-[10px] font-bold px-1.5 py-0.5 rounded border flex-shrink-0 min-w-[28px]",
      cls
    )}>
      {display}
    </span>
  );
}

// ── Subtitle row with hover menu ──────────────────────────────────────────────

function SubRow({
  id,         // unique key for bulk selection (string prefix + id)
  rawId,      // actual ID for operations (DB sub id, or file path)
  lang,
  label,      // display name / filename
  source,     // source key (hiyori, hns, disk, embedded, …)
  isDbSub,    // true → deletable from DB
  isDiskFile, // true → disk file (physical delete)
  filePath,   // path to .srt file (for editor)
  selected,
  onToggle,
  onDelete,
  onSync,
  onOpenEditor,
  canSync,
}) {
  const t = useT();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  const langNames = getLangNames(t);
  const sourceLabelMeta = getSourceLabelMeta(t);
  const sourceKey = sourceLabelMeta[source] ?? source;
  const sourceStyle = SOURCE_STYLE[source] ?? "bg-surface text-muted border-border";
  const isCs = lang === "cs" || lang === "cze" || lang === "ces" || lang === "cz";
  const hasCheckbox = isDbSub || isDiskFile;

  return (
    <div className={clsx(
      "group flex items-center gap-2.5 px-3 py-2 border-b border-border/40 last:border-0 transition-colors",
      selected ? "bg-accent/5" : "hover:bg-white/[0.025]",
    )}>
      {/* Checkbox */}
      {hasCheckbox ? (
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          onClick={e => e.stopPropagation()}
          className="w-3.5 h-3.5 rounded cursor-pointer flex-shrink-0 accent-accent"
        />
      ) : (
        <span className="w-3.5 flex-shrink-0" />
      )}

      {/* Language badge pill */}
      <LangBadge lang={lang} />

      {/* Full language name */}
      <span className={clsx(
        "text-xs font-medium flex-shrink-0 w-20 truncate",
        isCs ? "text-accent" : "text-text/80"
      )}>
        {langName(lang, langNames)}
      </span>

      {/* Filename / title */}
      <span className="flex-1 min-w-0 text-[11px] text-muted/60 font-mono truncate leading-none" title={label}>
        {label}
      </span>

      {/* Source badge */}
      <span className={clsx(
        "text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase flex-shrink-0 tracking-wide",
        sourceStyle,
      )}>
        {sourceKey}
      </span>

      {/* Actions — appear on hover */}
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
        {filePath && (
          <Tooltip text={t("epr_open_in_sub_editor_tooltip")} placement="top">
            <button
              onClick={() => onOpenEditor(filePath)}
              className="p-1 rounded text-muted hover:text-accent hover:bg-accent/10 transition-colors"
            >
              <Pencil size={12} />
            </button>
          </Tooltip>
        )}
        {(isDbSub || isDiskFile || canSync) && (
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(o => !o)}
              className="p-1 rounded text-muted hover:text-text hover:bg-surface transition-colors"
            >
              <MoreVertical size={12} />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-1 z-50 bg-surface border border-border rounded-lg shadow-xl min-w-[150px] py-1 text-xs">
                  {filePath && (
                    <button
                      className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-white/5 text-text"
                      onClick={() => { setMenuOpen(false); onOpenEditor(filePath); }}
                    >
                      <Pencil size={12} /> {t("epr_edit_menu_item")}
                    </button>
                  )}
                  {canSync && (
                    <button
                      className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-white/5 text-text"
                      onClick={() => { setMenuOpen(false); onSync?.(); }}
                    >
                      <Timer size={12} /> {t("epr_sync_timing_menu_item")}
                    </button>
                  )}
                  {isDbSub && (
                    <button
                      className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-red-900/20 text-red-400"
                      onClick={() => { setMenuOpen(false); onDelete?.(); }}
                    >
                      <Trash2 size={12} /> {t("epr_delete_db_btn")}
                    </button>
                  )}
                  {isDiskFile && (
                    <button
                      className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-red-900/20 text-red-400"
                      onClick={() => {
                        setMenuOpen(false);
                        if (window.confirm(t("epr_delete_disk_file_confirm"))) {
                          onDelete?.();
                        }
                      }}
                    >
                      <Trash2 size={12} /> {t("epr_delete_file_menu_item")}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Group header ──────────────────────────────────────────────────────────────

function GroupHeader({ label, count, allSelected, onSelectAll }) {
  return (
    <div className="flex items-center gap-2 px-4 py-1.5 bg-bg/60 border-b border-border/40">
      {onSelectAll && (
        <input
          type="checkbox"
          checked={allSelected}
          onChange={onSelectAll}
          className="w-3 h-3 rounded cursor-pointer accent-accent flex-shrink-0"
        />
      )}
      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted/60">{label}</span>
      {count != null && (
        <span className="text-[10px] text-muted/40 ml-auto">{count}</span>
      )}
    </div>
  );
}

// ── EpisodeRow ────────────────────────────────────────────────────────────────

const EpisodeRow = memo(function EpisodeRow({ episode, seriesId, seriesCoverUrl, selected = false, onToggle }) {
  const navigate = useNavigate();
  const t = useT();
  const [open,              setOpen]              = useState(false);
  const [showUpload,        setShowUpload]        = useState(false);
  const [syncMsg,           setSyncMsg]           = useState("");
  const [stripMsg,          setStripMsg]          = useState("");
  const [selectedSubs,      setSelectedSubs]      = useState(new Set());
  const [selectedDiskPaths, setSelectedDiskPaths] = useState(new Set());
  const [autoSync,          setAutoSync]          = useState(false);
  const [imgError,          setImgError]          = useState(false);
  const [dlMsg,             setDlMsg]             = useState("");
  const qc = useQueryClient();

  // ── Helpers ────────────────────────────────────────────────────────────────

  function mkSelKey(type, id) { return `${type}:${id}`; }

  function toggleSub(key) {
    setSelectedSubs(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function selectGroup(keys, allSelected) {
    setSelectedSubs(prev => {
      const next = new Set(prev);
      if (allSelected) keys.forEach(k => next.delete(k));
      else keys.forEach(k => next.add(k));
      return next;
    });
  }

  // ── Mutations ──────────────────────────────────────────────────────────────

  const _invalidate = () => {
    qc.invalidateQueries(["subs", episode.id]);
    qc.invalidateQueries({ queryKey: ["episodes", String(seriesId)] });
    qc.invalidateQueries({ queryKey: ["subfiles", episode.id] });
  };

  const deleteSubsMutation = useMutation({
    mutationFn: (ids) => deleteSubsBulk(ids),
    onSuccess: () => { setSelectedSubs(new Set()); _invalidate(); },
  });

  const deleteDiskMutation = useMutation({
    mutationFn: async (paths) => {
      for (const p of paths) await deleteDiskFile(p);
    },
    onSuccess: () => { setSelectedDiskPaths(new Set()); _invalidate(); },
  });

  const watchedMutation = useMutation({
    mutationFn: (val) => setEpisodeWatched(seriesId, episode.id, val),
    onSuccess: (res) => {
      qc.setQueryData(["episodes", String(seriesId)], old =>
        old?.map(ep => ep.id === episode.id ? { ...ep, watched: res.data.watched } : ep)
      );
    },
  });

  const syncMutation = useMutation({
    mutationFn: () => syncEpisodeTiming(episode.id),
    onSuccess: (res) => {
      const d = res.data;
      setSyncMsg(d.status === "ok" ? `✓ ${d.message}` : d.status === "skipped" ? `— ${d.message}` : `✗ ${d.message}`);
      setTimeout(() => setSyncMsg(""), 6000);
    },
    onError: (e) => {
      setSyncMsg(`✗ ${e?.response?.data?.detail || t("files_state_error")}`);
      setTimeout(() => setSyncMsg(""), 6000);
    },
  });

  const stripMutation = useMutation({
    mutationFn: () => stripEmbeddedSubs(episode.id),
    onSuccess: (res) => {
      const n = res.data?.tracks_removed ?? 0;
      setStripMsg(n > 0 ? `✓ ${t("epr_strip_removed_prefix")} ${n} ${t("epr_strip_removed_suffix")}` : `— ${t("epr_strip_none")}`);
      setTimeout(() => setStripMsg(""), 6000);
      qc.invalidateQueries({ queryKey: ["episodes", String(seriesId)] });
    },
    onError: (e) => {
      setStripMsg(`✗ ${e?.response?.data?.detail || t("files_state_error")}`);
      setTimeout(() => setStripMsg(""), 6000);
    },
  });

  const { data: subs, isLoading: subsLoading } = useQuery({
    queryKey: ["subs", episode.id],
    queryFn: () => getEpisodeSubs(episode.id).then(r => r.data),
    enabled: open,
  });

  const { data: searchData, isLoading: searching, mutate: doSearch } = useMutation({
    mutationFn: () => searchSubtitles({ episode_id: episode.id }),
  });

  const { isPending: downloading, mutate: doDownloadBest } = useMutation({
    mutationFn: () => downloadBest({ episode_id: episode.id }),
    onSuccess: (res) => {
      _invalidate();
      const d = res.data || {};
      const msgs = [];
      if (d.warning) msgs.push(`⚠️ ${d.warning}`);
      if (d.language_warning) msgs.push(`⚠️ ${d.language_warning}`);
      setDlMsg(msgs.join("\n") || `✓ ${t("epr_sub_downloaded")}`);
      setTimeout(() => setDlMsg(""), 8000);
    },
    onError: (e) => {
      setDlMsg(`✗ ${e?.response?.data?.detail || t("sd_no_subs_found_results")}`);
      setTimeout(() => setDlMsg(""), 8000);
    },
  });

  const { mutate: doDownload, isPending: dlPending } = useMutation({
    mutationFn: (result) => downloadSubtitle({
      episode_id: episode.id,
      source: result.source,
      url: result.url,
      title: result.title,
      language: result.language,
      auto_sync: autoSync,
    }),
    onSuccess: (res) => {
      _invalidate();
      const d = res.data || {};
      const msgs = [];
      if (d.warning) msgs.push(`⚠️ ${d.warning}`);
      if (d.language_warning) msgs.push(`⚠️ ${d.language_warning}`);
      setDlMsg(msgs.join("\n") || `✓ ${t("epr_sub_downloaded")}`);
      setTimeout(() => setDlMsg(""), 8000);
    },
    onError: (e) => {
      setDlMsg(`✗ ${e?.response?.data?.detail || t("sd_download_error_fallback")}`);
      setTimeout(() => setDlMsg(""), 8000);
    },
  });

  const { data: diskFiles, isLoading: filesLoading } = useQuery({
    queryKey: ["subfiles", episode.id],
    queryFn: () => getEpisodeSubFiles(episode.id).then(r => r.data),
    enabled: open,
  });

  // ── Computed values ────────────────────────────────────────────────────────

  const langNames = getLangNames(t);
  const sourceLabelMeta = getSourceLabelMeta(t);
  const ep_code = `S${String(episode.season_number).padStart(2,"0")}E${String(episode.episode_number).padStart(2,"0")}`;
  const hasFile = episode.has_file;
  const isMissing = episode.monitored && !hasFile;
  const absNum = episode.absolute_episode_number;
  const embeddedLangs = parseEmbeddedLangs(episode.subtitles_in_file);
  const showCover = seriesCoverUrl && !imgError;

  // Group DB subs by source
  const subsBySource = {};
  (subs || []).forEach(s => {
    const src = s.source || "direct";
    if (!subsBySource[src]) subsBySource[src] = [];
    subsBySource[src].push(s);
  });

  // Disk files from filesystem scan
  const diskFileList = diskFiles?.files_with_lang || diskFiles?.files?.map(f => ({
    path: f,
    lang: (diskFiles.languages || []).find(l =>
      f.toLowerCase().includes(`.${l}.`) || f.toLowerCase().endsWith(`.${l}.srt`)
    ) || "?",
  })) || [];

  // ── Editor navigation ──────────────────────────────────────────────────────

  function openInEditor(filePath) {
    navigate(`/subtitles?series_id=${seriesId}&episode_id=${episode.id}${filePath ? `&sub_path=${encodeURIComponent(filePath)}` : ""}`);
  }

  // Bulk delete of DB subs
  const selectedDbIds = [...selectedSubs]
    .filter(k => k.startsWith("db:"))
    .map(k => parseInt(k.split(":")[1], 10));

  // ── Header row ─────────────────────────────────────────────────────────────

  return (
    <div className={clsx(
      "border-b border-border last:border-0",
      isMissing && "bg-red-950/10",
      selected && "bg-accent/5",
    )}>
      <div className="flex items-center hover:bg-white/[0.02] transition-colors">
        {onToggle && (
          <label className="pl-3 py-3 pr-1 flex-shrink-0 cursor-pointer" onClick={e => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={selected}
              onChange={() => onToggle(episode.id)}
              className="w-3.5 h-3.5 rounded cursor-pointer"
            />
          </label>
        )}
        <button
          onClick={() => setOpen(o => !o)}
          className="flex-1 flex items-center gap-3 px-4 py-3 text-left min-w-0"
        >
          {open
            ? <ChevronDown  size={14} className="text-muted flex-shrink-0" />
            : <ChevronRight size={14} className="text-muted flex-shrink-0" />}
          <span className="font-mono text-xs text-muted w-16 flex-shrink-0">{ep_code}</span>
          {absNum && <span className="font-mono text-xs text-muted/50 w-8 flex-shrink-0">#{absNum}</span>}
          <span className={clsx("text-sm flex-1 line-clamp-1 min-w-0", isMissing ? "text-red-400" : "text-text")}>
            {episode.title || ep_code}
          </span>
          {episode.air_date && (
            <span className="text-xs text-muted/50 font-mono flex-shrink-0 hidden sm:inline">{episode.air_date}</span>
          )}
          {episode.video_dynamic_range && (
            <span className="text-xs bg-yellow-900/40 text-yellow-400 px-1 rounded font-mono flex-shrink-0">
              {episode.video_dynamic_range}
            </span>
          )}
          {episode.resolution && (
            <span className="text-xs text-muted/60 font-mono flex-shrink-0">{episode.quality_name || episode.resolution}</span>
          )}
          {hasFile
            ? <CheckCircle2 size={14} className="text-green-400 flex-shrink-0" />
            : <XCircle      size={14} className={clsx("flex-shrink-0", isMissing ? "text-red-500" : "text-muted")} />}
          {episode.has_cs_sub && (
            <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full bg-accent/15 text-accent border border-accent/30 flex-shrink-0">cs</span>
          )}
          {seriesId && (
            <Tooltip text={episode.watched ? t("epr_mark_unwatched_tooltip") : t("epr_mark_watched_tooltip")} placement="left">
              <button
                onClick={e => { e.stopPropagation(); watchedMutation.mutate(!episode.watched); }}
                disabled={watchedMutation.isPending}
                className={clsx(
                  "flex-shrink-0 transition-colors disabled:opacity-40",
                  episode.watched ? "text-green-400 hover:text-muted" : "text-muted/40 hover:text-green-400"
                )}
              >
                {episode.watched ? <Eye size={14} /> : <EyeOff size={14} />}
              </button>
            </Tooltip>
          )}
        </button>
      </div>

      {/* ── Expanded panel ─────────────────────────────────────────────────── */}
      {open && (
        <div className="border-t border-border/60 bg-bg/40">

          {/* ── TWO-COLUMN LAYOUT ─────────────────────────────────────────────── */}
          <div className="flex min-h-0">

            {/* ── LEFT COLUMN 1/3 — image + metadata ───────────────────────── */}
            <div className="w-1/3 flex-shrink-0 flex flex-col border-r border-border/40">

              {/* Cover image */}
              <div className="relative w-full bg-surface overflow-hidden" style={{ aspectRatio: "2/3", maxHeight: "260px" }}>
                {showCover ? (
                  <img
                    src={seriesCoverUrl}
                    alt={episode.title}
                    onError={() => setImgError(true)}
                    className="w-full h-full object-cover object-top"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Film size={32} className="text-muted/20" />
                  </div>
                )}
                {/* ep code overlay on image */}
                <div className="absolute bottom-0 left-0 right-0 px-3 pb-2 pt-8 bg-gradient-to-t from-black/70 to-transparent">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-mono text-xs text-white/80 font-semibold">{ep_code}</span>
                    {absNum && <span className="font-mono text-[10px] text-white/40">#{absNum}</span>}
                    {isMissing && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-900/80 text-red-300 border border-red-800/60">{t("epr_missing_badge")}</span>
                    )}
                  </div>
                  {episode.title && (
                    <p className="text-white text-xs font-semibold leading-snug line-clamp-2 mt-0.5">{episode.title}</p>
                  )}
                </div>
              </div>

              {/* Metadata below image */}
              <div className="flex flex-col gap-1.5 p-3 text-xs text-muted/70 flex-1 border-b border-border/40">
                {episode.resolution && (
                  <div className="flex items-center gap-1.5">
                    <Cpu size={11} className="text-muted/40 flex-shrink-0" />
                    <span>{episode.resolution}</span>
                  </div>
                )}
                {episode.video_codec && (
                  <div className="flex items-center gap-1.5">
                    <Film size={11} className="text-muted/40 flex-shrink-0" />
                    <span>
                      {episode.video_codec}
                      {episode.video_fps ? ` · ${Number(episode.video_fps).toFixed(0)} fps` : ""}
                      {episode.video_dynamic_range ? (
                        <span className="ml-1 text-yellow-400 font-medium">{episode.video_dynamic_range}</span>
                      ) : null}
                    </span>
                  </div>
                )}
                {episode.audio_codec && (
                  <div className="flex items-center gap-1.5">
                    <Volume2 size={11} className="text-muted/40 flex-shrink-0" />
                    <span>{episode.audio_codec}{episode.audio_channels ? ` · ${episode.audio_channels}ch` : ""}</span>
                  </div>
                )}
                {episode.file_size_human && (
                  <div className="flex items-center gap-1.5">
                    <HardDrive size={11} className="text-muted/40 flex-shrink-0" />
                    <span>{episode.file_size_human}</span>
                  </div>
                )}
                {episode.run_time && (
                  <div className="flex items-center gap-1.5">
                    <Clock size={11} className="text-muted/40 flex-shrink-0" />
                    <span>{episode.run_time}</span>
                  </div>
                )}
                {episode.air_date && (
                  <div className="flex items-center gap-1.5">
                    <Calendar size={11} className="text-muted/40 flex-shrink-0" />
                    <span>{episode.air_date}</span>
                  </div>
                )}
                {episode.quality_name && (
                  <div className="flex items-center gap-1.5">
                    <Tag size={11} className="text-muted/40 flex-shrink-0" />
                    <span className="truncate">{episode.quality_name}</span>
                  </div>
                )}
                {episode.release_group && (
                  <div className="flex items-center gap-1.5">
                    <ExternalLink size={11} className="text-muted/40 flex-shrink-0" />
                    <span className="font-mono truncate">[{episode.release_group}]</span>
                  </div>
                )}
              </div>

              {/* Editor + Player buttons at bottom of left column */}
              <div className="p-3 flex flex-col gap-2">
                {episode.has_file && (
                  <Tooltip text={t("epr_open_player_tooltip")} placement="right">
                    <button
                      onClick={() => navigate(`/player/${seriesId}/${episode.id}`)}
                      className="w-full flex items-center justify-center gap-1.5 text-xs px-3 py-1.5 bg-accent hover:bg-accent/80 text-white rounded-lg transition-colors"
                    >
                      <Play size={12} />
                      {t("sd_play")}
                    </button>
                  </Tooltip>
                )}
                <Tooltip text={t("epr_open_editor_tooltip")} placement="right">
                  <button
                    onClick={() => openInEditor(null)}
                    className="w-full flex items-center justify-center gap-1.5 text-xs px-3 py-1.5 bg-surface border border-border hover:border-accent text-muted hover:text-text rounded-lg transition-colors"
                  >
                    <FileText size={12} />
                    {t("epr_editor_btn")}
                  </button>
                </Tooltip>
              </div>
            </div>

            {/* ── RIGHT COLUMN 2/3 — subtitles + actions ───────────────────── */}
            <div className="flex-1 min-w-0 flex flex-col">

              {/* Bulk action bar — DB subs */}
              {selectedDbIds.length > 0 && (
                <div className="flex items-center gap-3 px-4 py-2 bg-accent/5 border-b border-accent/20">
                  <span className="text-xs text-muted">
                    DB: <span className="font-semibold text-accent">{selectedDbIds.length}</span>
                  </span>
                  <button
                    onClick={() => deleteSubsMutation.mutate(selectedDbIds)}
                    disabled={deleteSubsMutation.isPending}
                    className="flex items-center gap-1 text-xs px-2.5 py-1 bg-red-900/40 hover:bg-red-800/50 border border-red-800/50 text-red-300 rounded-lg transition-colors disabled:opacity-40"
                  >
                    {deleteSubsMutation.isPending ? <Loader2 size={10} className="animate-spin" /> : <Trash2 size={10} />}
                    {t("epr_delete_db_btn")}
                  </button>
                  <button onClick={() => setSelectedSubs(new Set())} className="text-xs text-muted hover:text-text ml-auto">{t("common_cancel")}</button>
                </div>
              )}

              {/* Bulk action bar — disk files */}
              {selectedDiskPaths.size > 0 && (
                <div className="flex items-center gap-3 px-4 py-2 bg-red-950/20 border-b border-red-900/30">
                  <span className="text-xs text-muted">
                    {t("files_stat_disk")}: <span className="font-semibold text-red-400">{selectedDiskPaths.size}</span>
                  </span>
                  <button
                    onClick={() => {
                      if (window.confirm(`${t("common_delete")} ${selectedDiskPaths.size} ${t("epr_delete_disk_confirm_suffix")}`)) {
                        deleteDiskMutation.mutate([...selectedDiskPaths]);
                      }
                    }}
                    disabled={deleteDiskMutation.isPending}
                    className="flex items-center gap-1 text-xs px-2.5 py-1 bg-red-900/40 hover:bg-red-800/50 border border-red-800/50 text-red-300 rounded-lg transition-colors disabled:opacity-40"
                  >
                    {deleteDiskMutation.isPending ? <Loader2 size={10} className="animate-spin" /> : <Trash2 size={10} />}
                    {t("epr_delete_files_btn")}
                  </button>
                  <button onClick={() => setSelectedDiskPaths(new Set())} className="text-xs text-muted hover:text-text ml-auto">{t("common_cancel")}</button>
                </div>
              )}

              {/* Loading */}
              {(subsLoading || filesLoading) && (
                <div className="flex items-center gap-2 px-5 py-3 text-xs text-muted">
                  <Loader2 size={12} className="animate-spin" /> {t("epr_loading_subs")}
                </div>
              )}

              {/* ── Group: Na disku ──────────────────────────────────────── */}
              {!filesLoading && diskFileList.length > 0 && (
                <div className="border-b border-border/40">
                  <GroupHeader
                    label={t("lib_stat_on_disk")}
                    count={diskFileList.length}
                    allSelected={diskFileList.length > 0 && diskFileList.every(f => selectedDiskPaths.has(f.path))}
                    onSelectAll={() => {
                      const allPaths = diskFileList.map(f => f.path).filter(Boolean);
                      const allSel = allPaths.every(p => selectedDiskPaths.has(p));
                      setSelectedDiskPaths(prev => {
                        const next = new Set(prev);
                        if (allSel) allPaths.forEach(p => next.delete(p));
                        else allPaths.forEach(p => next.add(p));
                        return next;
                      });
                    }}
                  />
                  {diskFileList.map((f, i) => {
                    const key = mkSelKey("disk", f.path || i);
                    const fname = (f.path || "").split(/[\\/]/).pop();
                    return (
                      <SubRow
                        key={key}
                        id={key}
                        rawId={f.path}
                        lang={f.lang || "?"}
                        label={fname || f.path || "—"}
                        source="disk"
                        isDbSub={false}
                        isDiskFile={true}
                        filePath={f.path}
                        selected={selectedDiskPaths.has(f.path)}
                        onToggle={() => {
                          setSelectedDiskPaths(prev => {
                            const next = new Set(prev);
                            if (next.has(f.path)) next.delete(f.path); else next.add(f.path);
                            return next;
                          });
                        }}
                        onDelete={() => {
                          deleteDiskMutation.mutate([f.path]);
                        }}
                        onOpenEditor={openInEditor}
                      />
                    );
                  })}
                </div>
              )}
              {/* ── Group: Vložené (MKV) ─────────────────────────────────── */}
              {embeddedLangs.length > 0 && (
                <div className="border-b border-border/40">
                  <GroupHeader label={t("epr_group_embedded")} count={embeddedLangs.length} />
                  {embeddedLangs.map((lang, i) => (
                    <SubRow
                      key={`emb:${lang}:${i}`}
                      id={`emb:${lang}:${i}`}
                      rawId={lang}
                      lang={lang}
                      label={t("epr_embedded_label")}
                      source="embedded"
                      isDbSub={false}
                      filePath={null}
                      selected={false}
                      onToggle={() => {}}
                      onOpenEditor={openInEditor}
                    />
                  ))}
                </div>
              )}

              {/* ── Groups: DB subs by source ────────────────────────────── */}
              {Object.entries(subsBySource).map(([src, srcSubs]) => {
                const srcKeys = srcSubs.map(s => mkSelKey("db", s.id));
                const allSelected = srcKeys.every(k => selectedSubs.has(k));
                return (
                  <div key={src} className="border-b border-border/40">
                    <GroupHeader
                      label={sourceLabelMeta[src] ?? src}
                      count={srcSubs.length}
                      allSelected={allSelected}
                      onSelectAll={() => selectGroup(srcKeys, allSelected)}
                    />
                    {srcSubs.map(s => {
                      const key = mkSelKey("db", s.id);
                      const fname = s.file_path?.split(/[\\/]/).pop() || s.title || "—";
                      const isCs = s.language === "cs" || s.language === "cze" || s.language === "ces";
                      return (
                        <SubRow
                          key={key}
                          id={key}
                          rawId={s.id}
                          lang={s.language}
                          label={fname}
                          source={src}
                          isDbSub={true}
                          filePath={s.file_path}
                          selected={selectedSubs.has(key)}
                          onToggle={() => toggleSub(key)}
                          onDelete={() => deleteSubsMutation.mutate([s.id])}
                          onSync={() => syncMutation.mutate()}
                          onOpenEditor={openInEditor}
                          canSync={isCs && hasFile}
                        />
                      );
                    })}
                  </div>
                );
              })}

              {/* Empty state */}
              {!subsLoading && !filesLoading && (subs || []).length === 0 && diskFileList.length === 0 && embeddedLangs.length === 0 && (
                <div className="px-5 py-4 text-xs text-muted/40 italic">{t("player_no_subs")}</div>
              )}

              {/* Download messages (warning / lang-check) */}
              {dlMsg && !searchData?.data?.results?.length && (
                <div className="px-4 py-2 border-t border-border/40">
                  <p className={clsx("text-xs px-2.5 py-1.5 rounded-lg",
                    dlMsg.startsWith("✓") ? "bg-green-900/20 text-green-400"
                    : dlMsg.startsWith("✗") ? "bg-red-900/20 text-red-400"
                    : "bg-yellow-900/20 text-yellow-400"
                  )}>{dlMsg}</p>
                </div>
              )}

              {/* Status messages */}
              {(syncMsg || stripMsg) && (
                <div className="px-4 py-2 flex flex-col gap-1 border-t border-border/40">
                  {syncMsg && (
                    <p className={clsx("text-xs px-2.5 py-1.5 rounded-lg",
                      syncMsg.startsWith("✓") ? "bg-green-900/20 text-green-400"
                      : syncMsg.startsWith("—") ? "bg-surface text-muted"
                      : "bg-red-900/20 text-red-400"
                    )}>{syncMsg}</p>
                  )}
                  {stripMsg && (
                    <p className={clsx("text-xs px-2.5 py-1.5 rounded-lg",
                      stripMsg.startsWith("✓") ? "bg-orange-900/20 text-orange-400"
                      : stripMsg.startsWith("—") ? "bg-surface text-muted"
                      : "bg-red-900/20 text-red-400"
                    )}>{stripMsg}</p>
                  )}
                </div>
              )}

              {/* ── ACTION BUTTONS ─────────────────────────────────────────── */}
              <div className="flex flex-wrap gap-2 px-4 py-3 border-t border-border/40 mt-auto">
                <Tooltip text={t("epr_download_best_tooltip")}>
                  <button
                    onClick={() => doDownloadBest()}
                    disabled={!hasFile || downloading}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-accent hover:bg-accent-hover disabled:opacity-40 text-white rounded-lg transition-colors"
                  >
                    {downloading ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                    {t("epr_download_best_btn")}
                  </button>
                </Tooltip>

                <Tooltip text={t("epr_search_tooltip")}>
                  <button
                    onClick={() => doSearch()}
                    disabled={!hasFile || searching}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-surface border border-border hover:border-accent text-muted hover:text-text disabled:opacity-40 rounded-lg transition-colors"
                  >
                    {searching ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
                    {t("sd_search_word")}
                  </button>
                </Tooltip>

                {episode.file_path && (
                  <Tooltip text={t("epr_extract_tooltip")}>
                    <button
                      onClick={() => extractAllSubtitles(episode.file_path)}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-surface border border-border hover:border-accent text-muted hover:text-text rounded-lg transition-colors"
                    >
                      <Film size={12} />
                      {t("epr_extract_btn")}
                    </button>
                  </Tooltip>
                )}

                {hasFile && episode.has_cs_sub && (
                  <Tooltip text={t("epr_sync_tooltip")}>
                    <button
                      onClick={() => syncMutation.mutate()}
                      disabled={syncMutation.isPending}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-surface border border-border hover:border-accent text-muted hover:text-text disabled:opacity-40 rounded-lg transition-colors"
                    >
                      {syncMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <Timer size={12} />}
                      {t("epr_sync_btn")}
                    </button>
                  </Tooltip>
                )}

                {episode.subtitles_in_file && (
                  <Tooltip text={t("epr_strip_tooltip")}>
                    <button
                      onClick={() => {
                        if (window.confirm(t("epr_strip_confirm"))) {
                          stripMutation.mutate();
                        }
                      }}
                      disabled={stripMutation.isPending}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-surface border border-orange-800/50 hover:border-orange-500 text-orange-400/70 hover:text-orange-400 disabled:opacity-40 rounded-lg transition-colors"
                    >
                      {stripMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <Scissors size={12} />}
                      {t("epr_strip_btn")}
                    </button>
                  </Tooltip>
                )}

                <Tooltip text={t("epr_upload_tooltip")}>
                  <button
                    onClick={() => setShowUpload(v => !v)}
                    className={clsx(
                      "flex items-center gap-1.5 text-xs px-3 py-1.5 border rounded-lg transition-colors",
                      showUpload
                        ? "bg-accent/10 border-accent text-accent"
                        : "bg-surface border-border hover:border-accent text-muted hover:text-text"
                    )}
                  >
                    <Upload size={12} />
                    {t("epr_upload_file_btn")}
                  </button>
                </Tooltip>
              </div>

              {/* Upload panel */}
              {showUpload && (
                <div className="px-4 pb-3">
                  <UploadPanel
                    episodeId={episode.id}
                    onSuccess={() => { setShowUpload(false); _invalidate(); }}
                  />
                </div>
              )}
            </div>
          </div>

          {/* ── DESCRIPTION — full width at bottom ───────────────────────────── */}
          {episode.overview && (
            <div className="border-t border-border/40 px-4 py-3">
              <p className="text-xs text-muted/60 leading-relaxed">{episode.overview}</p>
            </div>
          )}

          {/* ── SEARCH RESULTS — full width ───────────────────────────────────── */}
          {searchData?.data?.results?.length > 0 && (
            <div className="border-t border-border/40 px-4 pb-4 pt-3">
              <div className="flex items-center gap-2 mb-2">
                <p className="text-[10px] text-muted/50 uppercase tracking-wide font-semibold">
                  {t("epr_search_results_label")}
                </p>
                <span className="text-[10px] text-muted/40">({searchData.data.results.length})</span>
                <label className="flex items-center gap-1.5 text-xs text-muted cursor-pointer select-none ml-auto">
                  <input
                    type="checkbox"
                    checked={autoSync}
                    onChange={e => setAutoSync(e.target.checked)}
                    className="w-3.5 h-3.5 rounded cursor-pointer accent-accent"
                  />
                  <span className={autoSync ? "text-accent font-medium" : ""}>{t("epr_sync_after_download")}</span>
                </label>
              </div>
              <div className="flex flex-col border border-border rounded-lg overflow-hidden">
                {searchData.data.results.map((r, i) => (
                  <div key={i} className={clsx(
                    "flex items-center gap-3 px-3 py-2.5 text-xs",
                    i < searchData.data.results.length - 1 && "border-b border-border"
                  )}>
                    <span className={clsx(
                      "text-[10px] font-semibold px-1.5 py-0.5 rounded border uppercase flex-shrink-0",
                      SOURCE_STYLE[r.source] ?? "bg-surface text-muted border-border"
                    )}>{sourceLabelMeta[r.source] ?? r.source}</span>
                    <LangBadge lang={r.language} />
                    <span className={clsx(
                      "text-xs font-medium flex-shrink-0 hidden sm:inline",
                      r.language === "cs" ? "text-accent" : "text-muted/70"
                    )}>{langName(r.language, langNames)}</span>
                    <span className="flex-1 min-w-0 text-xs text-text truncate" title={r.title}>
                      {r.title}
                      {r.uploader && r.uploader !== r.title && (
                        <span className="text-muted/60 ml-1">({r.uploader})</span>
                      )}
                    </span>
                    {r.rating && <span className="text-xs text-muted flex-shrink-0">v{r.rating}</span>}
                    <button
                      onClick={() => doDownload(r)}
                      disabled={dlPending}
                      className="flex items-center gap-1 text-xs text-accent hover:text-accent-hover disabled:opacity-40 transition-colors flex-shrink-0"
                    >
                      {dlPending ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
                      {t("sd_download_btn")}
                    </button>
                  </div>
                ))}
              </div>
              {dlMsg && (
                <p className={clsx(
                  "text-xs px-2.5 py-1.5 rounded-lg mt-2",
                  dlMsg.startsWith("✓") ? "bg-green-900/20 text-green-400"
                  : dlMsg.startsWith("✗") ? "bg-red-900/20 text-red-400"
                  : "bg-yellow-900/20 text-yellow-400"
                )}>{dlMsg}</p>
              )}
              {searchData?.data?.log?.length > 0 && (
                <details className="text-xs text-muted mt-2">
                  <summary className="cursor-pointer hover:text-text">{t("epr_search_log_summary")}</summary>
                  <pre className="mt-1 font-mono text-xs bg-bg rounded p-2 overflow-x-auto whitespace-pre-wrap">
                    {searchData.data.log.join("\n")}
                  </pre>
                </details>
              )}
            </div>
          )}

        </div>
      )}
    </div>
  );
});

export default EpisodeRow;
