/**
 * One line of the subtitle, with everything you can do to it.
 *
 * The row carries its own verdict — reading speed, overlap, a line too wide for
 * the screen — because a warning listed somewhere else is a warning nobody acts
 * on. Timings are typed in the same 00:00:01,240 form the file uses, and the
 * buttons that need the video ("start here") take their value from the playhead.
 */
import { useEffect, useRef, useState } from "react";
import { Pencil, Scissors, Trash2, Merge } from "lucide-react";
import clsx from "clsx";
import { useT } from "../../i18n/I18nContext";
import { fmtTs, parseTs } from "./time";
import { ISSUE_SEVERITY } from "./ops";

const SEVERITY_STYLE = {
  error: "text-red-400 bg-red-900/25",
  warn:  "text-yellow-400 bg-yellow-900/25",
  info:  "text-muted bg-white/5",
};

function worst(issues) {
  if (issues?.some((i) => ISSUE_SEVERITY[i] === "error")) return "error";
  if (issues?.some((i) => ISSUE_SEVERITY[i] === "warn")) return "warn";
  return issues?.length ? "info" : null;
}

/** A timestamp you can type over, that refuses to accept nonsense. */
function TimeField({ value, onChange, title }) {
  const [draft, setDraft] = useState(null);
  const text = draft ?? fmtTs(value);
  const invalid = draft != null && parseTs(draft) == null;

  return (
    <input
      value={text}
      title={title}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const parsed = parseTs(text);
        if (parsed != null && parsed !== value) onChange(parsed);
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.target.blur();
        if (e.key === "Escape") { setDraft(null); e.target.blur(); }
      }}
      className={clsx(
        "w-[6.6rem] bg-transparent border border-transparent rounded px-1 text-[10px] font-mono leading-none py-0.5",
        "hover:border-border focus:border-accent focus:bg-bg focus:outline-none",
        invalid ? "text-red-400" : "text-muted/70",
      )}
    />
  );
}

export default function CueRow({
  cue, idx, active, selected, issues, cps,
  onSeek, onSelect, onChange, onSetStart, onSetEnd,
  onSplit, onDelete, onMergeNext, canMergeNext,
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(cue.text || "");
  const taRef = useRef(null);

  useEffect(() => { if (!editing) setDraft(cue.text || ""); }, [cue.text, editing]);
  useEffect(() => { if (editing) taRef.current?.focus(); }, [editing]);

  const severity = worst(issues);
  const duration = Math.max(0, (cue.end || 0) - (cue.start || 0));

  function commit() {
    setEditing(false);
    if (draft !== cue.text) onChange({ text: draft });
  }

  return (
    <div
      data-cue={idx}
      onClick={() => !editing && onSeek(cue.start)}
      className={clsx(
        "group flex flex-col gap-0.5 px-2 py-1.5 border-b border-border cursor-pointer transition-colors",
        active ? "bg-accent/10 border-l-2 border-l-accent"
          : selected ? "bg-white/[0.05]" : "hover:bg-white/[0.025]",
      )}
    >
      {/* Timings + verdict */}
      <div className="flex items-center gap-1">
        <input
          type="checkbox"
          checked={!!selected}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onSelect(idx, e.target.checked)}
          className="w-3 h-3 accent-accent flex-shrink-0 cursor-pointer"
          title={t("sube_select_title")}
        />
        <span className="text-[10px] font-mono text-muted/40 w-6 flex-shrink-0 text-right">{idx + 1}</span>

        <TimeField value={cue.start} title={t("sube_start_title")}
                   onChange={(v) => onChange({ start: v })} />
        <span className="text-[10px] text-muted/30">→</span>
        <TimeField value={cue.end} title={t("sube_end_title")}
                   onChange={(v) => onChange({ end: v })} />

        <span className={clsx(
          "text-[9px] font-mono px-1 rounded flex-shrink-0",
          severity ? SEVERITY_STYLE[severity] : "text-muted/40",
        )}
          title={issues?.length ? issues.map((i) => t(`sube_issue_${i}`)).join(" · ")
                                : t("sube_issue_none")}
        >
          {duration.toFixed(1)}s · {cps ?? 0}
        </span>

        <div className="flex-1" />

        {/* Actions — the video-dependent ones read the playhead */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
          <button onClick={(e) => { e.stopPropagation(); onSetStart(idx); }}
                  title={t("sube_set_start_title")}
                  className="text-[9px] px-1 py-0.5 rounded border border-border text-muted hover:border-accent hover:text-accent">
            ▶
          </button>
          <button onClick={(e) => { e.stopPropagation(); onSetEnd(idx); }}
                  title={t("sube_set_end_title")}
                  className="text-[9px] px-1 py-0.5 rounded border border-border text-muted hover:border-accent hover:text-accent">
            ◀
          </button>
          <button onClick={(e) => { e.stopPropagation(); onSplit(idx); }}
                  title={t("sube_split_title")}
                  className="p-0.5 rounded text-muted hover:text-accent"><Scissors size={10} /></button>
          {canMergeNext && (
            <button onClick={(e) => { e.stopPropagation(); onMergeNext(idx); }}
                    title={t("sube_merge_next_title")}
                    className="p-0.5 rounded text-muted hover:text-accent"><Merge size={10} /></button>
          )}
          <button onClick={(e) => { e.stopPropagation(); setEditing(true); }}
                  title={t("sube_edit_text_title")}
                  className="p-0.5 rounded text-muted hover:text-accent"><Pencil size={10} /></button>
          <button onClick={(e) => { e.stopPropagation(); onDelete(idx); }}
                  title={t("sube_delete_title")}
                  className="p-0.5 rounded text-muted hover:text-red-400"><Trash2 size={10} /></button>
        </div>
      </div>

      {/* Text */}
      {editing ? (
        <textarea
          ref={taRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commit(); }
            if (e.key === "Escape") { setDraft(cue.text || ""); setEditing(false); }
          }}
          rows={Math.max(1, (draft.match(/\n/g) || []).length + 1)}
          className="ml-9 w-[calc(100%-2.25rem)] bg-bg border border-accent rounded px-2 py-1 text-xs text-text resize-none focus:outline-none"
        />
      ) : (
        <p className="ml-9 text-sm text-text/90 leading-snug whitespace-pre-wrap break-words">
          {cue.text ? cue.text : <em className="text-muted/40 text-xs">{t("player_empty_cue")}</em>}
        </p>
      )}
    </div>
  );
}
