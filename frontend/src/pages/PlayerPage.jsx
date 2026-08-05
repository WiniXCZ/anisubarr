/**
 * PlayerPage – /player/:seriesId/:episodeId
 *
 * Layout: video player (2/3) + subtitle editor panel (1/3)
 * Keyboard shortcuts: Space play/pause · ←/→ ±5s · J/L ±10s · F fullscreen ·
 * Ctrl+Z undo · Ctrl+Shift+Z redo
 *
 * The editor is here rather than on a page of its own because timing is judged
 * against the picture: "is this line late" is a question only the video can
 * answer, and every editing operation that matters takes the playhead as input.
 */
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Play, Pause, Volume2, VolumeX, Maximize, Minimize,
  SkipBack, SkipForward, Scissors, Loader2, X,
} from "lucide-react";
import api from "../api/client";
import clsx from "clsx";
import { useT } from "../i18n/I18nContext";
import CueRow from "../components/subtitle-editor/CueRow";
import EditorToolbar from "../components/subtitle-editor/EditorToolbar";
import useCueHistory from "../components/subtitle-editor/useCueHistory";
import * as subOps from "../components/subtitle-editor/ops";

// ── API helpers ──────────────────────────────────────────────────────────────

const fetchSeriesDetail = (id) => api.get(`/series/${id}`).then(r => r.data);
const fetchEpSubs       = (id) => api.get(`/subtitles/episode/${id}`).then(r => r.data);
const fetchSubLines     = (eid, lang) => api.get(`/episodes/${eid}/subs/${lang}`).then(r => r.data);
const fetchMarkers      = (eid) => api.get(`/episodes/${eid}/markers`).then(r => r.data);
const postMarker        = (eid, type, time_seconds) =>
  api.post(`/episodes/${eid}/markers`, { type, time_seconds });
const putSubLines       = (eid, lang, lines, format) =>
  api.put(`/episodes/${eid}/subs/${lang}`, { lines, format });
const postCut           = (eid, from_seconds, to_seconds, output_suffix) =>
  api.post(`/video/cut/${eid}`, { from_seconds, to_seconds, output_suffix }, { timeout: 600_000 });

// ── Formatting helpers ───────────────────────────────────────────────────────

function fmtTime(secs) {
  const s = Math.floor(secs || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}

// ── Timeline ─────────────────────────────────────────────────────────────────

function Timeline({ currentTime, duration, markers, onSeek }) {
  const barRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  function pct(t) {
    return duration > 0 ? Math.min(100, Math.max(0, (t / duration) * 100)) : 0;
  }

  function timeFromEvent(e) {
    if (!barRef.current) return 0;
    const rect = barRef.current.getBoundingClientRect();
    return Math.max(0, Math.min(duration, ((e.clientX - rect.left) / rect.width) * duration));
  }

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e) => onSeek(timeFromEvent(e));
    const onUp = () => setDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging]); // eslint-disable-line

  return (
    <div
      ref={barRef}
      className="relative h-5 cursor-pointer select-none flex items-center"
      onMouseDown={(e) => { setDragging(true); onSeek(timeFromEvent(e)); }}
    >
      {/* Track */}
      <div className="absolute left-0 right-0 h-1.5 bg-white/10 rounded-full" />

      {/* Intro segment */}
      {markers.intro_start != null && markers.intro_end != null && (
        <div
          className="absolute h-1.5 bg-blue-500/60 rounded-full pointer-events-none"
          style={{
            left: `${pct(markers.intro_start)}%`,
            width: `${pct(markers.intro_end - markers.intro_start)}%`,
          }}
        />
      )}

      {/* Outro segment */}
      {markers.outro_start != null && markers.outro_end != null && (
        <div
          className="absolute h-1.5 bg-red-500/60 rounded-full pointer-events-none"
          style={{
            left: `${pct(markers.outro_start)}%`,
            width: `${pct(markers.outro_end - markers.outro_start)}%`,
          }}
        />
      )}

      {/* Progress */}
      <div
        className="absolute left-0 h-1.5 bg-accent rounded-full pointer-events-none"
        style={{ width: `${pct(currentTime)}%` }}
      />

      {/* Playhead */}
      <div
        className="absolute w-3.5 h-3.5 bg-white rounded-full shadow-md pointer-events-none -translate-x-1/2 top-1/2 -translate-y-1/2"
        style={{ left: `${pct(currentTime)}%` }}
      />
    </div>
  );
}

