/**
 * WatchStatusButton — reusable watch-status selector.
 *
 * Props:
 *   status      – current watch_status string or null
 *   onChange    – (newStatus: string|null) => void
 *   size        – "sm" | "md" (default "md")
 *   isPending   – show spinner while saving
 */
import { useState, useRef, useEffect } from "react";
import { Eye, Bookmark, CheckCircle2, PauseCircle, XCircle, MinusCircle } from "lucide-react";
import clsx from "clsx";

export const WATCH_OPTS = [
  { value: null,             label: "Neoznačeno",    Icon: MinusCircle,  color: "text-muted" },
  { value: "plan_to_watch",  label: "Chci sledovat", Icon: Bookmark,     color: "text-blue-400" },
  { value: "watching",       label: "Sleduji",       Icon: Eye,          color: "text-accent" },
  { value: "completed",      label: "Dokončeno",     Icon: CheckCircle2, color: "text-green-400" },
  { value: "on_hold",        label: "Pozastaveno",   Icon: PauseCircle,  color: "text-yellow-400" },
  { value: "dropped",        label: "Přestanu",      Icon: XCircle,      color: "text-red-400" },
];

export function watchOptFor(status) {
  return WATCH_OPTS.find(o => o.value === status) ?? WATCH_OPTS[0];
}

export default function WatchStatusButton({ status, onChange, size = "md", isPending = false }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function close(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const current = watchOptFor(status);
  const { Icon, color, label } = current;

  const isSmall = size === "sm";

  return (
    <div ref={ref} className="relative">
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(v => !v); }}
        title={label}
        className={clsx(
          "flex items-center gap-1 rounded-full border transition-colors",
          isSmall ? "px-1.5 py-0.5 text-xs" : "px-2 py-1 text-xs",
          open
            ? "border-accent bg-accent/10"
            : "border-border bg-surface/80 hover:border-accent",
          color,
          isPending && "opacity-60 pointer-events-none"
        )}
      >
        <Icon size={isSmall ? 11 : 13} />
        {!isSmall && <span>{label}</span>}
      </button>

      {open && (
        <div
          className="absolute z-50 top-full mt-1 left-0 bg-surface border border-border rounded-xl shadow-xl overflow-hidden min-w-[160px]"
          onClick={e => e.stopPropagation()}
        >
          {WATCH_OPTS.map(opt => (
            <button
              key={String(opt.value)}
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={clsx(
                "w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-border transition-colors text-left",
                opt.value === status ? "bg-accent/10 text-accent" : "text-text"
              )}
            >
              <opt.Icon size={13} className={opt.color} />
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
