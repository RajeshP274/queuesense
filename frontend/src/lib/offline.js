// Staff offline queue: taps made while offline are stored with an idempotency key and the device time,
// then replayed in order when the connection returns. The server clamps X-Client-Ts to +/- 2 min.
import { api, uuid } from "./api.js";

const KEY = "qs_staff_queue";
const listeners = new Set();

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
}
function save(q) {
  try { localStorage.setItem(KEY, JSON.stringify(q)); } catch { /* ignore */ }
  listeners.forEach((fn) => fn(q.length));
}

export function pendingCount() { return load().length; }
export function onQueueChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/** Send a staff action. Returns the server response, or {queued: true} when stored offline. */
export async function staffAction(path, body = {}) {
  const item = { path, body, idem: uuid(), ts: new Date().toISOString() };
  if (load().length) {           // keep order: if anything is pending, queue behind it
    save([...load(), item]);
    flush();
    return { queued: true };
  }
  try {
    return await send(item);
  } catch (e) {
    if (e.network) { save([...load(), item]); return { queued: true }; }
    throw e;
  }
}

function send(item) {
  return api(item.path, { method: "POST", body: item.body, as: "staff", idem: item.idem, headers: { "X-Client-Ts": item.ts } });
}

let flushing = false;
export async function flush(onError) {
  if (flushing) return;
  flushing = true;
  try {
    let q = load();
    while (q.length) {
      try {
        await send(q[0]);
      } catch (e) {
        if (e.network) break;               // still offline: try later
        if (onError) onError(e);            // server rejected it: drop and report
      }
      q = load().slice(1);
      save(q);
    }
  } finally {
    flushing = false;
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => flush());
  setInterval(() => { if (load().length) flush(); }, 5000);
}
