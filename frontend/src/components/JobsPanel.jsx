import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X, CheckCircle2, XCircle, Loader2, Clock, Square, Ban, ChevronDown } from "lucide-react";
import { getJobs, cancelJob } from "../api/client";
import clsx from "clsx";

// ── Formátování ───────────────────────────

function formatTime(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  return d.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatDuration(startIso, endIso) {
  if (!startIso || !endIso) return null;
  const ms = new Date(endIso) - new Date(startIso);
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;
}

// ── Ikonka stavu ──────────────────────────

function StatusIcon({ status }) {
  if (status === "running")
    return <Loader2 size={15} className="text-accent animate-spin flex-shrink-0" />;
  if (status === "done")
    return <CheckCircle2 size={15} className="text-emerald-400 flex-shrink-0" />;
  if (status === "error")
    return <XCircle size={15} className="text-red-400 flex-shrink-0" />;
  if (status === "cancelled")
    return <Ban size={15} className="text-orange-400 flex-shrink-0" />;
  return <Clock size={15} className="text-muted flex-shrink-0" />;
}

const STATUS_LABEL = {
  running:   "běží",
  done:      "hotovo",
  error:     "chyba",
  cancelled: "zrušeno",
  skipped:   "přeskočeno",
};

const STATUS_CLASS = {
  running:   "bg-accent/20 text-accent",
  done:      "bg-emerald-400/15 text-emerald-400",
  error:     "bg-red-400/15 text-red-400",
  cancelled: "bg-orange-400/15 text-orange-400",
  skipped:   "bg-border text-muted",
};

// ── Progress bar ──────────────────────────

function ProgressBar({ progress }) {
  // progress: 0–100 or null
  if (progress == null) return null;
  return (
    <div className="mt-1.5 h-1 w-full bg-border rounded-full overflow-hidden">
      <div
        className="h-full bg-accent rounded-full transition-all duration-500"
        style={{ width: `${Math.max(2, progress)}%` }}
      />
    </div>
  );
}

// ── Jeden řádek spuštění ──────────────────

function RunRow({ run, onCancel, cancelling }) {
  const [expanded, setExpanded] = useState(false);
  const duration  = formatDuration(run.started_at, run.finished_at);
  const isRunning = run.status === "running";
  const isError   = run.status === "error";
  // Long messages or messages with pipe-separated errors benefit from expansion
  const hasLongMsg = run.message && (run.message.length > 80 || run.message.includes(" | "));

  // Pick text colour based on status
  const msgCls = isError || run.status === "cancelled"
    ? "text-red-400"
    : run.message?.includes("chyb") || run.message?.includes("chyba")
      ? "text-orange-400"
      : "text-muted";

  return (
    <div
      className={clsx(
        "flex items-start gap-2.5 px-4 py-2.5 border-b border-border last:border-0",
        isRunning && "bg-accent/5"
      )}
    >
      <StatusIcon status={run.status} />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-text font-medium truncate">{run.job_name}</p>

        {/* Progress bar pro běžící joby s číselným průběhem */}
        {isRunning && run.progress != null && (
          <ProgressBar progress={run.progress} />
        )}

        {/* Live message (running) */}
        {isRunning && run.message && (
          <p className="text-xs text-muted/70 mt-0.5 truncate italic leading-tight">{run.message}</p>
        )}

        {/* Finished message — expandable when long */}
        {!isRunning && run.message && (
          <div className="mt-0.5">
            <p className={clsx(
              "text-xs leading-tight break-words whitespace-pre-wrap",
              msgCls,
              !expanded && hasLongMsg ? "line-clamp-2" : ""
            )}>
              {/* Replace " | " separators with newlines for readability */}
              {run.message.replace(/ \| /g, "\n")}
            </p>
            {hasLongMsg && (
              <button
                onClick={() => setExpanded(v => !v)}
                className="flex items-center gap-0.5 text-[10px] text-muted hover:text-text mt-0.5 transition-colors"
              >
                <ChevronDown size={10} className={clsx("transition-transform", expanded && "rotate-180")} />
                {expanded ? "Méně" : "Více"}
              </button>
            )}
          </div>
        )}

        <p className="text-xs text-muted mt-0.5">
          {formatTime(run.started_at)}
          {duration && <span className="ml-1.5 opacity-70">· {duration}</span>}
        </p>
      </div>

      <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
        {isRunning && (
          <button
            onClick={() => onCancel(run.run_id)}
            disabled={cancelling}
            title="Zastavit job"
            className="p-1 rounded text-muted hover:text-orange-400 hover:bg-orange-400/10 transition-colors disabled:opacity-40"
          >
            <Square size={12} />
          </button>
        )}
        <span
          className={clsx(
            "text-[10px] font-medium px-1.5 py-0.5 rounded whitespace-nowrap",
            STATUS_CLASS[run.status] ?? "bg-border text-muted"
          )}
        >
          {STATUS_LABEL[run.status] ?? run.status}
        </span>
      </div>
    </div>
  );
}

// ── Limit selector ────────────────────────

const LIMIT_OPTIONS = [20, 50, 100, 200];

function LimitSelect({ value, onChange }) {
  return (
    <div className="relative flex items-center">
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="appearance-none text-xs bg-surface-alt border border-border rounded px-2 py-0.5 pr-5 text-muted cursor-pointer hover:border-accent/50 focus:outline-none focus:border-accent transition-colors"
      >
        {LIMIT_OPTIONS.map((n) => (
          <option key={n} value={n}>{n} záznamů</option>
        ))}
      </select>
      <ChevronDown size={10} className="absolute right-1.5 pointer-events-none text-muted" />
    </div>
  );
}

// ── Hlavní panel ──────────────────────────

export default function JobsPanel({ open, onClose }) {
  const panelRef    = useRef(null);
  const queryClient = useQueryClient();
  const [limit, setLimit] = useState(50);

  const { data } = useQuery({
    queryKey: ["jobs", limit],
    queryFn:  () => getJobs(limit).then((r) => r.data),
    refetchInterval: open ? 2000 : false,
    enabled: open,
  });

  const cancelMutation = useMutation({
    mutationFn: cancelJob,
    onSuccess:  () => queryClient.invalidateQueries({ queryKey: ["jobs"] }),
  });

  const runs         = data?.runs         ?? [];
  const runningCount = data?.running_count ?? 0;

  // Aktivní joby nahoru, zbytek od nejnovějšího
  const sorted = [
    ...runs.filter((r) => r.status === "running"),
    ...runs.filter((r) => r.status !== "running"),
  ];

  // Zavřít Escape klávesou
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Klik mimo panel
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) onClose();
    };
    const timer = setTimeout(() => document.addEventListener("mousedown", handler), 50);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handler);
    };
  }, [open, onClose]);

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px]" aria-hidden />
      )}

      <aside
        ref={panelRef}
        className={clsx(
          "fixed top-0 right-0 z-50 h-full w-80 bg-surface border-l border-border shadow-2xl",
          "flex flex-col transition-transform duration-300 ease-in-out",
          open ? "translate-x-0" : "translate-x-full"
        )}
      >
        {/* Hlavička */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-text">Aktivita</span>
            {runningCount > 0 && (
              <span className="flex items-center gap-1 text-xs bg-accent/20 text-accent px-1.5 py-0.5 rounded-full font-medium">
                <Loader2 size={10} className="animate-spin" />
                {runningCount} běží
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <LimitSelect value={limit} onChange={setLimit} />
            <button
              onClick={onClose}
              className="p-1 rounded-md text-muted hover:text-text hover:bg-border transition-colors"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Obsah */}
        <div className="flex-1 overflow-y-auto">
          {sorted.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-muted text-sm gap-2">
              <Clock size={28} className="opacity-40" />
              <span>Zatím žádné spuštěné joby</span>
            </div>
          ) : (
            sorted.map((run) => (
              <RunRow
                key={run.run_id}
                run={run}
                onCancel={(id) => cancelMutation.mutate(id)}
                cancelling={cancelMutation.isPending}
              />
            ))
          )}
        </div>

        {/* Patička */}
        <div className="px-4 py-2 border-t border-border flex-shrink-0">
          <p className="text-xs text-muted text-center">
            {sorted.length > 0
              ? `${sorted.length} z posledních ${limit} záznamů`
              : "Polling každé 2 s"}
          </p>
        </div>
      </aside>
    </>
  );
}
