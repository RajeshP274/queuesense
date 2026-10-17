import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ThemeScope, VenueBar, VenueFooter } from "../components/Themed.jsx";
import { EmptyState, ErrorBox, Skeleton, toast } from "../components/ui.jsx";
import { useName, useT } from "../i18n/index.jsx";
import { api } from "../lib/api.js";
import { fmtTime, isoDate } from "../lib/format.js";
import { rememberTicket } from "../lib/mine.js";

const MARK = { green: "●", amber: "◐", red: "▲", full: "✕" };
const COLOR = { green: "var(--success-text)", amber: "var(--warning-text)", red: "var(--danger-text)", full: "var(--muted)" };

export default function Booking() {
  const { slug } = useParams();
  const { t } = useT();
  const name = useName();
  const [venue, setVenue] = useState(null);
  const [err, setErr] = useState(null);
  const [step, setStep] = useState(0);
  const [st, setSt] = useState(null);
  const [party, setParty] = useState(2);
  const [day, setDay] = useState(0);
  const [slots, setSlots] = useState(null);
  const [slot, setSlot] = useState(null);
  const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api(`/api/venues/${slug}`).then((v) => { setVenue(v); setSt(v.service_types[0] && v.service_types[0].id); }).catch(setErr);
  }, [slug]);

  const service = venue && (venue.service_types.find((s) => s.id === st) || venue.service_types[0]);
  const isTable = service && service.resource_kind === "table";
  const tz = venue && venue.timezone;

  useEffect(() => {
    if (step !== 2 || !service) return;
    setSlots(null); setSlot(null);
    api(`/api/venues/${slug}/slots?service=${service.id}&party=${isTable ? party : 1}&date=${isoDate(day, tz)}`)
      .then(setSlots).catch((e) => { setSlots([]); toast(e.message); });
  }, [step, day, st, party]); // eslint-disable-line react-hooks/exhaustive-deps

  if (err) return (<ThemeScope page><VenueBar slug={slug} /><main className="page narrow"><ErrorBox error={err} /></main></ThemeScope>);
  if (!venue) return (<ThemeScope page><VenueBar slug={slug} /><main className="page narrow"><Skeleton h={140} n={2} /></main></ThemeScope>);

  const days = Array.from({ length: (venue.settings.prebook_max_advance_days || 1) + 1 }, (_, i) => i);
  const book = async () => {
    setBusy(true);
    try {
      // Anonymous booking: no phone, no login.
      const tk = await api(`/api/venues/${slug}/bookings`, { method: "POST", idem: true,
        body: { service_type_id: service.id, party_size: isTable ? party : 1, slot_start: slot.start } });
      rememberTicket(tk); setDone(tk); setStep(4);
    } catch (e) {
      toast(e.code === "ALREADY_HAS_TICKET" ? `${e.message} (${e.hint})` : e.message);
    } finally { setBusy(false); }
  };

  const steps = [t("join.service"), t("join.party"), t("book.slot"), t("book.confirm")];

  return (
    <ThemeScope theme={venue.theme} page>
      <VenueBar venue={venue} slug={slug} />
      <main className="page narrow stack">
        <h1 className="vhero-title" style={{ fontSize: 28 }}>{t("book.title")}</h1>
        <ol className="row small muted" style={{ listStyle: "none", padding: 0, margin: 0 }} aria-label="Steps">
          {steps.map((s, i) => <li key={s} style={{ fontWeight: i === Math.min(step, 3) ? 800 : 500, color: i === Math.min(step, 3) ? "var(--text)" : undefined }}>{i + 1}. {s}{i < steps.length - 1 ? " ›" : ""}</li>)}
        </ol>

        {step === 0 && (
          <section className="card stack">
            <h2>{t("join.service")}</h2>
            <div className="tiles">
              {venue.service_types.map((s) => (
                <button key={s.id} type="button" className={`tile ${s.id === st ? "on" : ""}`} onClick={() => setSt(s.id)} aria-pressed={s.id === st}>
                  <b>{name(s.name)}</b>
                </button>
              ))}
            </div>
            <button className="btn primary block" onClick={() => setStep(isTable ? 1 : 2)}>{t("common.next")}</button>
          </section>
        )}

        {step === 1 && (
          <section className="card stack">
            <h2>{t("join.party")}</h2>
            <div className="stepper">
              <button type="button" aria-label="Fewer" onClick={() => setParty((p) => Math.max(1, p - 1))}>−</button>
              <output>{party}</output>
              <button type="button" aria-label="More" onClick={() => setParty((p) => Math.min(venue.party_max || 12, p + 1))}>+</button>
            </div>
            <div className="row"><button className="btn" onClick={() => setStep(0)}>{t("common.back")}</button><span className="spacer" />
              <button className="btn primary" onClick={() => setStep(2)}>{t("common.next")}</button></div>
          </section>
        )}

        {step === 2 && (
          <section className="card stack">
            <h2>{t("book.date")}</h2>
            <div className="seg">
              {days.map((d) => (
                <button key={d} className={d === day ? "on" : ""} onClick={() => setDay(d)}>
                  {d === 0 ? t("book.today") : d === 1 ? t("book.tomorrow") : isoDate(d, tz)}
                </button>
              ))}
            </div>
            <h2 style={{ marginTop: 8 }}>{t("book.slot")}</h2>
            {!slots && <Skeleton h={120} />}
            {slots && !slots.length && <EmptyState icon="📅" title={t("book.noSlots")} />}
            {slots && slots.length > 0 && (
              <div className="tiles" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))" }}>
                {slots.map((s) => (
                  <button key={s.start} type="button" disabled={s.status === "full"} className={`tile ${slot && slot.start === s.start ? "on" : ""}`}
                    onClick={() => setSlot(s)} aria-pressed={!!slot && slot.start === s.start} style={{ minHeight: 64 }}>
                    <b className="tnum">{s.label}</b>
                    <span className="tiny" style={{ color: COLOR[s.status], fontWeight: 700 }}>{MARK[s.status]} {t(`book.${s.status}`)}</span>
                    {s.reason && <span className="tiny muted" style={{ display: "block" }}>{s.reason}</span>}
                  </button>
                ))}
              </div>
            )}
            <div className="row"><button className="btn" onClick={() => setStep(isTable ? 1 : 0)}>{t("common.back")}</button><span className="spacer" />
              <button className="btn primary" disabled={!slot} onClick={() => setStep(3)}>{t("common.next")}</button></div>
          </section>
        )}

        {step === 3 && (
          <section className="card stack">
            <h2>{t("book.review")}</h2>
            <div className="card flat stack">
              <div className="row"><span className="muted small">{t("join.service")}</span><span className="spacer" /><b>{name(service.name)}</b></div>
              {isTable && <div className="row"><span className="muted small">{t("join.party")}</span><span className="spacer" /><b>{party}</b></div>}
              <div className="row"><span className="muted small">{t("book.slot")}</span><span className="spacer" />
                <b className="tnum">{day === 0 ? t("book.today") : day === 1 ? t("book.tomorrow") : isoDate(day, tz)} · {slot && slot.label}</b></div>
            </div>
            <p className="small muted" style={{ margin: 0 }}>🔒 {t("join.consent")}</p>
            <div className="row"><button className="btn" onClick={() => setStep(2)}>{t("common.back")}</button><span className="spacer" />
              <button className="btn primary" disabled={busy} onClick={book}>✓ {t("book.confirm")}</button></div>
          </section>
        )}

        {step === 4 && done && (
          <section className="card center stack">
            <h2>✅ {t("book.confirmed")}</h2>
            <div className="code-big">{done.code}</div>
            <div className="tnum">{t("ticket.booked", { time: fmtTime(done.slot_start, tz) })}</div>
            <img src={`/api/venues/${slug}/qr.svg`} alt="Venue QR code" width="160" height="160" style={{ margin: "0 auto", background: "#fff", borderRadius: 8, padding: 6 }} />
            <a className="btn" href={`/api/tickets/${encodeURIComponent(done.code)}/ics`}>📅 {t("book.calendar")}</a>
            <Link className="btn primary" to={`/t/${encodeURIComponent(done.code)}`}>{t("book.viewTicket")}</Link>
          </section>
        )}
      </main>
      <VenueFooter />
    </ThemeScope>
  );
}
