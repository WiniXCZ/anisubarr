import { createContext, useCallback, useContext, useRef, useState } from "react";

const ToastContext = createContext(null);

const MAX_TOASTS    = 5;
const AUTO_DISMISS  = 4000; // ms

let _nextId = 1;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef({});

  const dismiss = useCallback((id) => {
    clearTimeout(timers.current[id]);
    delete timers.current[id];
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((type, message) => {
    const id = _nextId++;
    setToasts((prev) => {
      const next = [...prev, { id, type, message }];
      // max 5 toastů – vyhoď nejstarší
      return next.length > MAX_TOASTS ? next.slice(next.length - MAX_TOASTS) : next;
    });
    timers.current[id] = setTimeout(() => dismiss(id), AUTO_DISMISS);
  }, [dismiss]);

  const toast = {
    success: (msg) => addToast("success", msg),
    error:   (msg) => addToast("error",   msg),
    info:    (msg) => addToast("info",    msg),
  };

  return (
    <ToastContext.Provider value={{ toasts, dismiss, toast }}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast musí být použit uvnitř ToastProvider");
  return ctx.toast;
}

export function useToastContext() {
  return useContext(ToastContext);
}
