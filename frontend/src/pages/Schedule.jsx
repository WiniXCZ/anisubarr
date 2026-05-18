import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Play, Clock, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { useState } from "react";
import api from "../api/client";
import clsx from "clsx";

const getJobs  = () => api.get("/schedule").then(r => r.data);
const updateJob = (job_id, body) => api.patch(`/schedule/${job_id}`, body).then(r => r.data);
const runNow    = (job_id) => api.post(`/schedule/${job_id}/run`).then(r => r.data);

const INTERVAL_OPTS = [
  { value: "hourly",  label: "Každou hodinu" },
  { value: "daily",   label: "Každý den" },
  { value: "weekly",  label: "Každý týden" },
  { value: "monthly", label: "Každý měsíc" },
];

const DOW_LABELS = ["Po", "Út", "St", "Čt", "Pá", "So", "Ne"];
const HOUR_OPTS  = Array.from({ length: 24 }, (_, i) => i);

function StatusBadge({ status }) {
  if (!status) return null;
  if (status === "ok") return (
    <span className="flex items-center gap-1 text-xs text-green-400">
      <CheckCircle2 size={12} /> OK
    </span>
  );
  if (status.startsWith("error")) return (
    <span className="flex items-center gap-1 text-xs text-red-400" title={status}>
      <XCircle size={12} /> Chyba
    </span>
  );
  return null;
}

