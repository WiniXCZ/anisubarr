import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2, ChevronLeft, ChevronRight, CheckCircle2, Clock } from "lucide-react";
import api from "../api/client";
import clsx from "clsx";

const DAY_NAMES = ["Po", "Út", "St", "Čt", "Pá", "So", "Ne"];
const MONTH_NAMES = [
  "Leden","Únor","Březen","Duben","Květen","Červen",
  "Červenec","Srpen","Září","Říjen","Listopad","Prosinec",
];

function toISO(d) {
  return d.toISOString().slice(0, 10);
}

function addMonths(d, n) {
  const r = new Date(d);
  r.setMonth(r.getMonth() + n);
  return r;
}

export default function Calendar() {
  const today = new Date();
  const [month, setMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1));

  // First/last day of visible grid (Mon–Sun, 6 weeks)
  const gridStart = useMemo(() => {
    const d = new Date(month);
    const dow = (d.getDay() + 6) % 7; // Monday=0
    d.setDate(d.getDate() - dow);
    return d;
  }, [month]);

  const gridEnd = useMemo(() => {
    const d = new Date(gridStart);
    d.setDate(d.getDate() + 41); // 6 weeks
    return d;
  }, [gridStart]);

  const { data: episodes = [], isLoading } = useQuery({
    queryKey: ["calendar", toISO(gridStart), toISO(gridEnd)],
    queryFn: () =>
      api.get("/calendar", { params: { start: toISO(gridStart), end: toISO(gridEnd) } })
        .then(r => r.data),
    staleTime: 5 * 60_000,
  });

  // Group episodes by date
  const byDate = useMemo(() => {
    const map = {};
    for (const ep of episodes) {
      if (!ep.air_date) continue;
      (map[ep.air_date] ??= []).push(ep);
    }
    return map;
  }, [episodes]);

  // Build grid cells
  const cells = useMemo(() => {
    const arr = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart);
      d.setDate(d.getDate() + i);
      arr.push(d);
    }
    return arr;
  }, [gridStart]);

  const todayISO = toISO(today);

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-text">Kalendář</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMonth(m => addMonths(m, -1))}
            className="p-1.5 rounded-lg text-muted hover:text-text hover:bg-border transition-colors"
          ><ChevronLeft size={16} /></button>
          <span className="text-sm font-medium text-text min-w-[140px] text-center">
            {MONTH_NAMES[month.getMonth()]} {month.getFullYear()}
          </span>
          <button
            onClick={() => setMonth(m => addMonths(m, 1))}
            className="p-1.5 rounded-lg text-muted hover:text-text hover:bg-border transition-colors"
          ><ChevronRight size={16} /></button>
          <button
            onClick={() => setMonth(new Date(today.getFullYear(), today.getMonth(), 1))}
            className="text-xs px-2.5 py-1 rounded-lg border border-border text-muted hover:border-accent hover:text-text transition-colors"
          >Dnes</button>
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-24 gap-2 text-muted">
          <Loader2 size={18} className="animate-spin" /> Načítám…
        </div>
      )}

      {!isLoading && (
        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          {/* Day headers */}
          <div className="grid grid-cols-7 border-b border-border">
            {DAY_NAMES.map(d => (
              <div key={d} className="py-2 text-center text-xs font-medium text-muted">
                {d}
              </div>
            ))}
          </div>

          {/* Grid */}
          <div className="grid grid-cols-7">
            {cells.map((day, idx) => {
              const iso     = toISO(day);
              const isToday = iso === todayISO;
              const isOther = day.getMonth() !== month.getMonth();
              const eps     = byDate[iso] || [];

              return (
                <div
                  key={idx}
                  className={clsx(
                    "min-h-[90px] p-1.5 border-b border-r border-border",
                    isOther && "opacity-40",
                    idx % 7 === 6 && "border-r-0",
                    idx >= 35    && "border-b-0",
                  )}
                >
                  {/* Day number */}
                  <div className="flex justify-end mb-1">
                    <span className={clsx(
                      "text-xs w-6 h-6 flex items-center justify-center rounded-full",
                      isToday
                        ? "bg-accent text-white font-bold"
                        : "text-muted"
                    )}>
                      {day.getDate()}
                    </span>
                  </div>

                  {/* Episodes */}
                  <div className="flex flex-col gap-0.5">
                    {eps.slice(0, 4).map(ep => (
                      <Link
                        key={ep.id}
                        to={`/series/${ep.series_id}`}
                        title={`${ep.series_title} S${String(ep.season_number).padStart(2,"0")}E${String(ep.episode_number).padStart(2,"0")}${ep.title ? " — " + ep.title : ""}`}
                        className={clsx(
                          "flex items-center gap-1 px-1 py-0.5 rounded text-[10px] leading-tight truncate transition-colors",
                          ep.has_file
                            ? "bg-green-900/30 text-green-300 hover:bg-green-900/50"
                            : "bg-blue-900/30 text-blue-300 hover:bg-blue-900/50"
                        )}
                      >
                        {ep.has_file
                          ? <CheckCircle2 size={8} className="flex-shrink-0" />
                          : <Clock        size={8} className="flex-shrink-0" />}
                        <span className="truncate">{ep.series_title}</span>
                        <span className="flex-shrink-0 opacity-70">
                          E{String(ep.episode_number).padStart(2,"0")}
                        </span>
                      </Link>
                    ))}
                    {eps.length > 4 && (
                      <span className="text-[10px] text-muted pl-1">+{eps.length - 4} další</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Upcoming list — next 14 days */}
      <UpcomingList episodes={episodes} todayISO={todayISO} />
    </div>
  );
}

function UpcomingList({ episodes, todayISO }) {
  const upcoming = episodes
    .filter(ep => ep.air_date >= todayISO)
    .slice(0, 20);

  if (!upcoming.length) return null;

  // Group by date
  const groups = [];
  let lastDate = null;
  for (const ep of upcoming) {
    if (ep.air_date !== lastDate) {
      groups.push({ date: ep.air_date, eps: [] });
      lastDate = ep.air_date;
    }
    groups[groups.length - 1].eps.push(ep);
  }

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-text">Nadcházející epizody</h2>
      {groups.map(g => (
        <div key={g.date} className="flex gap-3 items-start">
          <div className="w-20 flex-shrink-0 text-xs text-muted pt-2 text-right">
            {new Date(g.date + "T12:00:00").toLocaleDateString("cs-CZ", { day: "numeric", month: "short" })}
          </div>
          <div className="flex-1 flex flex-col gap-1">
            {g.eps.map(ep => (
              <Link
                key={ep.id}
                to={`/series/${ep.series_id}`}
                className={clsx(
                  "flex items-center gap-2 px-3 py-2 rounded-xl border text-xs transition-all hover:border-accent",
                  ep.has_file
                    ? "bg-green-900/10 border-green-800/30 text-green-300"
                    : "bg-surface border-border text-text"
                )}
              >
                {ep.series_cover && (
                  <img src={ep.series_cover} alt="" className="w-6 h-8 rounded object-cover flex-shrink-0" />
                )}
                <span className="font-medium truncate flex-1">{ep.series_title}</span>
                <span className="font-mono text-muted flex-shrink-0">
                  S{String(ep.season_number).padStart(2,"0")}E{String(ep.episode_number).padStart(2,"0")}
                </span>
                {ep.has_file && <CheckCircle2 size={12} className="text-green-400 flex-shrink-0" />}
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
