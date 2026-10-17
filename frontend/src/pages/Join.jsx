import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import EtaRange from "../components/EtaRange.jsx";
import { ThemeScope, VenueBar, VenueFooter } from "../components/Themed.jsx";
import { ConnectionChip, ErrorBox, Skeleton, toast } from "../components/ui.jsx";
import { useName, useT } from "../i18n/index.jsx";
import { api } from "../lib/api.js";
import { useVenueStream } from "../lib/sse.js";
import { rememberTicket } from "../lib/mine.js";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function OpeningHours({ hours }) {
  if (!hours || !hours.length) return null;
  return (
    <table className="small" style={{ maxWidth: 320 }}>
      <tbody>
        {DAYS.map((d, i) => {
          const h = hours.filter((x) => x.weekday === i);
          return <tr key={d}><th>{d}</th><td className="tnum">{h.length ? h.map((x) => `${x.open}–${x.close}`).join(", ") : "Closed"}</td></tr>;
        })}
      </tbody>
    </table>
  );
}

export default function Join() {
  const { slug } = useParams();
  const { t } = useT();
  const name = useName();
  const nav = useNavigate();
  const [venue, setVenue] = useState(null);
  const [vErr, setVErr] = useState(null);
  const [st, setSt] = useState(null);
  const [party, setParty] = useState(1);
  const [senior, setSenior] = useState(false);
  const [dname, setDname] = useState("");
  const [busy, setBusy] = useState(false);
  const [already, setAlready] = useState(null);
  const live = useVenueStream(slug, { want: ["queue"] });

  const load = () => api(`/api/venues/${slug}`).then((v) => {
    setVenue(v); setVErr(null);
    setSt((cur) => cur || (v.service_types[0] && v.service_types[0].id));
  }).catch(setVErr);
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [slug]);

  if (vErr) return (<ThemeScope page><VenueBar slug={slug} /><main className="page narrow"><ErrorBox error={vErr} onRetry={load} /></main></ThemeScope>);
  if (!venue) return (<ThemeScope page><VenueBar slug={slug} /><main className="page narrow"><Skeleton h={120} n={3} /></main></ThemeScope>);

  const service = venue.service_types.find((s) => s.id === st) || venue.service_types[0];
  const isTable = service && service.resource_kind === "table";
  const summary = live.queue;
  const svcLive = summary && summary.services ? summary.services.find((s) => s.service_type_id === (service && service.id)) : null;
  const openNow = summary ? summary.open_now : venue.open_now;
  const canSenior = venue.settings && venue.settings.priority_enabled && service && service.allows_priority;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setAlready(null);
    try {
      // Anonymous ticket: no phone, no login.
      const tk = await api(`/api/venues/${slug}/tickets`, {
        method: "POST", idem: true,
        body: { service_type_id: service.id, party_size: isTable ? party : 1, priority_class: senior ? "SENIOR" : "NORMAL",
          display_name: dname.trim() || undefined, lang: document.documentElement.lang },
      });
      rememberTicket(tk);
      nav(`/t/${encodeURIComponent(tk.code)}`);
    } catch (err) {
      if (err.code === "ALREADY_HAS_TICKET") setAlready(err.hint);
      else toast(err.message);
    } finally { setBusy(false); }
  };

  return (
    <ThemeScope theme={venue.theme} page>
      <VenueBar venue={venue} slug={slug} right={<ConnectionChip conn={live.conn} />} />
      <main className="page narrow stack">
        <section className="vhero">
          <div className="row">
            <span className={`badge ${openNow ? "open" : "closed"}`}>{openNow ? `● ${t("common.open")}` : `○ ${t("common.closed")}`}</span>
          </div>
          <h1 className="vhero-title">{t("join.welcome", { name: venue.name })}</h1>
          {summary && summary.services && summary.services.length > 0 && (
            <div className="vhero-chips">
              {summary.services.map((s) => (
                <span key={s.service_type_id} className="vchip"><b>{name(s.name)}</b> {s.eta ? s.eta.text : "—"}</span>
              ))}
            </div>
          )}
        </section>

        {!openNow ? (
          <section className="card stack">
            <h2>{t("join.closedTitle")}</h2>
            <p className="muted" style={{ margin: 0 }}>{t("join.closedText")}</p>
            <OpeningHours hours={venue.open_hours} />
            <Link className="btn primary block" to={`/b/${slug}`}>{t("join.book")}</Link>
          </section>
        ) : (
          <form className="card stack" onSubmit={submit}>
            <h2>{t("join.title")}</h2>

            <div className="field" style={{ marginBottom: 0 }}>
              <span className="label" id="svc-l">{t("join.service")}</span>
              <div className="tiles" role="radiogroup" aria-labelledby="svc-l">
                {venue.service_types.map((s) => {
                  const ls = summary && summary.services ? summary.services.find((x) => x.service_type_id === s.id) : null;
                  return (
                    <button type="button" key={s.id} role="radio" aria-checked={s.id === service.id}
                      className={`tile ${s.id === service.id ? "on" : ""}`} onClick={() => setSt(s.id)}>
                      <b>{name(s.name)}</b>
                      <span className="small muted">{ls ? `${ls.eta ? ls.eta.text : "—"} · ${t("join.waitingFor", { n: ls.waiting })}` : ""}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {isTable && venue.has_tables && (
              <div className="field" style={{ marginBottom: 0 }}>
                <span className="label" id="party-l">{t("join.party")}</span>
                <div className="stepper" role="group" aria-labelledby="party-l">
                  <button type="button" aria-label="Fewer people" onClick={() => setParty((p) => Math.max(1, p - 1))}>−</button>
                  <output aria-live="polite">{party}</output>
                  <button type="button" aria-label="More people" onClick={() => setParty((p) => Math.min(venue.party_max || 12, p + 1))}>+</button>
                </div>
              </div>
            )}

            <div className="card flat" aria-live="polite">
              <div className="small muted">{t("join.rightNow")}</div>
              {svcLive ? <EtaRange eta={svcLive.eta} /> : <Skeleton h={48} />}
            </div>

            {canSenior && (
              <label className="row" style={{ fontWeight: 600 }}>
                <input type="checkbox" checked={senior} onChange={(e) => setSenior(e.target.checked)} /> {t("join.senior")}
              </label>
            )}

            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="dname">{t("join.name")}</label>
              <input id="dname" value={dname} maxLength={40} onChange={(e) => setDname(e.target.value)} autoComplete="given-name" />
            </div>

            <p className="small muted" style={{ margin: 0 }}>🔒 {t("join.consent")}</p>

            {already && (
              <div className="alert-line" role="alert">
                {t("join.already")} <Link to={`/t/${encodeURIComponent(already)}`}>{t("join.openTicket", { code: already })}</Link>
              </div>
            )}

            <button className="btn primary bigbtn huge" type="submit" disabled={busy}>{t("join.submit")}</button>
            {venue.settings && venue.settings.prebook_max_advance_days > 0 && (
              <Link className="btn ghost" to={`/b/${slug}`}>📅 {t("join.book")}</Link>
            )}
          </form>
        )}
      </main>
      <VenueFooter />
    </ThemeScope>
  );
}
