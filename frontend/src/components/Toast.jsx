import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import { useToastContext } from "../context/ToastContext";

const TYPE_STYLES = {
  success: {
    bar:  "bg-green-500",
    icon: <CheckCircle2 size={16} className="text-green-400 flex-shrink-0" />,
    text: "text-green-100",
  },
  error: {
    bar:  "bg-red-500",
    icon: <XCircle size={16} className="text-red-400 flex-shrink-0" />,
    text: "text-red-100",
  },
  info: {
    bar:  "bg-accent",
    icon: <Info size={16} className="text-accent flex-shrink-0" />,
    text: "text-text",
  },
};

function Toast({ id, type, message }) {
  const { dismiss } = useToastContext();
  const styles = TYPE_STYLES[type] || TYPE_STYLES.info;

  return (
    <div
      className="flex items-start gap-3 bg-surface border border-border rounded-xl shadow-lg px-4 py-3 min-w-[260px] max-w-[380px] animate-toast-in"
      role="alert"
    >
      {/* Barevný pruh vlevo */}
      <div className={`w-1 self-stretch rounded-full flex-shrink-0 ${styles.bar}`} />

      {styles.icon}

      <p className={`flex-1 text-sm leading-snug ${styles.text}`}>{message}</p>

      <button
        onClick={() => dismiss(id)}
        className="text-muted hover:text-text transition-colors flex-shrink-0 mt-0.5"
        aria-label="Zavřít"
      >
        <X size={14} />
      </button>
    </div>
  );
}

export default function ToastContainer() {
  const ctx = useToastContext();
  if (!ctx) return null;
  const { toasts } = ctx;

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 items-end pointer-events-none">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <Toast {...t} />
        </div>
      ))}
    </div>
  );
}
