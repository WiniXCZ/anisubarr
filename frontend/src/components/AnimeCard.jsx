import { Link } from "react-router-dom";
import { Star, CheckCircle2, AlertCircle, Clock, Check, BadgeCheck } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { setWatchStatus } from "../api/client";
import WatchStatusButton, { watchOptFor } from "./WatchStatusButton";
import clsx from "clsx";

const STATUS_COLORS = {
  FINISHED:         "bg-green-900/60 text-green-300",
  RELEASING:        "bg-blue-900/60  text-blue-300",
  NOT_YET_RELEASED: "bg-yellow-900/60 text-yellow-300",
  CANCELLED:        "bg-red-900/60   text-red-300",
};
const STATUS_LABEL = {
  FINISHED:         "Dokončeno",
  RELEASING:        "Vysílá se",
  NOT_YET_RELEASED: "Chystá se",
  CANCELLED:        "Zrušeno",
};

function EpisodePip({ series }) {
  const total   = series.episodes_monitored ?? series.episode_count ?? 0;
  const hasFile = series.episodes_with_file ?? series.episode_file_count ?? 0;
  if (!total) return null;

  const missing  = total - hasFile;
  const complete = missing === 0;
  const ongoing  = series.status === "RELEASING";

  if (complete) return (
    <span className="flex items-center gap-0.5 text-green-400 text-xs">
      <CheckCircle2 size={10} /> {hasFile}/{total}
    </span>
  );
  if (ongoing) return (
    <span className="flex items-center gap-0.5 text-blue-300 text-xs">
      <Clock size={10} /> {hasFile}/{total}
    </span>
  );
  return (
    <span className="flex items-center gap-0.5 text-orange-300 text-xs">
      <AlertCircle size={10} /> chybí {missing}
    </span>
  );
}

function CzPip({ series }) {
  const total = series.episodes_with_file ?? series.episode_file_count ?? 0;
  const cs    = series.cs_sub_count ?? 0;
  if (!total) return null;

  const allHave = cs >= total;
  const none    = cs === 0;

  return (
    <span className={clsx(
      "text-xs font-medium",
      allHave ? "text-accent" : none ? "text-muted/50" : "text-yellow-400"
    )}>
      cs {cs}/{total}
    </span>
  );
}

export default function AnimeCard({ series, rootColor, rootFolder, selectionMode = false, selected = false, onToggle }) {
  const qc = useQueryClient();
  const watchMutation = useMutation({
    mutationFn: (status) => setWatchStatus(series.id, status),
    onSuccess: () => qc.invalidateQueries(["series"]),
  });

  const { Icon: WIcon, color: wColor } = watchOptFor(series.watch_status);

  const inner = (
    <>
      {/* Poster */}
      <div className="relative aspect-[2/3] bg-border overflow-hidden">
        {series.cover_url ? (
          <img
            src={series.cover_url}
            alt={series.title}
            loading="lazy"
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted text-4xl">🎌</div>
        )}

        {/* Top-right badges: issue "!" > published ✓ > root-folder label */}
        {!selectionMode && (
          series.has_issue ? (
            <div className="absolute top-1.5 right-1.5 flex items-center justify-center w-5 h-5 rounded-full bg-orange-500 text-white text-[11px] font-bold shadow-md z-10"
                 title="Otevřená issue v Overseerr">
              !
            </div>
          ) : series.promoted ? (
            <div className="absolute top-1.5 right-1.5 flex items-center justify-center w-5 h-5 rounded-full bg-green-500 shadow-md shadow-green-500/40 z-10"
                 title="Publikováno">
              <BadgeCheck size={12} className="text-white" strokeWidth={2.5} />
            </div>
          ) : rootColor && rootFolder ? (
            <div className={clsx(
              "absolute top-1.5 right-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded border leading-tight",
              rootColor.badge
            )}>
              {rootFolder}
            </div>
          ) : null
        )}

        {/* Selection mode: checkbox overlay — top-left */}
        {selectionMode ? (
          <div className={clsx(
            "absolute top-1.5 left-1.5 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all",
            selected
              ? "bg-accent border-accent text-white"
              : "bg-black/50 border-white/60 text-transparent"
          )}>
            <Check size={13} />
          </div>
        ) : (
          /* Watch status — top-left (only when not in selection mode) */
          <div className="absolute top-1.5 left-1.5" onClick={e => e.preventDefault()}>
            <WatchStatusButton
              status={series.watch_status}
              onChange={(s) => watchMutation.mutate(s)}
              size="sm"
              isPending={watchMutation.isPending}
            />
          </div>
        )}

        {/* Selected overlay tint */}
        {selectionMode && selected && (
          <div className="absolute inset-0 bg-accent/20 pointer-events-none" />
        )}

        {/* Status badge — bottom-left */}
        {series.status && (
          <div className={clsx(
            "absolute bottom-0 left-0 right-0 text-xs px-2 py-1 font-medium text-center backdrop-blur-sm",
            STATUS_COLORS[series.status] || "bg-surface/80 text-text-dim"
          )}>
            {STATUS_LABEL[series.status] || series.status}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-2.5 flex flex-col gap-1.5 flex-1">
        {/* Title */}
        <h3 className={clsx(
          "text-xs font-semibold leading-tight line-clamp-2 transition-colors",
          selectionMode && selected ? "text-accent" : "text-text group-hover:text-accent"
        )}>
          {series.title_romaji || series.title}
        </h3>

        {/* Year + score row */}
        <div className="flex items-center justify-between gap-1">
          {(() => {
            const year = series.year
              || (series.first_aired ? new Date(series.first_aired).getFullYear() : null);
            return year
              ? <span className="text-xs font-medium text-text-dim">{year}</span>
              : <span />;
          })()}
          {series.average_score > 0 && (
            <span className="flex items-center gap-0.5 text-yellow-400 text-xs">
              <Star size={9} fill="currentColor" />
              {series.average_score.toFixed(1)}
            </span>
          )}
        </div>

        {/* Episodes + CZ */}
        <div className="flex items-center justify-between gap-1 border-t border-border/50 pt-1.5">
          <EpisodePip series={series} />
          <CzPip series={series} />
        </div>
      </div>
    </>
  );

  if (selectionMode) {
    return (
      <div
        onClick={() => onToggle?.(series.id)}
        className={clsx(
          "group relative flex flex-col bg-surface border rounded-xl overflow-hidden cursor-pointer",
          "transition-all duration-200",
          selected
            ? "border-accent shadow-lg shadow-accent/20"
            : "border-border hover:border-accent/60"
        )}
      >
        {inner}
      </div>
    );
  }

  return (
    <Link
      to={`/series/${series.id}`}
      className={clsx(
        "group relative flex flex-col bg-surface border rounded-xl overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg",
        series.has_issue
          ? "border-orange-500 shadow-orange-500/20 hover:border-orange-400 hover:shadow-orange-500/30"
          : series.promoted
            ? "border-green-600/70 shadow-green-700/20 hover:border-green-500 hover:shadow-green-600/30"
            : "border-border hover:border-accent hover:shadow-accent/10"
      )}
    >
      {inner}
    </Link>
  );
}
