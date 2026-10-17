import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import EtaRange from "../components/EtaRange.jsx";
import ProgressQueue from "../components/ProgressQueue.jsx";
import StatusChip from "../components/StatusChip.jsx";
import { ThemeScope, VenueBar, VenueFooter } from "../components/Themed.jsx";
import { BigButton, ConnectionChip, EmptyState, Skeleton, toast } from "../components/ui.jsx";
import { useName, useT } from "../i18n/index.jsx";
import { api } from "../lib/api.js";
import { fmtClock, fmtTime, secondsUntil } from "../lib/format.js";
import { rememberTicket } from "../lib/mine.js";
import { useVenueStream } from "../lib/sse.js";
import { useVenue } from "../lib/theme.js";

/** Spec 6.6 hysteresis: only move the shown estimate when p50 changes by >= max(60 s, 10%). */
function useStableEta(eta) {
  const shown = useRef(null);
  if (!eta) { shown.current = null; return null; }
  const cur = shown.current;
  if (!cur || Math.abs(eta.p50 - cur.p50) >= Math.max(60, 0.1 * cur.p50) || eta.confidence !== cur.confidence
      || (eta.rise_reason && eta.rise_reason !== cur.rise_reason) || eta.p50 < 60) {
    shown.current = eta;
  }
  return shown.current;
}

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(0.15, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    o.start(); o.stop(ctx.currentTime + 0.6);
  } catch { /* audio not allowed */ }
}

