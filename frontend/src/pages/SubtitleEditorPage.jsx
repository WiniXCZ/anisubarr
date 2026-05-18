/**
 * SubtitleEditorPage — full-page subtitle editor (/subtitles)
 * Design based on Studio layout from Anisubarr design handoff.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Loader2, Save, ChevronsLeft, ChevronsRight, RotateCcw,
  Pencil, Check, X, Download, ChevronRight, Film,
} from "lucide-react";
import api from "../api/client";
import clsx from "clsx";

// ── API helpers ─────────────────────────────────────────────────────────────

const getSeries   = () => api.get("/series").then(r => r.data);
const getEpisodes = (sid) => api.get(`/series/${sid}/episodes`).then(r => r.data);
const getEpSubs   = (eid) => api.get(`/subtitles/episode/${eid}`).then(r => r.data);
const getContent  = (sid) => api.get(`/subtitle-editor/${sid}`).then(r => r.data);
const doShift     = (sid, ms) =>
  api.post("/subtitle-editor/shift", { sub_id: sid, shift_ms: ms, save: false }).then(r => r.data);
const doSave      = (sid, content) =>
  api.post("/subtitle-editor/save", { sub_id: sid, content }).then(r => r.data);

// ── SRT parser → cue list ───────────────────────────────────────────────────

function parseSrtToCues(text) {
  const blocks = text.trim().split(/\n\s*\n/);
  const cues = [];
  for (const block of blocks) {
    const lines = block.split("\n").map(l => l.trim()).filter(Boolean);
    const idxLine = lines.find(l => /^\d+$/.test(l));
    const timeLine = lines.find(l => l.includes("-->"));
    if (!timeLine) continue;
    const textLines = lines.filter(l => !l.includes("-->") && !/^\d+$/.test(l));
    const m = timeLine.match(
      /(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/
    );
    cues.push({
      idx:   cues.length + 1,
      start: m ? m[1] : "",
      end:   m ? m[2] : "",
      text:  textLines.join("\n"),
      dirty: false,
    });
  }
  return cues;
}

function cuesToSrt(cues) {
  return cues.map((c, i) =>
    `${i + 1}\n${c.start} --> ${c.end}\n${c.text}`
  ).join("\n\n") + "\n";
}

// ── Duration from two SRT timestamps ────────────────────────────────────────

function tsToMs(ts) {
  const [hms, ms] = ts.split(",");
  const [h, m, s] = hms.split(":");
  return (+h * 3600 + +m * 60 + +s) * 1000 + +ms;
}
function formatDur(startTs, endTs) {
  const d = tsToMs(endTs) - tsToMs(startTs);
  if (d < 0) return "—";
  if (d < 1000) return `${d}ms`;
  return `${(d / 1000).toFixed(1)}s`;
}

// ── Language display names ───────────────────────────────────────────────────

const LANG_NAMES = {
  cs: "CS", en: "EN", ja: "JP", de: "DE", fr: "FR", pl: "PL", sk: "SK",
};

// ── CueRow — single editable subtitle row ────────────────────────────────────

function CueRow({ cue, active, onActivate, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState(cue.text);
  const taRef = useRef(null);

  useEffect(() => { setDraft(cue.text); }, [cue.text]);

  function startEdit(e) {
    e.stopPropagation();
    setEditing(true);
    setTimeout(() => taRef.current?.focus(), 0);
  }
  function commitEdit() {
    setEditing(false);
    if (draft !== cue.text) onSave(draft);
  }
  function cancelEdit() {
    setEditing(false);
    setDraft(cue.text);
  }

  return (
    <div
      onClick={onActivate}
      className={clsx(
        "group grid gap-2 px-4 py-2.5 border-b border-border cursor-pointer transition-colors",
        "hover:bg-surface",
        active && "bg-accent/10 border-l-2 border-l-accent",
        cue.dirty && "border-l-2 border-l-yellow-500",
      )}
      style={{ gridTemplateColumns: "2.5rem 9rem 1fr 3.5rem" }}
    >
      {/* Index */}
      <span className="text-xs font-mono text-muted/60 pt-0.5 select-none">{cue.idx}</span>

      {/* Timing */}
      <div className="flex flex-col gap-0.5 pt-0.5">
        <span className="text-xs font-mono text-text leading-none">{cue.start.replace(",", ".")}</span>
        <span className="text-xs font-mono text-text leading-none">{cue.end.replace(",", ".")}</span>
        <span className="text-[10px] font-mono text-muted/50 leading-none">{formatDur(cue.start, cue.end)}</span>
      </div>

      {/* Text / inline editor */}
      <div className="min-w-0">
        {editing ? (
          <textarea
            ref={taRef}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commitEdit(); }
            }}
            onClick={e => e.stopPropagation()}
            rows={Math.max(1, (draft.match(/\n/g) || []).length + 1)}
            className="w-full bg-bg border border-accent rounded px-2 py-1 text-sm text-text resize-none focus:outline-none font-sans"
          />
        ) : (
          <p className="text-sm text-text leading-snug whitespace-pre-wrap break-words">{cue.text || <em className="text-muted text-xs">prázdné</em>}</p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-start justify-end gap-1 pt-0.5">
        {editing ? (
          <>
            <button
              onClick={e => { e.stopPropagation(); commitEdit(); }}
              className="p-1 rounded text-green-400 hover:bg-green-900/20 transition-colors"
              title="Uložit (Enter)"
            ><Check size={13} /></button>
            <button
              onClick={e => { e.stopPropagation(); cancelEdit(); }}
              className="p-1 rounded text-muted hover:bg-border transition-colors"
              title="Zrušit (Esc)"
            ><X size={13} /></button>
          </>
        ) : (
          <button
            onClick={startEdit}
            className="p-1 rounded text-muted opacity-0 group-hover:opacity-100 hover:text-accent hover:bg-border transition-colors"
            title="Upravit text"
          ><Pencil size={13} /></button>
        )}
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function SubtitleEditorPage() {
  const [seriesId,  setSeriesId]  = useState("");
  const [episodeId, setEpisodeId] = useState("");
  const [subId,     setSubId]     = useState("");
  const [cues,      setCues]      = useState([]);
  const [activeCue, setActiveCue] = useState(null);
  const [shiftMs,   setShiftMs]   = useState(0);
  const [shiftInput, setShiftInput] = useState("0");
  const [dirty,     setDirty]     = useState(false);
  const [saveMsg,   setSaveMsg]   = useState(null); // {ok: bool, text: string}
  const [episodes,  setEpisodes]  = useState([]);
  const [subs,      setSubs]      = useState([]);

  const qc = useQueryClient();

  // Load all series
  const { data: allSeries = [] } = useQuery({
    queryKey: ["series"],
    queryFn: getSeries,
    staleTime: 60_000,
  });

  // Load episodes when series changes
  useEffect(() => {
    if (!seriesId) { setEpisodes([]); setEpisodeId(""); setSubs([]); setSubId(""); setCues([]); return; }
    getEpisodes(seriesId).then(eps => {
      setEpisodes(eps.filter(e => e.has_file));
      setEpisodeId("");
      setSubs([]);
      setSubId("");
      setCues([]);
    });
  }, [seriesId]);

  // Load subs when episode changes
  useEffect(() => {
    if (!episodeId) { setSubs([]); setSubId(""); setCues([]); return; }
    getEpSubs(episodeId).then(data => {
      setSubs(data);
      if (data.length > 0) setSubId(String(data[0].id));
      else { setSubId(""); setCues([]); }
    });
  }, [episodeId]);

  // Load subtitle content when sub changes
  const { data: subData, isLoading: loadingContent } = useQuery({
    queryKey: ["sub-content", subId],
    queryFn: () => getContent(subId),
    enabled: !!subId,
  });
  useEffect(() => {
    if (subData) {
      setCues(parseSrtToCues(subData.content));
      setDirty(false);
      setShiftMs(0);
      setShiftInput("0");
      setSaveMsg(null);
      setActiveCue(null);
    }
  }, [subData]);

  // Edit a single cue's text
  const editCue = useCallback((idx, newText) => {
    setCues(prev => prev.map((c, i) =>
      i === idx ? { ...c, text: newText, dirty: true } : c
    ));
    setDirty(true);
  }, []);

  // Shift mutation (preview)
  const shiftMut = useMutation({
    mutationFn: () => doShift(subId, shiftMs),
    onSuccess: (data) => {
      setCues(parseSrtToCues(data.content));
      setDirty(true);
    },
  });

  // Save mutation
  const saveMut = useMutation({
    mutationFn: () => doSave(subId, cuesToSrt(cues)),
    onSuccess: () => {
      setSaveMsg({ ok: true, text: "Uloženo na disk ✓" });
      setDirty(false);
      setTimeout(() => setSaveMsg(null), 4000);
    },
    onError: (e) => setSaveMsg({ ok: false, text: `Chyba: ${e.message}` }),
  });

  const selectedSub    = subs.find(s => String(s.id) === String(subId));
  const selectedSeries = allSeries.find(s => String(s.id) === String(seriesId));
  const selectedEp     = episodes.find(e => String(e.id) === String(episodeId));

  return (
    <div className="-mx-4 -my-6 flex flex-col" style={{ height: "calc(100vh - 3.5rem)" }}>

      {/* ── Top header bar ─────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 border-b border-border bg-surface px-4 py-3 flex flex-wrap items-center gap-3">

        {/* Series picker */}
        <div className="flex items-center gap-2 min-w-0">
          <Film size={14} className="text-muted flex-shrink-0" />
          <select
            value={seriesId}
            onChange={e => setSeriesId(e.target.value)}
            className="bg-bg border border-border rounded-lg px-2.5 py-1.5 text-sm text-text focus:outline-none focus:border-accent min-w-[180px] max-w-[260px]"
          >
            <option value="">Vyber anime…</option>
            {allSeries.map(s => (
              <option key={s.id} value={s.id}>{s.title_romaji || s.title}</option>
            ))}
          </select>
        </div>

        {/* Episode chips */}
        {episodes.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap min-w-0">
            {episodes.map(ep => {
              const label = `E${String(ep.episode_number).padStart(2, "0")}`;
              return (
                <button
                  key={ep.id}
                  onClick={() => setEpisodeId(String(ep.id))}
                  className={clsx(
                    "px-2.5 py-1 text-xs font-mono rounded-md border transition-colors",
                    String(ep.id) === episodeId
                      ? "bg-accent border-accent text-white"
                      : "border-border text-muted hover:border-accent hover:text-text"
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}

        {/* Sub file tabs */}
        {subs.length > 0 && (
          <div className="flex items-center gap-1">
            {subs.map(s => {
              const lang = LANG_NAMES[s.language] || s.language?.toUpperCase();
              return (
                <button
                  key={s.id}
                  onClick={() => setSubId(String(s.id))}
                  className={clsx(
                    "px-2.5 py-1 text-xs rounded-md border transition-colors",
                    String(s.id) === subId
                      ? "bg-accent/20 border-accent text-accent"
                      : "border-border text-muted hover:border-accent hover:text-text"
                  )}
                >
                  {lang}
                  <span className="ml-1 text-[10px] opacity-60">.{s.format}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Status + save */}
        {saveMsg && (
          <span className={clsx(
            "text-xs px-2 py-1 rounded",
            saveMsg.ok ? "text-green-400 bg-green-900/20" : "text-red-400 bg-red-900/20"
          )}>{saveMsg.text}</span>
        )}
        {dirty && !saveMsg && (
          <span className="text-xs text-yellow-400 bg-yellow-900/20 px-2 py-1 rounded">
            neuloženo
          </span>
        )}
        <button
          onClick={() => saveMut.mutate()}
          disabled={!dirty || saveMut.isPending || !subId}
          className="flex items-center gap-1.5 text-sm px-3 py-1.5 bg-accent hover:bg-accent-hover disabled:opacity-40 text-white rounded-lg transition-colors"
        >
          {saveMut.isPending ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
          Uložit
        </button>
      </div>

      {/* ── Body: cue table + sidebar ─────────────────────────────────────── */}
      <div className="flex-1 flex min-h-0">

        {/* Cue table */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {/* Column headers */}
          {cues.length > 0 && (
            <div
              className="sticky top-0 z-10 bg-surface border-b border-border px-4 py-1.5 grid gap-2 text-[10px] font-semibold text-muted uppercase tracking-wide"
              style={{ gridTemplateColumns: "2.5rem 9rem 1fr 3.5rem" }}
            >
              <span>#</span>
              <span>Časování</span>
              <span>Text</span>
              <span />
            </div>
          )}

          {loadingContent && (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={20} className="animate-spin text-muted" />
            </div>
          )}

          {!seriesId && (
            <div className="flex flex-col items-center justify-center py-24 gap-3 text-muted">
              <Film size={36} className="opacity-30" />
              <p className="text-sm">Vyber anime a epizodu pro editaci titulků</p>
            </div>
          )}

          {seriesId && episodeId && !loadingContent && subs.length === 0 && (
            <p className="text-sm text-muted text-center py-16">
              Pro tuto epizodu nebyly nalezeny žádné titulky
            </p>
          )}

          {seriesId && !episodeId && (
            <div className="flex flex-col items-center justify-center py-16 text-muted gap-2">
              <ChevronRight size={20} className="opacity-40" />
              <p className="text-sm">Vyber epizodu výše</p>
            </div>
          )}

          {cues.map((cue, i) => (
            <CueRow
              key={i}
              cue={cue}
              active={activeCue === i}
              onActivate={() => setActiveCue(i)}
              onSave={(text) => editCue(i, text)}
            />
          ))}

          {cues.length > 0 && (
            <div className="py-4 text-center text-xs text-muted/50">
              {cues.length} řádků
            </div>
          )}
        </div>

        {/* ── Right sidebar — shift controls ─────────────────────────────── */}
        <div className="w-64 flex-shrink-0 border-l border-border bg-surface flex flex-col gap-4 p-4 overflow-y-auto">

          {/* File info */}
          {selectedSub && (
            <div className="flex flex-col gap-1">
              <p className="text-[10px] font-semibold text-muted uppercase tracking-wide">Soubor</p>
              <p className="text-xs text-text font-mono break-all">
                {selectedSub.language?.toUpperCase()} · {selectedSub.format?.toUpperCase()} · {selectedSub.source}
              </p>
              {selectedSeries && (
                <p className="text-xs text-muted">{selectedSeries.title_romaji || selectedSeries.title}</p>
              )}
              {selectedEp && (
                <p className="text-xs text-muted">
                  S{String(selectedEp.season_number).padStart(2,"0")}E{String(selectedEp.episode_number).padStart(2,"0")}
                  {selectedEp.title ? " — " + selectedEp.title.slice(0,30) : ""}
                </p>
              )}
            </div>
          )}

          <div className="border-t border-border" />

          {/* Shift controls */}
          <div className="flex flex-col gap-3">
            <p className="text-[10px] font-semibold text-muted uppercase tracking-wide">Posun časování</p>
            <p className="text-xs text-muted leading-relaxed">
              Posuň všechny titulky o zadaný počet ms.
              Kladná hodnota = zpoždění, záporná = urychlení.
            </p>

            {/* Quick buttons */}
            <div className="grid grid-cols-2 gap-1.5">
              {[-5000, -2000, -1000, -500, -100, 100, 500, 1000, 2000, 5000].map(ms => (
                <button
                  key={ms}
                  onClick={() => { setShiftMs(ms); setShiftInput(String(ms)); }}
                  className={clsx(
                    "text-xs py-1.5 rounded border transition-colors text-center",
                    shiftMs === ms
                      ? "bg-accent border-accent text-white"
                      : "border-border text-muted hover:border-accent hover:text-text"
                  )}
                >
                  {ms > 0 ? `+${ms >= 1000 ? `${ms/1000}s` : `${ms}`}` : (ms <= -1000 ? `${ms/1000}s` : `${ms}`)}
                </button>
              ))}
            </div>

            {/* Custom input */}
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={shiftInput}
                onChange={e => { setShiftInput(e.target.value); setShiftMs(Number(e.target.value) || 0); }}
                placeholder="ms"
                className="flex-1 min-w-0 bg-bg border border-border rounded-lg px-2.5 py-1.5 text-sm text-text focus:outline-none focus:border-accent"
              />
              <span className="text-xs text-muted flex-shrink-0">ms</span>
            </div>

            {/* Apply / reset */}
            <button
              onClick={() => shiftMut.mutate()}
              disabled={shiftMs === 0 || shiftMut.isPending || !subId}
              className="flex items-center justify-center gap-1.5 text-sm px-3 py-1.5 bg-accent hover:bg-accent-hover disabled:opacity-40 text-white rounded-lg transition-colors"
            >
              {shiftMut.isPending ? <Loader2 size={13} className="animate-spin" /> : (
                shiftMs >= 0 ? <ChevronsRight size={13} /> : <ChevronsLeft size={13} />
              )}
              Aplikovat posun
            </button>
            <button
              onClick={() => {
                if (subData) {
                  setCues(parseSrtToCues(subData.content));
                  setDirty(false);
                  setShiftMs(0);
                  setShiftInput("0");
                }
              }}
              disabled={!dirty}
              className="flex items-center justify-center gap-1 text-xs py-1.5 border border-border rounded-lg text-muted hover:text-text hover:border-accent disabled:opacity-40 transition-colors"
            >
              <RotateCcw size={12} /> Resetovat na originál
            </button>
          </div>

          <div className="border-t border-border" />

          {/* Stats */}
          {cues.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-[10px] font-semibold text-muted uppercase tracking-wide">Statistiky</p>
              <div className="flex flex-col gap-1 text-xs text-muted">
                <div className="flex justify-between">
                  <span>Řádků celkem</span>
                  <span className="text-text font-mono">{cues.length}</span>
                </div>
                <div className="flex justify-between">
                  <span>Upraveno</span>
                  <span className="text-text font-mono">{cues.filter(c => c.dirty).length}</span>
                </div>
                {cues.length > 0 && (
                  <div className="flex justify-between">
                    <span>Délka</span>
                    <span className="text-text font-mono">{cues[cues.length - 1].end}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
