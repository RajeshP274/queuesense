export const DEFAULT_TZ = "Asia/Kolkata";

export function fmtTime(iso, tz = DEFAULT_TZ) {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: tz }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
}

export function fmtDate(iso, tz = DEFAULT_TZ) {
  if (!iso) return "";
  return new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short", timeZone: tz }).format(new Date(iso));
}

/** Seconds -> "12 min" / "45 s" / "1 h 5 min" */
export function fmtDur(s) {
  if (s == null || isNaN(s)) return "—";
  s = Math.max(0, Math.round(s));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** Seconds -> "mm:ss" for timers */
export function fmtClock(s) {
  s = Math.max(0, Math.floor(s || 0));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

export function secondsSince(iso, now = Date.now()) {
  return iso ? (now - new Date(iso).getTime()) / 1000 : 0;
}

export function secondsUntil(iso, now = Date.now()) {
  return iso ? (new Date(iso).getTime() - now) / 1000 : 0;
}

export function pct(x) {
  return x == null ? "—" : `${Math.round(x * 100)}%`;
}

/** Local YYYY-MM-DD in venue tz, offset by days */
export function isoDate(daysAhead = 0, tz = DEFAULT_TZ) {
  const d = new Date(Date.now() + daysAhead * 86400000);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return parts; // en-CA gives YYYY-MM-DD
}
