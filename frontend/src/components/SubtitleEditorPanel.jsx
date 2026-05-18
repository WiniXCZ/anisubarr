/**
 * SubtitleEditorPanel — sliding panel for manual subtitle shifting and editing.
 * No audio analysis — purely manual offset in milliseconds.
 */
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Subtitles, X, ChevronDown, Loader2, Save,
  ChevronsLeft, ChevronsRight, RotateCcw,
} from "lucide-react";
import api from "../api/client";
import clsx from "clsx";

const getSeries  = () => api.get("/series").then(r => r.data);
const getEpSubs  = (eid) => api.get(`/subtitles/episode/${eid}`).then(r => r.data);
const getContent = (sid) => api.get(`/subtitle-editor/${sid}`).then(r => r.data);
const doShift    = (sid, ms, save) =>
  api.post("/subtitle-editor/shift", { sub_id: sid, shift_ms: ms, save }).then(r => r.data);
const doSave     = (sid, content) =>
  api.post("/subtitle-editor/save", { sub_id: sid, content }).then(r => r.data);

const LANG_NAMES = {
  cs: "Čeština", en: "Angličtina", ja: "Japonština", de: "Němčina",
  fr: "Francouzština", pl: "Polština", sk: "Slovenština",
};

// ── SRT parser for preview ────────────────────────────────────────────────────