export default function Ticket() {
  const { code } = useParams();
  const { t } = useT();
  const name = useName();
  const [first, setFirst] = useState(null);
  const [err, setErr] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [large, setLarge] = useState(() => { try { return localStorage.getItem("qs_large") === "1"; } catch { return false; } });
  const [rating, setRating] = useState(0);
  const prevStatus = useRef(null);

  useEffect(() => {
    api(`/api/tickets/${encodeURIComponent(code)}`).then((d) => { setFirst(d); rememberTicket(d); }).catch(setErr);
  }, [code]);
  const live = useVenueStream(first && first.venue_slug, { want: ["ticket"], ticket: code });
  const tk = live.ticket || first;
  const { venue } = useVenue(first && first.venue_slug);
  const eta = useStableEta(tk && tk.status === "WAITING" ? tk.eta : null);

  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  useEffect(() => {
    document.body.classList.toggle("large-text", large);
    try { localStorage.setItem("qs_large", large ? "1" : "0"); } catch { /* ignore */ }
    return () => document.body.classList.remove("large-text");
  }, [large]);
  useEffect(() => {
    if (!tk) return;
    if (prevStatus.current && prevStatus.current !== "CALLED" && tk.status === "CALLED") {
      if (navigator.vibrate) navigator.vibrate([300, 150, 300, 150, 300]);
      beep();
    }
    prevStatus.current = tk.status;
    document.title = `${tk.code} · ${t(`status.${tk.status}`)}`;
  }, [tk, t]);

  if (err) return (<ThemeScope page><main className="page narrow"><div className="card"><EmptyState icon="🎫" title={t("ticket.notFound")}><Link to="/">{t("nav.home")}</Link></EmptyState></div></main></ThemeScope>);
  if (!tk) return (<ThemeScope page><main className="page narrow"><Skeleton h={160} n={2} /></main></ThemeScope>);

  const act = async (path, body) => {
    try {
      const d = await api(`/api/tickets/${encodeURIComponent(tk.code)}/${path}`, { method: "POST", body: body || {}, idem: true });
      if (d && d.code) setFirst(d);
      live.refresh();
      return d;
    } catch (e) { toast(e.message); return null; }
  };
  const callLeft = tk.call_expires_at ? secondsUntil(tk.call_expires_at, now) : null;
  const active = ["BOOKED", "WAITING", "CALLED", "IN_SERVICE"].includes(tk.status);

  return (
    <ThemeScope theme={venue && venue.theme} page>
      <VenueBar venue={venue || { name: tk.venue_name, slug: tk.venue_slug }} slug={tk.venue_slug} right={<ConnectionChip conn={live.conn} />} />
      <main className="page narrow stack">
        <section className="card center stack" aria-live="polite">
          <div className="small muted">{tk.venue_name} · {name(tk.service_name)}{tk.party_size > 1 ? ` · ${tk.party_size} ${t("common.people")}` : ""}</div>
          <div className="code-big">{tk.code}</div>
          <div><StatusChip status={tk.status} /></div>
        </section>

        {tk.status === "CALLED" && (
          <section className="called" role="alert" aria-live="assertive">
            <div>{t("ticket.yourTurn")}</div>
            <div className="go">{t("ticket.goTo", { place: tk.resource_label || "" })}</div>
            {callLeft != null && callLeft > 0 && <div className="tnum">{t("ticket.expires", { time: fmtClock(callLeft) })}</div>}
            {tk.reason && <div className="small" style={{ opacity: .9 }}>{tk.reason}</div>}
          </section>
        )}

        {tk.status === "WAITING" && (
          <section className="card stack">
            <EtaRange eta={eta} showWhy />
            <ProgressQueue ahead={tk.ahead} position={tk.position} />
          </section>
        )}

        {tk.status === "IN_SERVICE" && (
          <section className="card"><div className="ok-line">✅ {t("ticket.inService")}{tk.resource_label ? ` · ${tk.resource_label}` : ""}</div></section>
        )}
        {tk.status === "BOOKED" && (
          <section className="card stack">
            <b>{t("ticket.booked", { time: fmtTime(tk.slot_start) })}</b>
            <a className="btn sm" href={`/api/tickets/${encodeURIComponent(tk.code)}/ics`}>📅 {t("book.calendar")}</a>
          </section>
        )}

        <div className="stack">
          {tk.status === "BOOKED" && <BigButton variant="primary" disabled={tk.checkin_open === false} onClick={() => act("checkin")}>{t("ticket.checkin")}</BigButton>}
          {tk.is_table && tk.status === "IN_SERVICE" && <BigButton variant="success" onClick={() => act("leaving")}>{t("ticket.leaving")}</BigButton>}
          {tk.status === "WAITING" && tk.can_snooze && <button className="btn block" onClick={() => act("snooze")}>⏭ {t("ticket.snooze")}</button>}
          {active && tk.share_text && (
            <a className="btn block" target="_blank" rel="noopener noreferrer" href={`https://wa.me/?text=${encodeURIComponent(tk.share_text)}`}>💬 {t("ticket.share")}</a>
          )}
          {["BOOKED", "WAITING", "CALLED"].includes(tk.status) && (
            <button className="btn danger block" onClick={() => { if (window.confirm(t("ticket.cancelConfirm"))) act("cancel"); }}>{t("ticket.cancel")}</button>
          )}
        </div>

        {tk.status === "DONE" && (
          <section className="card stack">
            <b>{t("ticket.done")}</b>
            <div className="small">{t("ticket.rate")}</div>
            <div className="row" role="radiogroup" aria-label={t("ticket.rate")}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} className={`btn sm ${n <= (rating || tk.rating || 0) ? "primary" : ""}`} role="radio" aria-checked={n === (rating || tk.rating)}
                  aria-label={`${n} / 5`} onClick={() => { setRating(n); act("feedback", { rating: n }); }}>★ {n}</button>
              ))}
            </div>
            <div className="small">{t("ticket.accurate")}</div>
            <div className="row">
              <button className={`btn sm ${tk.accurate === true ? "primary" : ""}`} onClick={() => act("feedback", { accurate: true }).then(() => toast(t("ticket.thanks")))}>{t("ticket.yes")}</button>
              <button className={`btn sm ${tk.accurate === false ? "primary" : ""}`} onClick={() => act("feedback", { accurate: false }).then(() => toast(t("ticket.thanks")))}>{t("ticket.no")}</button>
            </div>
          </section>
        )}

        {tk.notices && tk.notices.length > 0 && (
          <section className="card">
            <h3>{t("ticket.notices")}</h3>
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
              {tk.notices.map((n, i) => <li key={i}><span className="muted tnum">{fmtTime(n.ts)}</span> {n.text}</li>)}
            </ul>
          </section>
        )}

        <div className="row small">
          <Link to={`/v/${tk.venue_slug}`}>← {tk.venue_name}</Link>
          <span className="spacer" />
          <button className="btn sm ghost" onClick={() => setLarge((l) => !l)} aria-pressed={large}>Aa {t("ticket.large")}</button>
          <button className="btn sm ghost" onClick={() => act("delete-data").then((d) => d && toast(t("ticket.deleted")))}>🗑 {t("ticket.deleteData")}</button>
        </div>
      </main>
      <VenueFooter />
    </ThemeScope>
  );
}