function JobCard({ job }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    interval:     job.interval,
    hour:         job.hour ?? 3,
    minute:       job.minute ?? 0,
    day_of_week:  job.day_of_week ?? 0,
    day_of_month: job.day_of_month ?? 1,
  });

  const toggleMutation = useMutation({
    mutationFn: () => updateJob(job.job_id, { enabled: !job.enabled }),
    onSuccess: () => qc.invalidateQueries(["schedule"]),
  });

  const saveMutation = useMutation({
    mutationFn: () => updateJob(job.job_id, form),
    onSuccess: () => { qc.invalidateQueries(["schedule"]); setEditing(false); },
  });

  const runMutation = useMutation({
    mutationFn: () => runNow(job.job_id),
    onSuccess: () => setTimeout(() => qc.invalidateQueries(["schedule"]), 3000),
  });

  function scheduleLabel() {
    const h = String(form.hour).padStart(2, "0");
    const m = String(form.minute).padStart(2, "0");
    if (form.interval === "hourly") return "každou hodinu";
    if (form.interval === "daily")  return `denně ve ${h}:${m}`;
    if (form.interval === "weekly") return `každý ${DOW_LABELS[form.day_of_week]} ve ${h}:${m}`;
    if (form.interval === "monthly") return `každý měsíc ${form.day_of_month}. ve ${h}:${m}`;
    return "";
  }

  return (
    <div className={clsx(
      "bg-surface border rounded-xl p-4 flex flex-col gap-3 transition-colors",
      job.enabled ? "border-border" : "border-border/40 opacity-60"
    )}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-text">{job.name}</h3>
            <StatusBadge status={job.last_status} />
          </div>
          <p className="text-xs text-muted mt-0.5">{job.description}</p>
        </div>
        {/* Toggle */}
        <button
          onClick={() => toggleMutation.mutate()}
          disabled={toggleMutation.isPending}
          className={clsx(
            "relative w-10 h-5 rounded-full transition-colors flex-shrink-0",
            job.enabled ? "bg-accent" : "bg-border"
          )}
          title={job.enabled ? "Deaktivovat" : "Aktivovat"}
        >
          <span className={clsx(
            "absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform",
            job.enabled ? "translate-x-5" : "translate-x-0.5"
          )} />
        </button>
      </div>

      {/* Schedule summary */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs text-muted">
          <Clock size={11} />
          <span>{scheduleLabel()}</span>
        </div>
        <div className="flex gap-2 items-center">
          {job.last_run_at && (
            <span className="text-xs text-muted/60">
              naposledy: {new Date(job.last_run_at).toLocaleString("cs-CZ", { dateStyle: "short", timeStyle: "short" })}
            </span>
          )}
          <button
            onClick={() => runMutation.mutate()}
            disabled={runMutation.isPending}
            className="flex items-center gap-1 text-xs text-accent hover:text-accent-hover disabled:opacity-50 transition-colors"
          >
            {runMutation.isPending ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
            Spustit teď
          </button>
          <button
            onClick={() => setEditing(e => !e)}
            className="text-xs text-muted hover:text-text transition-colors"
          >
            {editing ? "Zavřít" : "Upravit"}
          </button>
        </div>
      </div>

      {/* Inline editor */}
      {editing && (
        <div className="border-t border-border pt-3 flex flex-col gap-3">
          {/* Interval */}
          <div className="flex flex-wrap gap-1.5">
            {INTERVAL_OPTS.map(o => (
              <button
                key={o.value}
                onClick={() => setForm(f => ({ ...f, interval: o.value }))}
                className={clsx(
                  "text-xs px-2.5 py-1 rounded-full border transition-colors",
                  form.interval === o.value
                    ? "bg-accent border-accent text-white"
                    : "bg-bg border-border text-muted hover:border-accent"
                )}
              >
                {o.label}
              </button>
            ))}
          </div>

          {/* Time pickers */}
          {form.interval !== "hourly" && (
            <div className="flex flex-wrap gap-4 text-sm">
              {form.interval === "weekly" && (
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted">Den</label>
                  <div className="flex gap-1">
                    {DOW_LABELS.map((d, i) => (
                      <button
                        key={i}
                        onClick={() => setForm(f => ({ ...f, day_of_week: i }))}
                        className={clsx(
                          "text-xs w-6 h-6 rounded transition-colors",
                          form.day_of_week === i
                            ? "bg-accent text-white"
                            : "bg-bg border border-border text-muted hover:border-accent"
                        )}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {form.interval === "monthly" && (
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted">Den v měsíci</label>
                  <input
                    type="number" min={1} max={28}
                    value={form.day_of_month}
                    onChange={e => setForm(f => ({ ...f, day_of_month: +e.target.value }))}
                    className="w-16 bg-bg border border-border rounded px-2 py-1 text-xs text-text focus:outline-none focus:border-accent"
                  />
                </div>
              )}

              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted">Hodina</label>
                <select
                  value={form.hour}
                  onChange={e => setForm(f => ({ ...f, hour: +e.target.value }))}
                  className="bg-bg border border-border rounded px-2 py-1 text-xs text-text focus:outline-none focus:border-accent"
                >
                  {HOUR_OPTS.map(h => (
                    <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted">Minuta</label>
                <select
                  value={form.minute}
                  onChange={e => setForm(f => ({ ...f, minute: +e.target.value }))}
                  className="bg-bg border border-border rounded px-2 py-1 text-xs text-text focus:outline-none focus:border-accent"
                >
                  {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map(m => (
                    <option key={m} value={m}>{String(m).padStart(2, "0")}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              className="flex items-center gap-1 text-xs px-3 py-1.5 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded-lg transition-colors"
            >
              {saveMutation.isPending ? <Loader2 size={11} className="animate-spin" /> : null}
              Uložit
            </button>
            <button
              onClick={() => setEditing(false)}
              className="text-xs px-3 py-1.5 bg-surface border border-border hover:border-accent text-muted rounded-lg transition-colors"
            >
              Zrušit
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Schedule() {
  const { data: jobs, isLoading } = useQuery({
    queryKey: ["schedule"],
    queryFn: getJobs,
    refetchInterval: 15_000,   // poll every 15s to update last_run
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-text">Harmonogram</h1>
        <p className="text-xs text-muted">Automatické úlohy — časy v UTC</p>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-muted py-12 justify-center">
          <Loader2 size={18} className="animate-spin" /> Načítám…
        </div>
      )}

      {jobs?.length === 0 && (
        <div className="text-muted text-sm text-center py-12">Žádné naplánované úlohy.</div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {jobs?.map(job => <JobCard key={job.job_id} job={job} />)}
      </div>
    </div>
  );
}
