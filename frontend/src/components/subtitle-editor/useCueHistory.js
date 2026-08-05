/**
 * Undo/redo for the cue list.
 *
 * Every editor has this and the reason is not convenience: "Opravit chyby" can
 * touch four hundred lines at once, and without a way back the only safe way to
 * try it is not to. History is what makes the bulk operations usable.
 *
 * Past, present and future live in one state object and every update is a pure
 * function of it. Keeping the history in refs and nudging a re-render would
 * push two entries per edit under React's double-invoked updaters — the undo
 * button would then need pressing twice, which is worse than not having one.
 *
 * Typing inside one cue coalesces: an undo should take back the edit, not the
 * last character of it.
 */
import { useCallback, useMemo, useState } from "react";

const LIMIT = 100;
const COALESCE_MS = 600;

const initialState = (cues) => ({
  past: [], present: cues, future: [], lastKey: null, lastAt: 0,
});

export default function useCueHistory(initial = []) {
  const [state, setState] = useState(() => initialState(initial));

  /** Replace the list, remembering where we came from.
   *  `coalesceKey` groups rapid edits to the same thing into one undo step. */
  const commit = useCallback((next, coalesceKey = null) => {
    setState((s) => {
      const present = typeof next === "function" ? next(s.present) : next;
      const now = Date.now();
      const merge = coalesceKey != null && coalesceKey === s.lastKey
        && now - s.lastAt < COALESCE_MS;

      return {
        past: merge ? s.past : [...s.past, s.present].slice(-LIMIT),
        present,
        future: [],
        lastKey: coalesceKey,
        lastAt: now,
      };
    });
  }, []);

  /** Load a fresh file: the history belongs to the file that is gone. */
  const reset = useCallback((next) => setState(initialState(next)), []);

  const undo = useCallback(() => {
    setState((s) => (s.past.length === 0 ? s : {
      past: s.past.slice(0, -1),
      present: s.past[s.past.length - 1],
      future: [s.present, ...s.future].slice(0, LIMIT),
      lastKey: null,
      lastAt: 0,
    }));
  }, []);

  const redo = useCallback(() => {
    setState((s) => (s.future.length === 0 ? s : {
      past: [...s.past, s.present].slice(-LIMIT),
      present: s.future[0],
      future: s.future.slice(1),
      lastKey: null,
      lastAt: 0,
    }));
  }, []);

  return useMemo(() => ({
    cues: state.present,
    commit, reset, undo, redo,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  }), [state, commit, reset, undo, redo]);
}