function parseSrt(text) {
  const blocks = text.trim().split(/\n\s*\n/);
  return blocks.slice(0, 60).map(b => {
    const lines = b.split("\n");
    const timeMatch = lines.find(l => l.includes("-->"));
    return {
      time: timeMatch?.trim() || "",
      text: lines.filter(l => l.trim() && !l.includes("-->") && !/^\d+$/.test(l.trim())).join(" "),
    };
  }).filter(b => b.time);
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function SubtitleEditorPanel({ open, onClose }) {
  const [seriesId,  setSeriesId]  = useState("");
  const [episodeId, setEpisodeId] = useState("");
  const [subId,     setSubId]     = useState("");
  const [shiftMs,   setShiftMs]   = useState(0);
  const [shiftInput, setShiftInput] = useState("0");
  const [content,   setContent]   = useState("");
  const [dirty,     setDirty]     = useState(false);
  const [saveMsg,   setSaveMsg]   = useState("");

  const qc = useQueryClient();

  // Load series list
  const { data: allSeries = [] } = useQuery({
    queryKey: ["series"],
    queryFn: getSeries,
    staleTime: 60_000,
    enabled: open,
  });

  // Load episodes when series selected
  const [episodes, setEpisodes] = useState([]);
  useEffect(() => {
    if (!seriesId) { setEpisodes([]); setEpisodeId(""); return; }
    api.get(`/series/${seriesId}/episodes`).then(r => {
      setEpisodes(r.data.filter(e => e.has_file));
      setEpisodeId("");
      setSubId("");
      setContent("");
    });
  }, [seriesId]);

  // Load subs when episode selected
  const [subs, setSubs] = useState([]);
  useEffect(() => {
    if (!episodeId) { setSubs([]); setSubId(""); setContent(""); return; }
    getEpSubs(episodeId).then(data => {
      setSubs(data);
      setSubId("");
      setContent("");
    });
  }, [episodeId]);

  // Load content when sub selected
  const { data: subData, isLoading: loadingContent } = useQuery({
    queryKey: ["sub-content", subId],
    queryFn: () => getContent(subId),
    enabled: !!subId,
  });
  useEffect(() => {
    if (subData) { setContent(subData.content); setDirty(false); setShiftMs(0); setShiftInput("0"); }
  }, [subData]);

  // Shift mutation (preview only — just updates content in state)
  const shiftMut = useMutation({
    mutationFn: () => doShift(subId, shiftMs, false),
    onSuccess: (data) => { setContent(data.content); setDirty(true); },
  });

  // Save mutation
  const saveMut = useMutation({
    mutationFn: () => doSave(subId, content),
    onSuccess: () => {
      setSaveMsg("Uloženo ✓");
      setDirty(false);
      setTimeout(() => setSaveMsg(""), 3000);
    },
  });

  const preview = content ? parseSrt(content) : [];
  const selectedSub = subs.find(s => String(s.id) === String(subId));

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      {/* Backdrop */}
      <div className="flex-1 bg-black/40" />

      {/* Panel */}
      <div
        className="w-full max-w-2xl bg-surface border-l border-border flex flex-col h-full shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <Subtitles size={16} className="text-accent" />
            <h2 className="text-sm font-semibold text-text">Editor titulků</h2>
            {dirty && <span className="text-xs text-yellow-400 bg-yellow-900/20 px-1.5 py-0.5 rounded">neuloženo</span>}
          </div>
          <button onClick={onClose} className="p-1.5 text-muted hover:text-text hover:bg-border rounded-lg transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto flex flex-col gap-4 p-4">

          {/* Selectors */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted">Anime</label>
              <select
                value={seriesId}
                onChange={e => setSeriesId(e.target.value)}
                className="bg-bg border border-border rounded-lg px-2 py-1.5 text-sm text-text focus:outline-none focus:border-accent"
              >
                <option value="">Vyber anime…</option>
                {allSeries.map(s => (
                  <option key={s.id} value={s.id}>{s.title_romaji || s.title}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted">Epizoda</label>
              <select
                value={episodeId}
                onChange={e => setEpisodeId(e.target.value)}
                disabled={!episodes.length}
                className="bg-bg border border-border rounded-lg px-2 py-1.5 text-sm text-text focus:outline-none focus:border-accent disabled:opacity-40"
              >
                <option value="">Vyber epizodu…</option>
                {episodes.map(ep => (
                  <option key={ep.id} value={ep.id}>
                    S{String(ep.season_number).padStart(2,"0")}E{String(ep.episode_number).padStart(2,"0")}{ep.title ? " — " + ep.title.slice(0,30) : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted">Titulek</label>
              <select
                value={subId}
                onChange={e => setSubId(e.target.value)}
                disabled={!subs.length}
                className="bg-bg border border-border rounded-lg px-2 py-1.5 text-sm text-text focus:outline-none focus:border-accent disabled:opacity-40"
              >
                <option value="">Vyber titulek…</option>
                {subs.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.language?.toUpperCase()} · {LANG_NAMES[s.language] || s.language} [{s.format}] ({s.source})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {loadingContent && (
            <div className="flex justify-center py-8">
              <Loader2 size={18} className="animate-spin text-muted" />
            </div>
          )}

          {subId && content && (
            <>
              {/* Shift controls */}
              <div className="bg-bg border border-border rounded-xl p-4 flex flex-col gap-3">
                <p className="text-xs font-semibold text-text uppercase tracking-wide">Posun časování</p>
                <p className="text-xs text-muted">
                  Ručně posuň všechny titulky o zadaný počet milisekund.
                  Kladná hodnota = zpoždění, záporná = urychlení.
                </p>

                <div className="flex items-center gap-2 flex-wrap">
                  {/* Quick buttons */}
                  {[-5000,-2000,-1000,-500,-100, 100, 500, 1000, 2000, 5000].map(ms => (
                    <button
                      key={ms}
                      onClick={() => { setShiftMs(ms); setShiftInput(String(ms)); }}
                      className={clsx(
                        "text-xs px-2 py-1 rounded border transition-colors",
                        shiftMs === ms
                          ? "bg-accent border-accent text-white"
                          : "border-border text-muted hover:border-accent hover:text-text"
                      )}
                    >
                      {ms > 0 ? "+" : ""}{ms > 0 ? (ms >= 1000 ? `+${ms/1000}s` : `+${ms}`) : (ms <= -1000 ? `${ms/1000}s` : `${ms}`)}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={shiftInput}
                    onChange={e => { setShiftInput(e.target.value); setShiftMs(Number(e.target.value) || 0); }}
                    placeholder="ms"
                    className="w-24 bg-surface border border-border rounded-lg px-3 py-1.5 text-sm text-text focus:outline-none focus:border-accent"
                  />
                  <span className="text-xs text-muted">ms</span>
                  <button
                    onClick={() => shiftMut.mutate()}
                    disabled={shiftMs === 0 || shiftMut.isPending}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-accent hover:bg-accent-hover disabled:opacity-40 text-white rounded-lg transition-colors"
                  >
                    {shiftMut.isPending ? <Loader2 size={12} className="animate-spin" /> : (
                      shiftMs > 0 ? <ChevronsRight size={12} /> : <ChevronsLeft size={12} />
                    )}
                    Aplikovat posun
                  </button>
                  <button
                    onClick={() => { if (subData) { setContent(subData.content); setDirty(false); setShiftMs(0); setShiftInput("0"); } }}
                    className="flex items-center gap-1 text-xs px-2 py-1.5 border border-border rounded-lg text-muted hover:text-text hover:border-accent transition-colors"
                    title="Resetovat na originál"
                  >
                    <RotateCcw size={12} /> Reset
                  </button>
                </div>
              </div>

              {/* Preview */}
              <div className="flex flex-col gap-2 flex-1">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-text uppercase tracking-wide">Náhled (prvních 60 řádků)</p>
                  <button
                    onClick={() => saveMut.mutate()}
                    disabled={!dirty || saveMut.isPending}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-green-700 hover:bg-green-600 disabled:opacity-40 text-white rounded-lg transition-colors"
                  >
                    {saveMut.isPending ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                    Uložit na disk
                  </button>
                </div>
                {saveMsg && <p className="text-xs text-green-400">{saveMsg}</p>}

                <div className="bg-bg border border-border rounded-xl overflow-hidden">
                  {preview.map((cue, i) => (
                    <div key={i} className="flex gap-3 px-3 py-2 border-b border-border last:border-0 text-xs">
                      <span className="font-mono text-muted/60 flex-shrink-0 w-44 truncate">{cue.time}</span>
                      <span className="text-text-dim flex-1">{cue.text}</span>
                    </div>
                  ))}
                </div>

                {/* Raw editor */}
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted hover:text-text py-1">Zobrazit / editovat surový text</summary>
                  <textarea
                    value={content}
                    onChange={e => { setContent(e.target.value); setDirty(true); }}
                    className="w-full mt-2 h-64 bg-bg border border-border rounded-lg p-3 font-mono text-xs text-text focus:outline-none focus:border-accent resize-none"
                  />
                </details>
              </div>
            </>
          )}

          {!subId && !loadingContent && (
            <p className="text-center py-16 text-muted text-sm">
              Vyber anime → epizodu → titulek pro editaci.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
