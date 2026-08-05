/** Timestamps, in the SRT spelling people are used to typing. */

export function fmtTs(secs) {
  const total = Math.max(0, secs || 0);
  const s = Math.floor(total);
  const ms = Math.round((total - s) * 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

export function fmtClock(secs) {
  const s = Math.floor(secs || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}

/** Parse a typed timestamp. Returns null when it isn't one, so a half-finished
 *  edit doesn't move the cue to second zero. */
export function parseTs(text) {
  const m = String(text || "").trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[,.](\d{1,3}))?$/);
  if (!m) return null;
  const [, h, mm, ss, ms] = m;
  const seconds =
    (Number(h || 0) * 3600) + (Number(mm) * 60) + Number(ss) +
    Number((ms || "0").padEnd(3, "0")) / 1000;
  return Number.isFinite(seconds) ? seconds : null;
}