// ── MarkerBtn ─────────────────────────────────────────────────────────────────

function MarkerBtn({ label, color, value, onSet, disabled }) {
  const isSet = value != null;
  const cls = color === "blue"
    ? isSet
      ? "bg-blue-900/30 border-blue-700/50 text-blue-300"
      : "bg-surface border-border text-muted hover:border-blue-500/50 hover:text-blue-300"
    : isSet
      ? "bg-red-900/30 border-red-700/50 text-red-300"
      : "bg-surface border-border text-muted hover:border-red-500/50 hover:text-red-300";

  return (
    <button
      onClick={onSet}
      disabled={disabled}
      className={clsx("text-xs px-2.5 py-1 rounded border transition-colors flex items-center gap-1 disabled:opacity-50", cls)}
    >
      {label}
      {isSet && <span className="font-mono ml-1">{fmtTime(value)}</span>}
    </button>
  );
}

// ── PlayerPage ────────────────────────────────────────────────────────────────

export default function PlayerPage() {
  const t = useT();
  const { seriesId, episodeId } = useParams();
  const navigate = useNavigate();

  // Refs
  const videoRef      = useRef(null);
  const videoPanelRef = useRef(null);
  const cueListRef    = useRef(null);

  // Video playback state
  const [currentTime, setCurrentTime] = useState(0);
  const [duration,    setDuration]    = useState(0);
  const [playing,     setPlaying]     = useState(false);
  const [volume,      setVolume]      = useState(1);
  const [muted,       setMuted]       = useState(false);
  const [isFullscreen,setIsFullscreen]= useState(false);

  // Subtitle editor state
  const [selectedLang, setSelectedLang] = useState("cs");
  const { cues, commit, reset, undo, redo, canUndo, canRedo } = useCueHistory([]);
  const [subFormat,    setSubFormat]    = useState("srt");
  const [dirty,        setDirty]        = useState(false);
  const [saveMsg,      setSaveMsg]      = useState(null);
  const [selected,     setSelected]     = useState([]);   // indexes ticked in the list
  const [analysis,     setAnalysis]     = useState(null);

  // Markers
  const [markers, setMarkers] = useState({});

  // Cut dialog
  const [showCut, setShowCut] = useState(false);
  const [cutFrom, setCutFrom] = useState(0);
  const [cutTo,   setCutTo]   = useState(0);
  const [cutMsg,  setCutMsg]  = useState("");

  const [editorMsg,  setEditorMsg]  = useState(null); // {ok: bool, text: string}

  // Video URL with token for <video src>
  const token    = localStorage.getItem("token") || "";
  const videoUrl = `/api/video/stream/${episodeId}?token=${encodeURIComponent(token)}`;

  const queryClient = useQueryClient();

  // ── Data queries ──────────────────────────────────────────────

  const { data: series } = useQuery({
    queryKey: ["series", seriesId],
    queryFn: () => fetchSeriesDetail(seriesId),
    staleTime: 60_000,
  });

  const episode = series?.episodes?.find((e) => String(e.id) === String(episodeId));

  const { data: subs = [] } = useQuery({
    queryKey: ["subs", episodeId],
    queryFn: () => fetchEpSubs(episodeId),
    staleTime: 30_000,
  });

  const { data: subData } = useQuery({
    queryKey: ["sub-lines", episodeId, selectedLang],
    queryFn: () => fetchSubLines(episodeId, selectedLang),
    enabled: !!selectedLang,
    staleTime: 30_000,
  });

  const { data: markersData, refetch: refetchMarkers } = useQuery({
    queryKey: ["markers", episodeId],
    queryFn: () => fetchMarkers(episodeId),
    staleTime: 30_000,
  });

  // ── Sync fetched data to local state ─────────────────────────

  useEffect(() => {
    if (subData) {
      reset(subData.lines || []);
      setSubFormat(subData.format || "srt");
      setDirty(false);
      setSaveMsg(null);
      setSelected([]);
    }
  }, [subData]); // eslint-disable-line

  // Re-check the file after edits settle. Doing it per keystroke would be a
  // request per character; a beat later the warnings are still current.
  useEffect(() => {
    if (cues.length === 0) { setAnalysis(null); return; }
    const timer = setTimeout(() => {
      subOps.analyze(cues).then(setAnalysis).catch(() => {});
    }, 400);
    return () => clearTimeout(timer);
  }, [cues]);

  useEffect(() => {
    if (markersData) {
      const m = {};
      for (const item of markersData) m[item.type] = item.time_seconds;
      setMarkers(m);
    }
  }, [markersData]);

  // Auto-select a language if the default isn't available
  useEffect(() => {
    const avail = subs.filter((s) => !s.is_embedded);
    if (avail.length > 0 && !avail.find((s) => s.language === selectedLang)) {
      setSelectedLang(avail[0].language);
    }
  }, [subs]); // eslint-disable-line

  // ── Active cue index ─────────────────────────────────────────

  const activeCue = cues.findIndex((c) => c.start <= currentTime && c.end > currentTime);

  // Scroll active cue into view
  useEffect(() => {
    if (activeCue >= 0 && cueListRef.current) {
      const el = cueListRef.current.querySelector(`[data-cue="${activeCue}"]`);
      el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [activeCue]);

  // ── Keyboard shortcuts ────────────────────────────────────────

  useEffect(() => {
    function onKey(e) {
      const video = videoRef.current;
      if (!video) return;
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
        setDirty(true);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
        setDirty(true);
        return;
      }
      if (e.ctrlKey || e.metaKey) return;   // leave Ctrl+C and friends alone
      switch (e.key) {
        case " ":
          e.preventDefault();
          video.paused ? video.play() : video.pause();
          break;
        case "ArrowLeft":
          e.preventDefault();
          video.currentTime = Math.max(0, video.currentTime - 5);
          break;
        case "ArrowRight":
          e.preventDefault();
          video.currentTime = Math.min(video.duration || 0, video.currentTime + 5);
          break;
        case "j": case "J":
          video.currentTime = Math.max(0, video.currentTime - 10);
          break;
        case "l": case "L":
          video.currentTime = Math.min(video.duration || 0, video.currentTime + 10);
          break;
        case "f": case "F":
          if (!document.fullscreenElement) videoPanelRef.current?.requestFullscreen();
          else document.exitFullscreen();
          break;
        default: break;
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  // ── Mutations ─────────────────────────────────────────────────

  const setMarkerMut = useMutation({
    mutationFn: ({ type, time_seconds }) => postMarker(episodeId, type, time_seconds),
    onSuccess: (_, vars) => {
      setMarkers((prev) => ({ ...prev, [vars.type]: vars.time_seconds }));
      refetchMarkers();
    },
  });

  const saveMut = useMutation({
    mutationFn: () => putSubLines(episodeId, selectedLang, cues, subFormat),
    onSuccess: () => {
      setSaveMsg({ ok: true, text: t('player_saved') });
      setDirty(false);
      setTimeout(() => setSaveMsg(null), 3000);
    },
    onError: (e) => {
      setSaveMsg({ ok: false, text: `${t('disc_toast_error_prefix')}: ${e?.response?.data?.detail || e.message}` });
    },
  });

  const cutMut = useMutation({
    mutationFn: () => postCut(episodeId, cutFrom, cutTo, "_cut"),
    onSuccess: (res) => setCutMsg(`${t('player_cut_success_prefix')} ${res.data.output_path}`),
    onError:   (e)   => setCutMsg(`✗ ${e?.response?.data?.detail || t('disc_toast_error_prefix')}`),
  });

  const alasMut = useMutation({
    mutationFn: () => api.post(`/subtitle-sync/episode/${episodeId}`),
    onSuccess: (res) => {
      const d = res.data;
      queryClient.invalidateQueries({ queryKey: ["sub-lines", episodeId, selectedLang] });
      setEditorMsg({ ok: d.status === "ok", text: d.message || t('player_alass_done_default') });
      setTimeout(() => setEditorMsg(null), 6000);
    },
    onError: (e) => {
      setEditorMsg({ ok: false, text: `${t('player_alass_error_prefix')} ${e?.response?.data?.detail || e.message}` });
      setTimeout(() => setEditorMsg(null), 5000);
    },
  });

  // ── Helpers ───────────────────────────────────────────────────

  const seekTo = useCallback((t) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, Math.min(video.duration || 0, t));
  }, []);

  function setMarker(type) {
    const t = videoRef.current?.currentTime;
    if (t == null) return;
    setMarkerMut.mutate({ type, time_seconds: t });
  }

  /** Edit one cue. Typing in the same cue coalesces into one undo step. */
  function updateCue(idx, changes, coalesceKey = null) {
    commit((prev) => prev.map((c, i) => (i === idx ? { ...c, ...changes } : c)),
           coalesceKey ?? `cue-${idx}-${Object.keys(changes).join()}`);
    setDirty(true);
  }

  /** Replace the whole list — what the toolbar operations return. */
  function replaceCues(lines) {
    commit(lines);
    setDirty(true);
    setSelected([]);
  }

  function syncCueToCurrentTime(idx) {
    const now = videoRef.current?.currentTime;
    if (now == null) return;
    const cue = cues[idx];
    const dur = Math.max(cue.end - cue.start, 0.1);
    updateCue(idx, { start: now, end: now + dur });
  }

  function syncCueEndToCurrentTime(idx) {
    const now = videoRef.current?.currentTime;
    if (now == null) return;
    const cue = cues[idx];
    updateCue(idx, { end: Math.max(now, cue.start + 0.1) });
  }

  /** The cue-list operations. They run on the backend so the editor and the
   *  tests agree on what "split" or "merge" means. */
  async function runOp(fn) {
    try {
      const res = await fn();
      replaceCues(res.lines);
    } catch (e) {
      setEditorMsg({ ok: false, text: e?.response?.data?.detail || e.message });
      setTimeout(() => setEditorMsg(null), 5000);
    }
  }

  /** Split where the playhead sits when it's inside the cue, else in half. */
  const splitCue = (idx) => runOp(() => {
    const now = videoRef.current?.currentTime;
    const cue = cues[idx];
    const inside = now != null && now > cue.start && now < cue.end;
    return subOps.splitCue(cues, idx, inside ? now : null);
  });

  const deleteCue = (idx) => runOp(() => subOps.deleteCues(cues, [idx]));
  const mergeWithNext = (idx) => runOp(() => subOps.mergeCues(cues, [idx, idx + 1]));

  /** A new cue starts at the playhead and runs for a readable two seconds. */
  const insertCue = (at) => runOp(() => subOps.insertCue(cues, at, at + 2, ""));

  function toggleSelected(idx, on) {
    setSelected((prev) => (on ? [...prev, idx] : prev.filter((i) => i !== idx)).sort((a, b) => a - b));
  }

  // ── Derived values ────────────────────────────────────────────

  const epCode = episode
    ? `S${String(episode.season_number).padStart(2, "0")}E${String(episode.episode_number).padStart(2, "0")}`
    : "…";

  const langs = [...new Map(
    subs.filter((s) => !s.is_embedded && s.file_path).map((s) => [s.language, s])
  ).values()];

  const canSave = dirty && subFormat === "srt";

  // The verdict for each row, keyed by index the way analyze() reports it.
  const issuesByIndex = useMemo(() => analysis?.issues || {}, [analysis]);

  // ── Render ────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-bg">

      {/* ── Header ──────────────────────────────────────────── */}
      <div className="flex-shrink-0 flex items-center gap-3 px-3 py-2 border-b border-border bg-panel">
        <button
          onClick={() => navigate(`/series/${seriesId}`)}
          className="flex items-center gap-1.5 text-sm text-muted hover:text-text transition-colors flex-shrink-0"
        >
          <ArrowLeft size={16} />
          {t('player_back')}
        </button>
        <div className="h-4 w-px bg-border flex-shrink-0" />
        <span className="text-sm font-medium text-text truncate min-w-0">
          {series?.title_romaji || series?.title || "…"} — {epCode}
          {episode?.title ? ` — ${episode.title}` : ""}
        </span>
        <div className="flex-1" />
        {saveMsg && (
          <span className={clsx(
            "text-xs px-2 py-1 rounded flex-shrink-0",
            saveMsg.ok ? "text-green-400 bg-green-900/20" : "text-red-400 bg-red-900/20",
          )}>
            {saveMsg.text}
          </span>
        )}
        {dirty && !saveMsg && (
          <span className="text-xs px-2 py-1 rounded text-yellow-400 bg-yellow-900/20 flex-shrink-0">
            {t('sube_unsaved')}
          </span>
        )}
      </div>

      {/* ── Body ────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* ── Video panel (2/3) ──────────────────────────────── */}
        <div
          ref={videoPanelRef}
          className="flex flex-col flex-1 min-w-0 bg-black"
        >
          {/* Video wrapper */}
          <div className="relative flex-1 min-h-0 bg-black overflow-hidden">
            {episode?.has_file ? (
              <video
                ref={videoRef}
                src={videoUrl}
                className="w-full h-full"
                style={{ objectFit: "contain" }}
                onTimeUpdate={(e) => setCurrentTime(e.target.currentTime)}
                onLoadedMetadata={(e) => {
                  setDuration(e.target.duration);
                  setCutTo(Math.floor(e.target.duration));
                }}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onVolumeChange={(e) => {
                  setVolume(e.target.volume);
                  setMuted(e.target.muted);
                }}
                preload="metadata"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-muted/50 text-sm">
                {t('player_no_video_file')}
              </div>
            )}

            {/* Subtitle overlay */}
            {activeCue >= 0 && cues[activeCue]?.text && (
              <div className="absolute bottom-3 left-0 right-0 flex justify-center pointer-events-none px-8 z-10">
                <div
                  className="text-white text-center text-lg font-semibold px-4 py-1.5 rounded leading-snug"
                  style={{
                    textShadow: "0 1px 6px rgba(0,0,0,1), 0 0 12px rgba(0,0,0,0.8)",
                    background: "rgba(0,0,0,0.55)",
                  }}
                >
                  {cues[activeCue].text.split("\n").map((line, i) => (
                    <div key={i}>{line}</div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="flex-shrink-0 bg-panel px-4 py-3 flex flex-col gap-2.5">

            {/* Timeline */}
            <Timeline
              currentTime={currentTime}
              duration={duration}
              markers={markers}
              onSeek={seekTo}
            />

            {/* Timeline legend */}
            {(markers.intro_start != null || markers.outro_start != null) && (
              <div className="flex items-center gap-4 -mt-1">
                {markers.intro_start != null && markers.intro_end != null && (
                  <span className="flex items-center gap-1 text-[10px] text-muted/50">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500/70 inline-block flex-shrink-0" />
                    {t('player_intro_label')} {fmtTime(markers.intro_start)} – {fmtTime(markers.intro_end)}
                  </span>
                )}
                {markers.outro_start != null && markers.outro_end != null && (
                  <span className="flex items-center gap-1 text-[10px] text-muted/50">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500/70 inline-block flex-shrink-0" />
                    {t('player_outro_label')} {fmtTime(markers.outro_start)} – {fmtTime(markers.outro_end)}
                  </span>
                )}
              </div>
            )}

            {/* Playback controls */}
            <div className="flex items-center gap-2.5">
              <button
                onClick={() => { const v = videoRef.current; if (v) v.currentTime = Math.max(0, v.currentTime - 10); }}
                className="text-muted hover:text-text transition-colors"
                title="-10s (J)"
              >
                <SkipBack size={16} />
              </button>
              <button
                onClick={() => { const v = videoRef.current; if (v) v.currentTime = Math.max(0, v.currentTime - 5); }}
                className="text-muted hover:text-text transition-colors text-xs font-mono"
                title="-5s (←)"
              >
                -5s
              </button>
              <button
                onClick={() => { const v = videoRef.current; if (!v) return; v.paused ? v.play() : v.pause(); }}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-accent hover:bg-accent/80 text-white transition-colors flex-shrink-0"
                title={t('player_playpause_title')}
              >
                {playing ? <Pause size={15} /> : <Play size={15} className="ml-0.5" />}
              </button>
              <button
                onClick={() => { const v = videoRef.current; if (v) v.currentTime = Math.min(duration, v.currentTime + 5); }}
                className="text-muted hover:text-text transition-colors text-xs font-mono"
                title="+5s (→)"
              >
                +5s
              </button>
              <button
                onClick={() => { const v = videoRef.current; if (v) v.currentTime = Math.min(duration, v.currentTime + 10); }}
                className="text-muted hover:text-text transition-colors"
                title="+10s (L)"
              >
                <SkipForward size={16} />
              </button>

              <span className="text-xs font-mono text-muted ml-1">
                {fmtTime(currentTime)} / {fmtTime(duration)}
              </span>

              <div className="flex-1" />

              {/* Volume */}
              <button
                onClick={() => { if (videoRef.current) videoRef.current.muted = !videoRef.current.muted; }}
                className="text-muted hover:text-text transition-colors"
                title="Mute/Unmute"
              >
                {muted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={muted ? 0 : volume}
                onChange={(e) => {
                  const v = videoRef.current;
                  if (!v) return;
                  v.volume = Number(e.target.value);
                  v.muted = Number(e.target.value) === 0;
                }}
                className="w-20 accent-accent cursor-pointer"
              />

              {/* Fullscreen */}
              <button
                onClick={() => {
                  if (!document.fullscreenElement) videoPanelRef.current?.requestFullscreen();
                  else document.exitFullscreen();
                }}
                className="text-muted hover:text-text transition-colors"
                title={t('player_fullscreen_title')}
              >
                {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
              </button>
            </div>

            {/* Marker buttons + cut */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] text-muted/50 font-semibold uppercase tracking-wide">{t('player_intro_label')}</span>
              <MarkerBtn label={t('player_marker_start')} color="blue" value={markers.intro_start} disabled={setMarkerMut.isPending} onSet={() => setMarker("intro_start")} />
              <MarkerBtn label={t('player_marker_end')}   color="blue" value={markers.intro_end}   disabled={setMarkerMut.isPending} onSet={() => setMarker("intro_end")}   />

              <div className="w-px h-4 bg-border mx-0.5" />

              <span className="text-[10px] text-muted/50 font-semibold uppercase tracking-wide">{t('player_outro_label')}</span>
              <MarkerBtn label={t('player_marker_start')} color="red" value={markers.outro_start} disabled={setMarkerMut.isPending} onSet={() => setMarker("outro_start")} />
              <MarkerBtn label={t('player_marker_end')}   color="red" value={markers.outro_end}   disabled={setMarkerMut.isPending} onSet={() => setMarker("outro_end")}   />

              <div className="flex-1" />

              <button
                onClick={() => {
                  const ct = Math.floor(currentTime);
                  setCutFrom(ct);
                  setCutTo(Math.min(ct + 60, Math.floor(duration)));
                  setCutMsg("");
                  setShowCut(true);
                }}
                className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded border border-border bg-surface text-muted hover:border-accent hover:text-text transition-colors"
              >
                <Scissors size={12} /> {t('player_cut_btn')}
              </button>
            </div>
          </div>
        </div>

        {/* ── Subtitle editor panel (1/3) ─────────────────────── */}
        <div
          className="flex flex-col border-l border-border bg-panel overflow-hidden"
          style={{ width: "38%", minWidth: "320px", maxWidth: "520px" }}
        >
          {/* Lang tabs */}
          <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border">
            <div className="flex items-center gap-1 flex-1 min-w-0 overflow-x-auto">
              {langs.length === 0 && (
                <span className="text-xs text-muted/40">{t('player_no_subs')}</span>
              )}
              {langs.map((s) => (
                <button
                  key={s.language}
                  onClick={() => setSelectedLang(s.language)}
                  className={clsx(
                    "flex-shrink-0 px-2 py-0.5 rounded text-xs border transition-colors",
                    s.language === selectedLang
                      ? "bg-accent/20 border-accent text-accent"
                      : "border-border text-muted hover:border-accent/50 hover:text-text",
                  )}
                >
                  {s.language.toUpperCase()}
                  <span className="ml-1 opacity-40 text-[10px]">.{s.format || "srt"}</span>
                </button>
              ))}
            </div>
            {cues.length > 0 && (
              <span className="text-[10px] text-muted/40 flex-shrink-0">{cues.length}</span>
            )}
          </div>

          <EditorToolbar
            cues={cues}
            onCues={replaceCues}
            currentTime={currentTime}
            analysis={analysis}
            dirty={canSave}
            saving={saveMut.isPending}
            onSave={() => saveMut.mutate()}
            onUndo={() => { undo(); setDirty(true); }}
            onRedo={() => { redo(); setDirty(true); }}
            canUndo={canUndo}
            canRedo={canRedo}
            selection={{ first: selected[0] ?? null, all: selected }}
            onInsert={insertCue}
            onAutoSync={() => alasMut.mutate()}
            autoSyncing={alasMut.isPending}
            canAutoSync={!!episode?.has_file}
          />

          {/* Editor feedback */}
          {editorMsg && (
            <div className={clsx(
              "flex-shrink-0 mx-2 mb-1 text-[10px] px-2 py-1 rounded",
              editorMsg.ok ? "text-green-400 bg-green-900/20" : "text-red-400 bg-red-900/20",
            )}>
              {editorMsg.text}
            </div>
          )}

          {/* Cue list */}
          <div ref={cueListRef} className="flex-1 overflow-y-auto min-h-0">
            {cues.length === 0 && (
              <div className="flex items-center justify-center py-16 text-xs text-muted/40 text-center px-4">
                {selectedLang
                  ? t('player_no_subs_for_lang')
                  : t('player_select_sub_lang')}
              </div>
            )}
            {cues.map((cue, i) => (
              <CueRow
                key={i}
                cue={cue}
                idx={i}
                active={activeCue === i}
                selected={selected.includes(i)}
                issues={issuesByIndex[String(i)]}
                cps={analysis?.cps?.[i]}
                onSeek={seekTo}
                onSelect={toggleSelected}
                onChange={(changes) => updateCue(i, changes)}
                onSetStart={syncCueToCurrentTime}
                onSetEnd={syncCueEndToCurrentTime}
                onSplit={splitCue}
                onDelete={deleteCue}
                onMergeNext={mergeWithNext}
                canMergeNext={i < cues.length - 1}
              />
            ))}
          </div>

          {/* Warning: ASS can't be saved */}
          {subFormat !== "srt" && dirty && (
            <div className="flex-shrink-0 px-3 py-2 border-t border-border text-xs text-yellow-400/80 bg-yellow-900/10">
              {t('player_ass_cannot_save')}
            </div>
          )}
        </div>
      </div>

      {/* ── Cut dialog ──────────────────────────────────────── */}
      {showCut && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50">
          <div className="bg-panel border border-border rounded-xl p-5 w-96 flex flex-col gap-4 shadow-2xl">

            <div className="flex items-center gap-2">
              <Scissors size={15} className="text-accent flex-shrink-0" />
              <h3 className="text-sm font-semibold text-text">{t('player_cut_title')}</h3>
              <button
                onClick={() => { setShowCut(false); setCutMsg(""); }}
                className="ml-auto text-muted hover:text-text"
              >
                <X size={15} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-muted mb-1">{t('player_from_label')}</label>
                <input
                  type="number"
                  min="0"
                  value={cutFrom}
                  onChange={(e) => setCutFrom(Number(e.target.value))}
                  className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-text text-sm focus:outline-none focus:border-accent"
                />
                <p className="text-[10px] text-muted/50 mt-0.5 font-mono">{fmtTime(cutFrom)}</p>
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">{t('player_to_label')}</label>
                <input
                  type="number"
                  min="0"
                  value={cutTo}
                  onChange={(e) => setCutTo(Number(e.target.value))}
                  className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-text text-sm focus:outline-none focus:border-accent"
                />
                <p className="text-[10px] text-muted/50 mt-0.5 font-mono">{fmtTime(cutTo)}</p>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setCutFrom(Math.floor(currentTime))}
                className="flex-1 text-xs py-1.5 border border-border rounded-lg text-muted hover:text-text hover:border-accent transition-colors"
              >
                {t('player_from_current')}{fmtTime(currentTime)}
              </button>
              <button
                onClick={() => setCutTo(Math.floor(currentTime))}
                className="flex-1 text-xs py-1.5 border border-border rounded-lg text-muted hover:text-text hover:border-accent transition-colors"
              >
                {t('player_to_current')}{fmtTime(currentTime)}
              </button>
            </div>

            <p className="text-xs text-muted/60">
              {t('player_length_label')} <span className="text-text font-mono">{fmtTime(Math.max(0, cutTo - cutFrom))}</span>
              {" · "}{t('player_ffmpeg_note')}
            </p>

            {cutMsg && (
              <p className={clsx(
                "text-xs px-2.5 py-1.5 rounded-lg break-all",
                cutMsg.startsWith("✓")
                  ? "bg-green-900/20 text-green-400"
                  : "bg-red-900/20 text-red-400",
              )}>
                {cutMsg}
              </p>
            )}

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => { setShowCut(false); setCutMsg(""); }}
                className="px-4 py-2 text-xs text-muted hover:text-text border border-border rounded-lg transition-colors"
              >
                {t('lib_close')}
              </button>
              <button
                onClick={() => cutMut.mutate()}
                disabled={cutMut.isPending || cutTo <= cutFrom || !episode?.has_file}
                className="flex items-center gap-1.5 px-4 py-2 text-xs bg-accent hover:bg-accent/80 text-white rounded-lg disabled:opacity-40 transition-colors"
              >
                {cutMut.isPending
                  ? <Loader2 size={13} className="animate-spin" />
                  : <Scissors size={13} />}
                {t('player_cut_confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
