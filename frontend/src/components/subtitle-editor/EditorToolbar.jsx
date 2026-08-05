/**
 * The operations that act on the whole file: shift, stretch, repair, replace.
 *
 * They live above the cue list rather than in a menu because they are the ones
 * that fix a downloaded subtitle in one go — a file that is late by two seconds
 * or timed for the wrong frame rate is wrong on every line, and fixing that
 * line by line is not editing, it's data entry.
 */
import { useState } from "react";
import {
  Loader2, Undo2, Redo2, Wand2, Timer, Search, Save, Plus, X, RefreshCw,
} from "lucide-react";
import clsx from "clsx";
import { useT } from "../../i18n/I18nContext";
import { fmtClock } from "./time";
import * as ops from "./ops";

const QUICK_SHIFTS = [-5, -1, -0.5, -0.1, 0.1, 0.5, 1, 5];

function Dialog({ title, icon, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
         onClick={onClose}>
      <div className="bg-panel border border-border rounded-xl p-4 w-[26rem] max-w-full flex flex-col gap-3 shadow-2xl"
           onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          {icon}
          <h3 className="text-sm font-semibold text-text">{title}</h3>
          <button onClick={onClose} className="ml-auto text-muted hover:text-text"><X size={15} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

const btn = "flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-border bg-surface " +
            "text-muted hover:border-accent hover:text-text disabled:opacity-40 transition-colors";

export default function EditorToolbar({
  cues, onCues, currentTime, analysis, dirty, saving, onSave,
  onUndo, onRedo, canUndo, canRedo, selection, onInsert,
  onAutoSync, autoSyncing, canAutoSync,
}) {
  const t = useT();
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);
  const [dialog, setDialog] = useState(null);

  // Shift
  const [shiftSec, setShiftSec] = useState(0);
  const [tailOnly, setTailOnly] = useState(false);
  // Fix
  const [rules, setRules] = useState(ops.SAFE_RULES);
  // Two-point sync
  const [pts, setPts] = useState({ subA: "", vidA: "", subB: "", vidB: "" });
  // Replace
  const [find, setFind] = useState("");
  const [repl, setRepl] = useState("");
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(true);

  const empty = cues.length === 0;

  async function run(name, fn) {
    setBusy(name);
    setMsg(null);
    try {
      const done = await fn();
      if (done?.lines) onCues(done.lines);
      if (done?.text) setMsg({ ok: true, text: done.text });
      if (done?.close) setDialog(null);
    } catch (e) {
      setMsg({ ok: false, text: e?.response?.data?.detail || e.message });
    } finally {
      setBusy(null);
    }
  }

  const issueTotal = Object.values(analysis?.summary || {}).reduce((a, b) => a + b, 0);

  return (
    <div className="flex-shrink-0 border-b border-border px-2 py-1.5 flex flex-col gap-1.5">

      {/* Row 1: history, whole-file tools, save */}
      <div className="flex items-center gap-1 flex-wrap">
        <button className={btn} onClick={onUndo} disabled={!canUndo} title={t("sube_undo_title")}>
          <Undo2 size={11} />
        </button>
        <button className={btn} onClick={onRedo} disabled={!canRedo} title={t("sube_redo_title")}>
          <Redo2 size={11} />
        </button>

        <div className="w-px h-4 bg-border mx-0.5" />

        <button className={btn} disabled={empty} onClick={() => { setMsg(null); setDialog("fix"); }}>
          <Wand2 size={11} /> {t("sube_fix_btn")}
          {issueTotal > 0 && (
            <span className="ml-0.5 px-1 rounded bg-yellow-900/40 text-yellow-400 font-mono">{issueTotal}</span>
          )}
        </button>
        <button className={btn} disabled={empty} onClick={() => { setMsg(null); setDialog("sync"); }}>
          <Timer size={11} /> {t("sube_sync_btn")}
        </button>
        <button className={btn} disabled={empty} onClick={() => { setMsg(null); setDialog("replace"); }}>
          <Search size={11} /> {t("sube_replace_btn")}
        </button>
        <button className={btn} onClick={() => onInsert(currentTime)} title={t("sube_insert_title")}>
          <Plus size={11} /> {t("sube_insert_btn")}
        </button>
        {/* alass listens to the audio, so it needs the video, not the cue list */}
        <button className={btn} disabled={!canAutoSync || autoSyncing}
                onClick={onAutoSync} title={t("player_alass_sync_title")}>
          {autoSyncing ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
          {t("player_alass_sync_btn")}
        </button>

        <div className="flex-1" />

        <button
          onClick={onSave}
          disabled={!dirty || saving}
          className={clsx(
            "flex items-center gap-1 text-[10px] px-2 py-1 rounded transition-colors",
            dirty ? "bg-accent hover:bg-accent/80 text-white" : "border border-border text-muted",
            "disabled:opacity-40",
          )}
        >
          {saving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
          {t("sube_save_btn")}
        </button>
      </div>

      {/* Row 2: shift */}
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-[10px] text-muted/50 font-semibold uppercase tracking-wide mr-0.5">
          {t("sube_shift_label")}
        </span>
        {QUICK_SHIFTS.map((s) => (
          <button
            key={s}
            className={btn + " font-mono"}
            disabled={empty || busy === "shift"}
            onClick={() => run("shift", async () => ({
              lines: (await ops.shiftLines(cues, s, tailOnly ? selection.first ?? 0 : 0)).lines,
            }))}
          >
            {s > 0 ? `+${s}` : s}s
          </button>
        ))}
        <input
          type="number"
          step="0.1"
          value={shiftSec}
          onChange={(e) => setShiftSec(Number(e.target.value) || 0)}
          className="w-14 bg-bg border border-border rounded px-1 py-0.5 text-[10px] text-text text-center font-mono focus:outline-none focus:border-accent"
        />
        <button
          className={btn}
          disabled={empty || !shiftSec || busy === "shift"}
          onClick={() => run("shift", async () => ({
            lines: (await ops.shiftLines(cues, shiftSec, tailOnly ? selection.first ?? 0 : 0)).lines,
          }))}
        >
          {busy === "shift" ? <Loader2 size={9} className="animate-spin" /> : null}
          {t("sube_shift_apply")}
        </button>
        <label className="flex items-center gap-1 text-[10px] text-muted cursor-pointer"
               title={t("sube_tail_only_title")}>
          <input type="checkbox" checked={tailOnly} onChange={(e) => setTailOnly(e.target.checked)}
                 className="w-3 h-3 accent-accent" />
          {t("sube_tail_only")}
          {tailOnly && selection.first != null && (
            <span className="font-mono text-muted/50">#{selection.first + 1}</span>
          )}
        </label>
      </div>

      {/* Feedback — a dialog shows its own, so it isn't repeated here */}
      {msg && !dialog && (
        <div className={clsx("text-[10px] px-2 py-1 rounded",
          msg.ok ? "text-green-400 bg-green-900/20" : "text-red-400 bg-red-900/20")}>
          {msg.text}
        </div>
      )}

      {/* ── Fix dialog ─────────────────────────────────────────── */}
      {dialog === "fix" && (
        <Dialog title={t("sube_fix_title")} icon={<Wand2 size={15} className="text-accent" />}
                onClose={() => setDialog(null)}>
          <p className="text-xs text-muted leading-relaxed">{t("sube_fix_desc")}</p>

          <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
            {ops.FIX_RULES.map((rule) => {
              const found = analysis?.summary?.[
                { order: "order", empty: "empty", overlap: "overlap",
                  min_duration: "short", max_duration: "long" }[rule]
              ];
              return (
                <label key={rule} className="flex items-start gap-2 text-xs text-text cursor-pointer py-0.5">
                  <input
                    type="checkbox"
                    checked={rules.includes(rule)}
                    onChange={(e) => setRules((prev) =>
                      e.target.checked ? [...prev, rule] : prev.filter((r) => r !== rule))}
                    className="w-3.5 h-3.5 accent-accent mt-0.5 flex-shrink-0"
                  />
                  <span className="flex-1">
                    {t(`sube_rule_${rule}`)}
                    <span className="block text-[10px] text-muted leading-snug">{t(`sube_rule_${rule}_desc`)}</span>
                  </span>
                  {found > 0 && (
                    <span className="text-[10px] font-mono text-yellow-400 bg-yellow-900/25 px-1 rounded flex-shrink-0">
                      {found}
                    </span>
                  )}
                </label>
              );
            })}
          </div>

          {msg && (
            <div className={clsx("text-[11px] px-2 py-1.5 rounded",
              msg.ok ? "text-green-400 bg-green-900/20" : "text-red-400 bg-red-900/20")}>
              {msg.text}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button onClick={() => setDialog(null)}
                    className="px-3 py-1.5 text-xs text-muted hover:text-text border border-border rounded-lg">
              {t("lib_close")}
            </button>
            <button
              disabled={rules.length === 0 || busy === "fix"}
              onClick={() => run("fix", async () => {
                const res = await ops.fixErrors(cues, rules);
                const changed = Object.entries(res.report);
                return {
                  lines: res.lines,
                  text: changed.length
                    ? `${t("sube_fix_done")} ${changed.map(([r, n]) => `${t(`sube_rule_${r}`)}: ${n}`).join(" · ")}`
                    : t("sube_fix_nothing"),
                };
              })}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-accent hover:bg-accent/80 text-white rounded-lg disabled:opacity-40"
            >
              {busy === "fix" ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
              {t("sube_fix_run")}
            </button>
          </div>
        </Dialog>
      )}

      {/* ── Two-point sync dialog ──────────────────────────────── */}
      {dialog === "sync" && (
        <Dialog title={t("sube_sync_title")} icon={<Timer size={15} className="text-accent" />}
                onClose={() => setDialog(null)}>
          <p className="text-xs text-muted leading-relaxed">{t("sube_sync_desc")}</p>

          {[["A", "subA", "vidA"], ["B", "subB", "vidB"]].map(([label, subKey, vidKey]) => (
            <div key={label} className="flex items-center gap-2">
              <span className="text-xs font-semibold text-muted w-4">{label}</span>
              <input
                placeholder={t("sube_sync_in_subs")}
                value={pts[subKey]}
                onChange={(e) => setPts((p) => ({ ...p, [subKey]: e.target.value }))}
                className="flex-1 min-w-0 bg-bg border border-border rounded px-2 py-1 text-xs font-mono text-text focus:outline-none focus:border-accent"
              />
              <span className="text-muted text-xs">→</span>
              <input
                placeholder={t("sube_sync_in_video")}
                value={pts[vidKey]}
                onChange={(e) => setPts((p) => ({ ...p, [vidKey]: e.target.value }))}
                className="flex-1 min-w-0 bg-bg border border-border rounded px-2 py-1 text-xs font-mono text-text focus:outline-none focus:border-accent"
              />
              <button
                onClick={() => setPts((p) => ({ ...p, [vidKey]: currentTime.toFixed(3) }))}
                title={t("sube_sync_from_playhead")}
                className={btn + " flex-shrink-0"}
              >
                {fmtClock(currentTime)}
              </button>
            </div>
          ))}

          {msg && (
            <div className={clsx("text-[11px] px-2 py-1.5 rounded",
              msg.ok ? "text-green-400 bg-green-900/20" : "text-red-400 bg-red-900/20")}>
              {msg.text}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button onClick={() => setDialog(null)}
                    className="px-3 py-1.5 text-xs text-muted hover:text-text border border-border rounded-lg">
              {t("lib_close")}
            </button>
            <button
              disabled={busy === "sync"}
              onClick={() => run("sync", async () => {
                const nums = ["subA", "vidA", "subB", "vidB"].map((k) => Number(pts[k]));
                if (nums.some((n) => !Number.isFinite(n))) throw new Error(t("sube_sync_need_numbers"));
                const res = await ops.syncPoints(cues, [nums[0], nums[1]], [nums[2], nums[3]]);
                return { lines: res.lines, text: t("sube_sync_done"), close: true };
              })}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-accent hover:bg-accent/80 text-white rounded-lg disabled:opacity-40"
            >
              {busy === "sync" ? <Loader2 size={12} className="animate-spin" /> : <Timer size={12} />}
              {t("sube_sync_run")}
            </button>
          </div>
        </Dialog>
      )}

      {/* ── Find & replace dialog ──────────────────────────────── */}
      {dialog === "replace" && (
        <Dialog title={t("sube_replace_title")} icon={<Search size={15} className="text-accent" />}
                onClose={() => setDialog(null)}>
          <input
            placeholder={t("sube_replace_find")}
            value={find}
            onChange={(e) => setFind(e.target.value)}
            className="bg-bg border border-border rounded px-2 py-1.5 text-sm text-text focus:outline-none focus:border-accent"
          />
          <input
            placeholder={t("sube_replace_with")}
            value={repl}
            onChange={(e) => setRepl(e.target.value)}
            className="bg-bg border border-border rounded px-2 py-1.5 text-sm text-text focus:outline-none focus:border-accent"
          />
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-1.5 text-xs text-muted cursor-pointer">
              <input type="checkbox" checked={caseSensitive} className="w-3.5 h-3.5 accent-accent"
                     onChange={(e) => setCaseSensitive(e.target.checked)} />
              {t("sube_replace_case")}
            </label>
            <label className="flex items-center gap-1.5 text-xs text-muted cursor-pointer">
              <input type="checkbox" checked={regex} className="w-3.5 h-3.5 accent-accent"
                     onChange={(e) => setRegex(e.target.checked)} />
              {t("sube_replace_regex")}
            </label>
          </div>

          {msg && (
            <div className={clsx("text-[11px] px-2 py-1.5 rounded",
              msg.ok ? "text-green-400 bg-green-900/20" : "text-red-400 bg-red-900/20")}>
              {msg.text}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button onClick={() => setDialog(null)}
                    className="px-3 py-1.5 text-xs text-muted hover:text-text border border-border rounded-lg">
              {t("lib_close")}
            </button>
            <button
              disabled={!find || busy === "replace"}
              onClick={() => run("replace", async () => {
                const res = await ops.replaceText(cues, find, repl, { regex, caseSensitive });
                return {
                  lines: res.count ? res.lines : undefined,
                  text: res.count
                    ? `${t("sube_replace_done")} ${res.count}× (${res.cues} ${t("sube_replace_in_cues")})`
                    : t("sube_replace_none"),
                };
              })}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-accent hover:bg-accent/80 text-white rounded-lg disabled:opacity-40"
            >
              {busy === "replace" ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
              {t("sube_replace_run")}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
