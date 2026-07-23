/**
 * Tooltip.jsx — Styled hover tooltip with configurable placement.
 *
 * Usage:
 *   <Tooltip text="Popis akce">
 *     <button>...</button>
 *   </Tooltip>
 *
 *   <Tooltip text="Popis akce" placement="bottom">
 *     <button>...</button>
 *   </Tooltip>
 *
 * placement: "top" | "bottom" | "left" | "right"  (default: "top")
 * delay:     ms before tooltip appears              (default: 400)
 */

import { useState, useRef, useCallback } from "react";
import clsx from "clsx";

export default function Tooltip({ children, text, placement = "top", delay = 400 }) {
  const [visible, setVisible] = useState(false);
  const timer = useRef(null);

  const show = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setVisible(true), delay);
  }, [delay]);

  const hide = useCallback(() => {
    clearTimeout(timer.current);
    setVisible(false);
  }, []);

  if (!text) return <>{children}</>;

  // Position classes for the tooltip bubble
  const bubbleClass = {
    top:    "bottom-full left-1/2 -translate-x-1/2 mb-2",
    bottom: "top-full  left-1/2 -translate-x-1/2 mt-2",
    left:   "right-full top-1/2 -translate-y-1/2 mr-2",
    right:  "left-full  top-1/2 -translate-y-1/2 ml-2",
  }[placement] ?? "bottom-full left-1/2 -translate-x-1/2 mb-2";

  // Arrow classes
  const arrowClass = {
    top:    "top-full  left-1/2 -translate-x-1/2 border-l-transparent border-r-transparent border-b-transparent border-t-[#1e2535]",
    bottom: "bottom-full left-1/2 -translate-x-1/2 border-l-transparent border-r-transparent border-t-transparent border-b-[#1e2535]",
    left:   "left-full  top-1/2 -translate-y-1/2 border-t-transparent border-b-transparent border-r-transparent border-l-[#1e2535]",
    right:  "right-full top-1/2 -translate-y-1/2 border-t-transparent border-b-transparent border-l-transparent border-r-[#1e2535]",
  }[placement] ?? "top-full left-1/2 -translate-x-1/2 border-l-transparent border-r-transparent border-b-transparent border-t-[#1e2535]";

  return (
    <div
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}

      {visible && (
        <div
          role="tooltip"
          className={clsx(
            "absolute z-[9999] pointer-events-none",
            bubbleClass,
          )}
        >
          {/* Bubble */}
          <div className="relative bg-[#1e2535] border border-white/10 text-white text-xs rounded-lg shadow-xl px-3 py-2 max-w-[260px] leading-relaxed whitespace-pre-wrap text-center">
            {text}
            {/* Arrow */}
            <span className={clsx("absolute w-0 h-0 border-4", arrowClass)} />
          </div>
        </div>
      )}
    </div>
  );
}
