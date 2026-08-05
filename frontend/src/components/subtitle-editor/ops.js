/**
 * The editing operations, as the backend does them.
 *
 * Every call takes the cue list and gives a new one back — nothing is written
 * until Save, so any of it can be undone. Keeping the logic on one side means
 * the timing maths the tests cover is the timing maths the editor runs.
 */
import api from "../../api/client";

const post = (op, body) =>
  api.post(`/subtitle-editor/ops/${op}`, body).then((r) => r.data);

export const analyze     = (lines)                  => post("analyze", { lines });
export const fixErrors   = (lines, rules)           => post("fix", { lines, rules });
export const shiftLines  = (lines, seconds, from_index = 0) =>
  post("shift", { lines, seconds, from_index });
export const scaleLines  = (lines, factor, anchor = 0) => post("scale", { lines, factor, anchor });
export const syncPoints  = (lines, first, second)   => post("sync-points", { lines, first, second });
export const replaceText = (lines, find, replace, opts = {}) =>
  post("replace", { lines, find, replace, regex: !!opts.regex, case_sensitive: opts.caseSensitive !== false });
export const splitCue    = (lines, index, at = null) => post("split", { lines, index, at });
export const mergeCues   = (lines, indexes)          => post("merge", { lines, indexes });
export const insertCue   = (lines, start, end, text = "") => post("insert", { lines, start, end, text });
export const deleteCues  = (lines, indexes)          => post("delete", { lines, indexes });

/** The rules "Opravit chyby" offers, in the order they are listed. */
export const FIX_RULES = [
  "order", "empty", "spaces", "duplicates",
  "overlap", "min_duration", "max_duration", "tags",
];

/** Rules that are safe to run without looking at the file first. `tags` throws
 *  away styling somebody may have wanted, so it starts unticked. */
export const SAFE_RULES = FIX_RULES.filter((r) => r !== "tags");

/** Issue kinds analyze() reports, worst first — drives the badge colour. */
export const ISSUE_SEVERITY = {
  negative: "error",
  overlap: "error",
  empty: "error",
  fast: "warn",
  short: "warn",
  wide: "warn",
  lines: "warn",
  long: "info",
};
