import { useEffect, useRef, useState } from "react";
import { api } from "./api.js";

const BACKOFF = [1000, 2000, 4000, 8000, 15000];
const POLL_MS = 5000;

/**
 * Live venue data. SSE first (/api/venues/{slug}/stream); reconnect with backoff 1,2,4..15 s;
 * after 2 consecutive failures poll the matching GET endpoints every 5 s until SSE recovers.
 * want: which payloads the page needs: "queue" | "board" | "ticket" | "console".
 * Returns { queue, board, ticket, console, conn: "connecting"|"live"|"paused"|"offline", error, refresh }.
 */
export function useVenueStream(slug, { want = ["queue"], ticket = null, token = null } = {}) {
  const [state, setState] = useState({ queue: null, board: null, ticket: null, console: null });
  const [conn, setConn] = useState("connecting");
  const [error, setError] = useState(null);
  const ref = useRef({});

  const fetchAll = async () => {
    if (!slug) return;
    const jobs = [];
    if (want.includes("queue")) jobs.push(api(`/api/venues/${slug}/summary`).then((d) => ["queue", d]));
    if (want.includes("board")) jobs.push(api(`/api/venues/${slug}/board`).then((d) => ["board", d]));
    if (want.includes("ticket") && ticket) jobs.push(api(`/api/tickets/${encodeURIComponent(ticket)}`).then((d) => ["ticket", d]));
    if (want.includes("console")) jobs.push(api(`/api/staff/venues/${slug}/console`, { as: "staff" }).then((d) => ["console", d]));
    const results = await Promise.allSettled(jobs);
    const patch = {};
    let firstErr = null;
    for (const r of results) {
      if (r.status === "fulfilled") patch[r.value[0]] = r.value[1];
      else if (!firstErr) firstErr = r.reason;
    }
    if (Object.keys(patch).length) setState((s) => ({ ...s, ...patch }));
    setError(firstErr && !Object.keys(patch).length ? firstErr : null);
    return firstErr;
  };

  useEffect(() => {
    if (!slug) return undefined;
    let closed = false;
    let es = null;
    let fails = 0;
    let pollTimer = null;
    let retryTimer = null;
    const r = ref.current;

    const startPolling = () => {
      if (pollTimer) return;
      setConn(navigator.onLine ? "paused" : "offline");
      pollTimer = setInterval(async () => {
        const err = await fetchAll();
        setConn(!navigator.onLine || (err && err.network) ? "offline" : "paused");
      }, POLL_MS);
    };
    const stopPolling = () => { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } };

    const open = () => {
      if (closed) return;
      const qs = new URLSearchParams();
      if (ticket) qs.set("ticket", ticket);
      if (token) qs.set("token", token);
      es = new EventSource(`/api/venues/${slug}/stream${qs.toString() ? "?" + qs : ""}`);
      const on = (name, key) => es.addEventListener(name, (e) => {
        fails = 0;
        stopPolling();
        setConn("live");
        try { const d = JSON.parse(e.data); setState((s) => ({ ...s, [key]: d })); } catch { /* ignore bad frame */ }
      });
      on("queue_update", "queue");
      on("board_update", "board");
      on("ticket_update", "ticket");
      on("resource_update", "console");
      es.onopen = () => { fails = 0; };
      es.onerror = () => {
        es.close();
        fails += 1;
        if (fails >= 2) startPolling();
        const wait = BACKOFF[Math.min(fails - 1, BACKOFF.length - 1)];
        retryTimer = setTimeout(open, wait);
      };
      r.es = es;
    };

    fetchAll();
    open();
    const onOnline = () => { fetchAll(); };
    window.addEventListener("online", onOnline);
    return () => {
      closed = true;
      if (es) es.close();
      stopPolling();
      clearTimeout(retryTimer);
      window.removeEventListener("online", onOnline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, ticket, token, want.join(",")]);

  return { ...state, conn, error, refresh: fetchAll };
}

/** Simple polling hook (used by the landing page and admin analytics). */
export function usePoll(fn, ms, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const tick = async () => {
    try { setData(await fn()); setError(null); } catch (e) { setError(e); } finally { setLoading(false); }
  };
  useEffect(() => {
    tick();
    if (!ms) return undefined;
    const id = setInterval(tick, ms);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error, loading, refresh: tick, setData };
}
