/**
 * PlayerPage – /player/:seriesId/:episodeId
 *
 * Layout: video player (2/3) + subtitle editor panel (1/3)
 * Keyboard shortcuts: Space play/pause · ←/→ ±5s · J/L ±10s · F fullscreen
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Play, Pause, Volume2, VolumeX, Maximize, Minimize,
  SkipBack, SkipForward, Scissors, Save, Loader2, Pencil, X, RefreshCw,
} from "lucide-react";
import api from "../api/client";
import clsx from "clsx";

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

function fmtTs(secs) {
  const s = Math.floor(secs || 0);
  const ms = Math.round(((secs || 0) - s) * 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
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

// ── CueRow ────────────────────────────────────────────────────────────────────

function CueRow({ cue, idx, active, onSeek, onSync, onSyncEnd, onEdit }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(cue.text);

  useEffect(() => { setDraft(cue.text); }, [cue.text]);

  return (
    <div
      data-cue={idx}
      className={clsx(
        "group flex flex-col gap-0.5 px-3 py-2 border-b border-border cursor-pointer transition-colors",
        active
          ? "bg-accent/10 border-l-2 border-l-accent"
          : "hover:bg-white/[0.025]",
      )}
      onClick={() => !editing && onSeek(cue.start)}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-mono text-muted/50 w-5 flex-shrink-0">{idx + 1}</span>
        <span className="flex-1 text-[10px] font-mono text-muted/60 truncate">
          {fmtTs(cue.start)} → {fmtTs(cue.end)}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); onSync(idx); }}
          className="text-[10px] px-1.5 py-0.5 rounded bg-bg border border-border hover:border-accent text-muted hover:text-accent transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
          title="Nastavit start time na aktuální čas přehrávače"
        >
          ▶start
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onSyncEnd(idx); }}
          className="text-[10px] px-1.5 py-0.5 rounded bg-bg border border-border hover:border-accent text-muted hover:text-accent transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
          title="Nastavit end time na aktuální čas přehrávače"
        >
          end◀
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); setEditing((v) => !v); setDraft(cue.text); }}
          className="p-0.5 rounded text-muted hover:text-accent opacity-0 group-hover:opacity-100 flex-shrink-0 transition-colors"
          title="Upravit text"
        >
          <Pencil size={10} />
        </button>
      </div>

      {editing ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onEdit(idx, draft); setEditing(false); }
            if (e.key === "Escape") { setEditing(false); setDraft(cue.text); }
          }}
          onClick={(e) => e.stopPropagation()}
          rows={Math.max(1, (draft.match(/\n/g) || []).length + 1)}
          className="ml-7 w-full bg-bg border border-accent rounded px-2 py-1 text-xs text-text resize-none focus:outline-none"
          autoFocus
        />
      ) : (
        <p className="ml-7 text-sm text-text/90 leading-snug whitespace-pre-wrap">
          {cue.text
            ? cue.text
            : <em className="text-muted/40 text-xs">prázdné</em>}
        </p>
      )}
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
  const [cues,         setCues]         = useState([]);
  const [subFormat,    setSubFormat]    = useState("srt");
  const [dirty,        setDirty]        = useState(false);
  const [saveMsg,      setSaveMsg]      = useState(null);

  // Markers
  const [markers, setMarkers] = useState({});

  // Cut dialog
  const [showCut, setShowCut] = useState(false);
  const [cutFrom, setCutFrom] = useState(0);
  const [cutTo,   setCutTo]   = useState(0);
  const [cutMsg,  setCutMsg]  = useState("");

  // Shift + alass panel
  const [shiftMs,    setShiftMs]    = useState(0);
  const [shiftInput, setShiftInput] = useState("0");
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
      setCues(subData.lines || []);
      setSubFormat(subData.format || "srt");
      setDirty(false);
      setSaveMsg(null);
    }
  }, [subData]);

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
  }, []);

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
      setSaveMsg({ ok: true, text: "Uloženo ✓" });
      setDirty(false);
      setTimeout(() => setSaveMsg(null), 3000);
    },
    onError: (e) => {
      setSaveMsg({ ok: false, text: `Chyba: ${e?.response?.data?.detail || e.message}` });
    },
  });

  const cutMut = useMutation({
    mutationFn: () => postCut(episodeId, cutFrom, cutTo, "_cut"),
    onSuccess: (res) => setCutMsg(`✓ Vystřiženo: ${res.data.output_path}`),
    onError:   (e)   => setCutMsg(`✗ ${e?.response?.data?.detail || "Chyba"}`),
  });

  const shiftMut = useMutation({
    mutationFn: () => api.post("/subtitle-editor/shift", { sub_id: subId, shift_ms: shiftMs, save: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sub-lines", episodeId, selectedLang] });
      setEditorMsg({ ok: true, text: `Posunuto o ${shiftMs > 0 ? "+" : ""}${shiftMs} ms ✓` });
      setTimeout(() => setEditorMsg(null), 3000);
    },
    onError: (e) => {
      setEditorMsg({ ok: false, text: `Chyba posunu: ${e?.response?.data?.detail || e.message}` });
      setTimeout(() => setEditorMsg(null), 5000);
    },
  });

  const alasMut = useMutation({
    mutationFn: () => api.post(`/subtitle-sync/episode/${episodeId}`),
    onSuccess: (res) => {
      const d = res.data;
      queryClient.invalidateQueries({ queryKey: ["sub-lines", episodeId, selectedLang] });
      setEditorMsg({ ok: d.status === "ok", text: d.message || "Hotovo" });
      setTimeout(() => setEditorMsg(null), 6000);
    },
    onError: (e) => {
      setEditorMsg({ ok: false, text: `alass chyba: ${e?.response?.data?.detail || e.message}` });
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

  function updateCue(idx, changes) {
    setCues((prev) => prev.map((c, i) => (i === idx ? { ...c, ...changes } : c)));
    setDirty(true);
  }

  function syncCueToCurrentTime(idx) {
    const t = videoRef.current?.currentTime;
    if (t == null) return;
    const cue = cues[idx];
    const dur = Math.max(cue.end - cue.start, 0.1);
    updateCue(idx, { start: t, end: t + dur });
  }

  function syncCueEndToCurrentTime(idx) {
    const t = videoRef.current?.currentTime;
    if (t == null) return;
    const cue = cues[idx];
    updateCue(idx, { end: Math.max(t, cue.start + 0.1) });
  }

  // ── Derived values ────────────────────────────────────────────

  const epCode = episode
    ? `S${String(episode.season_number).padStart(2, "0")}E${String(episode.episode_number).padStart(2, "0")}`
    : "…";

  const langs = [...new Map(
    subs.filter((s) => !s.is_embedded && s.file_path).map((s) => [s.language, s])
  ).values()];

  const canSave = dirty && subFormat === "srt";

  // sub_id for the selected language (used by shift + alass)
  const subId = subs.find((s) => s.language === selectedLang && !s.is_embedded && s.file_path)?.id ?? null;

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
          Zpět
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
        {canSave && (
          <button
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-accent hover:bg-accent/80 text-white rounded-lg disabled:opacity-40 transition-colors flex-shrink-0"
          >
            {saveMut.isPending ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            Uložit titulky
          </button>
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
                Pro tuto epizodu není k dispozici video soubor
              </div>
            )}

            {/* Subtitle overlay */}
            {activeCue >= 0 && cues[activeCue] && (
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
                    Intro: {fmtTime(markers.intro_start)} – {fmtTime(markers.intro_end)}
                  </span>
                )}
                {markers.outro_start != null && markers.outro_end != null && (
                  <span className="flex items-center gap-1 text-[10px] text-muted/50">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500/70 inline-block flex-shrink-0" />
                    Outro: {fmtTime(markers.outro_start)} – {fmtTime(markers.outro_end)}
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
                title="Play/Pause (Mezerník)"
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
                title="Celá obrazovka (F)"
              >
                {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
              </button>
            </div>

            {/* Marker buttons + cut */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] text-muted/50 font-semibold uppercase tracking-wide">Intro:</span>
              <MarkerBtn label="▶ Začátek" color="blue" value={markers.intro_start} disabled={setMarkerMut.isPending} onSet={() => setMarker("intro_start")} />
              <MarkerBtn label="■ Konec"   color="blue" value={markers.intro_end}   disabled={setMarkerMut.isPending} onSet={() => setMarker("intro_end")}   />

              <div className="w-px h-4 bg-border mx-0.5" />

              <span className="text-[10px] text-muted/50 font-semibold uppercase tracking-wide">Outro:</span>
              <MarkerBtn label="▶ Začátek" color="red" value={markers.outro_start} disabled={setMarkerMut.isPending} onSet={() => setMarker("outro_start")} />
              <MarkerBtn label="■ Konec"   color="red" value={markers.outro_end}   disabled={setMarkerMut.isPending} onSet={() => setMarker("outro_end")}   />

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
                <Scissors size={12} /> Střihnout
              </button>
            </div>
          </div>
        </div>

        {/* ── Subtitle editor panel (1/3) ─────────────────────── */}
        <div
          className="flex flex-col border-l border-border bg-panel overflow-hidden"
          style={{ width: "33%", minWidth: "260px", maxWidth: "420px" }}
        >
          {/* Lang tabs */}
          <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border">
            <div className="flex items-center gap-1 flex-1 min-w-0 overflow-x-auto">
              {langs.length === 0 && (
                <span className="text-xs text-muted/40">Žádné titulky</span>
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

          {/* ── Shift + alass panel ──────────────────────────── */}
          <div className="flex-shrink-0 border-b border-border px-3 py-2 flex flex-col gap-1.5">
            {/* Row 1: input + quick shift buttons */}
            <div className="flex items-center gap-1 flex-wrap">
              <span className="text-[10px] text-muted/50 font-semibold uppercase tracking-wide flex-shrink-0 mr-0.5">Posun</span>
              <input
                type="number"
                value={shiftInput}
                onChange={(e) => { setShiftInput(e.target.value); setShiftMs(Number(e.target.value) || 0); }}
                className="w-16 bg-bg border border-border rounded px-1.5 py-0.5 text-xs text-text text-center font-mono focus:outline-none focus:border-accent flex-shrink-0"
                placeholder="ms"
              />
              <span className="text-[10px] text-muted/50 flex-shrink-0">ms</span>
              {[-5000, -1000, -500, -100, 100, 500, 1000, 5000].map((ms) => (
                <button
                  key={ms}
                  onClick={() => { setShiftMs(ms); setShiftInput(String(ms)); }}
                  className={clsx(
                    "text-[10px] px-1 py-0.5 rounded border transition-colors flex-shrink-0 font-mono",
                    shiftMs === ms
                      ? "bg-accent/20 border-accent text-accent"
                      : "border-border text-muted/60 hover:border-accent hover:text-text",
                  )}
                >
                  {ms > 0 ? `+${Math.abs(ms) >= 1000 ? `${ms / 1000}s` : ms}` : `${ms <= -1000 ? `${ms / 1000}s` : ms}`}
                </button>
              ))}
            </div>

            {/* Row 2: apply + alass */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => shiftMut.mutate()}
                disabled={shiftMs === 0 || shiftMut.isPending || !subId}
                className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-border bg-surface text-muted hover:border-accent hover:text-text disabled:opacity-40 transition-colors"
                title={!subId ? "Není vybrán soubor titulků" : "Aplikuj posun na soubor"}
              >
                {shiftMut.isPending ? <Loader2 size={9} className="animate-spin" /> : null}
                Aplikovat posun
              </button>
              <button
                onClick={() => alasMut.mutate()}
                disabled={alasMut.isPending || !episode?.has_file}
                className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-border bg-surface text-muted hover:border-accent hover:text-text disabled:opacity-40 transition-colors ml-auto"
                title="Automatická synchronizace pomocí alass"
              >
                {alasMut.isPending
                  ? <Loader2 size={9} className="animate-spin" />
                  : <RefreshCw size={9} />}
                {alasMut.isPending ? "Synchronizuji…" : "🔄 alass sync"}
              </button>
            </div>

            {/* Editor feedback */}
            {editorMsg && (
              <div className={clsx(
                "text-[10px] px-2 py-1 rounded",
                editorMsg.ok ? "text-green-400 bg-green-900/20" : "text-red-400 bg-red-900/20",
              )}>
                {editorMsg.text}
              </div>
            )}
          </div>

          {/* Cue list */}
          <div ref={cueListRef} className="flex-1 overflow-y-auto min-h-0">
            {cues.length === 0 && (
              <div className="flex items-center justify-center py-16 text-xs text-muted/40 text-center px-4">
                {selectedLang
                  ? "Žádné titulky pro tento jazyk"
                  : "Vyberte jazyk titulků"}
              </div>
            )}
            {cues.map((cue, i) => (
              <CueRow
                key={i}
                cue={cue}
                idx={i}
                active={activeCue === i}
                onSeek={seekTo}
                onSync={syncCueToCurrentTime}
                onSyncEnd={syncCueEndToCurrentTime}
                onEdit={(idx, text) => updateCue(idx, { text })}
              />
            ))}
          </div>

          {/* Warning: ASS can't be saved */}
          {subFormat !== "srt" && dirty && (
            <div className="flex-shrink-0 px-3 py-2 border-t border-border text-xs text-yellow-400/80 bg-yellow-900/10">
              ASS formát nelze uložit přes toto rozhraní
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
              <h3 className="text-sm font-semibold text-text">Střih videa</h3>
              <button
                onClick={() => { setShowCut(false); setCutMsg(""); }}
                className="ml-auto text-muted hover:text-text"
              >
                <X size={15} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-muted mb-1">Od (s)</label>
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
                <label className="block text-xs text-muted mb-1">Do (s)</label>
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
                Od ← {fmtTime(currentTime)}
              </button>
              <button
                onClick={() => setCutTo(Math.floor(currentTime))}
                className="flex-1 text-xs py-1.5 border border-border rounded-lg text-muted hover:text-text hover:border-accent transition-colors"
              >
                Do ← {fmtTime(currentTime)}
              </button>
            </div>

            <p className="text-xs text-muted/60">
              Délka: <span className="text-text font-mono">{fmtTime(Math.max(0, cutTo - cutFrom))}</span>
              {" · "}FFmpeg stream copy (bez re-encode)
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
                Zavřít
              </button>
              <button
                onClick={() => cutMut.mutate()}
                disabled={cutMut.isPending || cutTo <= cutFrom || !episode?.has_file}
                className="flex items-center gap-1.5 px-4 py-2 text-xs bg-accent hover:bg-accent/80 text-white rounded-lg disabled:opacity-40 transition-colors"
              >
                {cutMut.isPending
                  ? <Loader2 size={13} className="animate-spin" />
                  : <Scissors size={13} />}
                Vystřihnout
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
