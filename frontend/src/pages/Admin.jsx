import { useEffect, useState } from "react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Bars, Heatmap, HBars, LineChart, Scatter } from "../components/charts.jsx";
import { ErrorBox, Skeleton, TopBar, toast } from "../components/ui.jsx";
import { useName, useT } from "../i18n/index.jsx";
import { api, auth } from "../lib/api.js";
import { fmtDur, pct } from "../lib/format.js";
import { usePoll } from "../lib/sse.js";

const TABS = ["setup", "settings", "analytics", "whatif", "poster"];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Helper text for every venue setting (spec section 4).
const SETTING_HELP = {
  call_mode: ["Call mode", "staff_tap: staff press NEXT to call. auto_suggest: the engine calls the next person as soon as a resource frees up and holds it for them."],
  grace_minutes_prebook: ["Pre-booking grace (min)", "How late a booked customer may check in before the booking is released as a no-show."],
  checkin_window_minutes: ["Check-in window (min)", "How early before their slot a booked customer can check in."],
  max_active_tickets_per_phone: ["Active tickets per phone", "Stops one phone number from holding several places in the queue."],
  call_timeout_seconds: ["Call timeout (s)", "How long a called customer has to arrive before it counts as a missed call."],
  prebook_slot_minutes: ["Slot length (min)", "Booking slots are offered every N minutes."],
  prebook_max_advance_days: ["Book ahead (days)", "How many days ahead customers can book."],
  prebook_capacity_cap: ["Pre-booking share (0-1)", "Maximum share of capacity that pre-bookings may take, so walk-ins are never starved."],
  priority_enabled: ["Priority classes", "Allow SENIOR (and staff-added EMERGENCY) priority."],
  starvation_limit_minutes: ["Starvation limit (min)", "Anyone waiting longer than this is served next, ahead of seniors."],
  max_consecutive_priority: ["Max priority calls in a row", "After this many priority calls, one regular customer is called."],
  max_table_oversize: ["Table oversize allowed", "A party may get a table with at most this many extra seats (relaxed after 10 min)."],
  max_dwell_minutes: ["Table dwell alert (min)", "Ask staff 'Still occupied?' when a table is used longer than this."],
  self_release_enabled: ["Customer self-release", "Customers can tap 'I'm leaving'; the table frees after staff confirm or 60 s."],
  show_rate_default: ["Expected show rate (0-1)", "Share of pre-bookings expected to turn up; used by the estimator."],
  default_language: ["Default language", "Language for notifications and the QR poster."],
};

function useAdminAuth(slug) {
  const me = auth.staff();
  return me && me.slug === slug && me.role === "ADMIN" ? me : null;
}

export default function Admin() {
  const { slug } = useParams();
  const { t } = useT();
  const nav = useNavigate();
  const me = useAdminAuth(slug);
  const [sp, setSp] = useSearchParams();
  const tab = TABS.includes(sp.get("tab")) ? sp.get("tab") : "analytics";
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const load = () => api(`/api/admin/venues/${slug}`, { as: "staff" }).then((d) => { setData(d); setErr(null); }).catch(setErr);
  useEffect(() => { if (me) load(); /* eslint-disable-next-line */ }, [slug]);

  if (!me) return <Navigate to="/admin" replace />;
  return (
    <>
      <TopBar nav={[
        { to: `/staff/${slug}`, label: "Staff console" }, { to: `/board/${slug}`, label: "Board" }, { to: `/v/${slug}`, label: "Customer page" }]}
        right={<button className="btn sm ghost" onClick={() => { auth.logoutStaff(); nav("/admin"); }}>{t("staff.logout")}</button>} />
      <main className="page">
        <h1 style={{ fontSize: 26 }}>{data ? data.venue.name : t("admin.title")}</h1>
        <div className="tabs no-print" role="tablist">
          {TABS.map((k) => (
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setSp({ tab: k })}>{t(`admin.tab.${k}`)}</button>
          ))}
        </div>
        {err && <ErrorBox error={err} onRetry={load} />}
        {!data && !err && <Skeleton h={160} n={3} />}
        {data && tab === "setup" && <Setup slug={slug} data={data} reload={load} isNew={sp.get("new") === "1"} />}
        {data && tab === "settings" && <Settings slug={slug} venue={data.venue} reload={load} />}
        {data && tab === "analytics" && <Analytics slug={slug} venue={data.venue} />}
        {data && tab === "whatif" && <WhatIf slug={slug} resources={data.resources} />}
        {data && tab === "poster" && <Poster slug={slug} venue={data.venue} />}
      </main>
    </>
  );
}

/* ---------------- Setup wizard ---------------- */
function Setup({ slug, data, reload, isNew }) {
  const { t } = useT();
  const name = useName();
  const { venue, resources, staff_users: users } = data;
  const [step, setStep] = useState(isNew ? 0 : 1);
  const call = async (path, method, body) => {
    try { await api(path, { method, body, as: "staff", idem: method !== "GET" }); toast(t("common.saved")); reload(); }
    catch (e) { toast(e.message); }
  };
  const steps = ["Template", t("admin.services"), t("admin.resources"), t("admin.hours"), t("admin.staffUsers"), t("admin.tab.poster")];

  return (
    <div className="stack">
      <div className="seg" role="tablist" aria-label="Setup steps">
        {steps.map((s, i) => <button key={s} className={step === i ? "on" : ""} onClick={() => setStep(i)}>{i + 1}. {s}</button>)}
      </div>

      {step === 0 && (
        <section className="card stack">
          <h2>Template: {venue.template}</h2>
          <p className="muted small" style={{ margin: 0 }}>The template filled in service types, resources, priors, opening hours and settings. Everything can be edited in the next steps.</p>
        </section>
      )}

      {step === 1 && (
        <section className="card stack">
          <h2>{t("admin.services")}</h2>
          {venue.service_types.map((s) => <ServiceRow key={s.id} s={s} name={name} onSave={(b) => call(`/api/admin/service-types/${s.id}`, "PATCH", b)}
            onDelete={() => window.confirm("Delete?") && call(`/api/admin/service-types/${s.id}`, "DELETE")} />)}
          <button className="btn" onClick={() => call(`/api/admin/venues/${slug}/service-types`, "POST",
            { name: { en: "New service", hi: "नई सेवा", gu: "નવી સેવા" }, prior_mean_seconds: 300, prior_cv: 0.6, color: "#1F6FEB", allows_priority: false, resource_kind: "counter" })}>
            + {t("admin.add")}</button>
        </section>
      )}

      {step === 2 && (
        <section className="card stack">
          <h2>{t("admin.resources")}</h2>
          {resources.map((r) => <ResourceRow key={r.id} r={r} services={venue.service_types} name={name}
            onSave={(b) => call(`/api/admin/resources/${r.id}`, "PATCH", b)} onDelete={() => window.confirm("Delete?") && call(`/api/admin/resources/${r.id}`, "DELETE")} />)}
          <div className="row">
            {["counter", "table", "room"].map((k) => (
              <button key={k} className="btn" onClick={() => call(`/api/admin/venues/${slug}/resources`, "POST", {
                kind: k, label: `${k[0].toUpperCase() + k.slice(1)} ${resources.length + 1}`, capacity: k === "table" ? 4 : 1,
                service_type_ids: venue.service_types.filter((s) => s.resource_kind === k).map((s) => s.id) })}>+ {k}</button>
            ))}
          </div>
        </section>
      )}

      {step === 3 && <HoursEditor venue={venue} onSave={(open_hours) => call(`/api/admin/venues/${slug}`, "PATCH", { open_hours })} />}

      {step === 4 && <StaffUsers users={users} onAdd={(b) => call(`/api/admin/venues/${slug}/staff-users`, "POST", b)}
        onDelete={(id) => window.confirm("Delete?") && call(`/api/admin/staff-users/${id}`, "DELETE")} />}

      {step === 5 && <Poster slug={slug} venue={venue} />}

      <div className="row no-print">
        <button className="btn" disabled={step === 0} onClick={() => setStep(step - 1)}>{t("common.back")}</button>
        <span className="spacer" />
        <button className="btn primary" disabled={step === steps.length - 1} onClick={() => setStep(step + 1)}>{t("common.next")}</button>
      </div>
    </div>
  );
}

function ServiceRow({ s, name, onSave, onDelete }) {
  const [f, setF] = useState({ en: name(s.name), mean: Math.round(s.prior_mean_seconds / 6) / 10, cv: s.prior_cv, kind: s.resource_kind, pri: s.allows_priority, color: s.color || "#1F6FEB" });
  return (
    <div className="card flat grid g4" style={{ alignItems: "end" }}>
      <div className="field" style={{ margin: 0 }}><label>Name</label><input value={f.en} onChange={(e) => setF({ ...f, en: e.target.value })} /></div>
      <div className="field" style={{ margin: 0 }}><label>Typical time (min)</label><input type="number" step="0.5" min="0.25" value={f.mean} onChange={(e) => setF({ ...f, mean: e.target.value })} /></div>
      <div className="field" style={{ margin: 0 }}><label>Variability (cv)</label><input type="number" step="0.05" min="0.1" max="2" value={f.cv} onChange={(e) => setF({ ...f, cv: e.target.value })} /></div>
      <div className="field" style={{ margin: 0 }}><label>Served at</label>
        <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option>counter</option><option>table</option><option>room</option></select></div>
      <label className="row small"><input type="checkbox" checked={f.pri} onChange={(e) => setF({ ...f, pri: e.target.checked })} /> Priority allowed</label>
      <div className="field" style={{ margin: 0 }}><label>Colour</label><input type="color" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} style={{ padding: 2 }} /></div>
      <div className="row">
        <button className="btn primary sm" onClick={() => onSave({ name: { ...(typeof s.name === "object" ? s.name : {}), en: f.en }, prior_mean_seconds: Math.round(+f.mean * 60),
          prior_cv: +f.cv, resource_kind: f.kind, allows_priority: f.pri, color: f.color })}>Save</button>
        <button className="btn danger sm" onClick={onDelete}>Delete</button>
      </div>
    </div>
  );
}

function ResourceRow({ r, services, name, onSave, onDelete }) {
  const [f, setF] = useState({ label: r.label, capacity: r.capacity, kind: r.kind, ids: r.service_type_ids });
  return (
    <div className="card flat stack">
      <div className="grid g4" style={{ alignItems: "end" }}>
        <div className="field" style={{ margin: 0 }}><label>Label</label><input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} /></div>
        <div className="field" style={{ margin: 0 }}><label>Kind</label>
          <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option>counter</option><option>table</option><option>room</option></select></div>
        <div className="field" style={{ margin: 0 }}><label>Seats</label><input type="number" min="1" max="30" value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value })} /></div>
        <div className="row">
          <button className="btn primary sm" onClick={() => onSave({ label: f.label, kind: f.kind, capacity: +f.capacity, service_type_ids: f.ids })}>Save</button>
          <button className="btn danger sm" onClick={onDelete}>Delete</button>
        </div>
      </div>
      <div className="row small">
        {services.map((s) => (
          <label key={s.id} className="row" style={{ gap: 4 }}>
            <input type="checkbox" checked={f.ids.includes(s.id)} onChange={(e) => setF({ ...f, ids: e.target.checked ? [...f.ids, s.id] : f.ids.filter((x) => x !== s.id) })} />
            {name(s.name)}
          </label>
        ))}
      </div>
    </div>
  );
}

function HoursEditor({ venue, onSave }) {
  const { t } = useT();
  const init = DAYS.map((_, i) => {
    const h = (venue.open_hours || []).find((x) => x.weekday === i);
    return h ? { on: true, open: h.open, close: h.close } : { on: false, open: "09:00", close: "17:00" };
  });
  const [rows, setRows] = useState(init);
  return (
    <section className="card stack">
      <h2>{t("admin.hours")}</h2>
      {rows.map((r, i) => (
        <div key={DAYS[i]} className="row">
          <label className="row" style={{ width: 90 }}><input type="checkbox" checked={r.on} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, on: e.target.checked } : x))} /> {DAYS[i]}</label>
          <input type="time" aria-label={`${DAYS[i]} open`} value={r.open} disabled={!r.on} style={{ width: 130 }} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, open: e.target.value } : x))} />
          <span>–</span>
          <input type="time" aria-label={`${DAYS[i]} close`} value={r.close} disabled={!r.on} style={{ width: 130 }} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, close: e.target.value } : x))} />
        </div>
      ))}
      <button className="btn primary" onClick={() => onSave(rows.map((r, i) => r.on ? { weekday: i, open: r.open, close: r.close } : null).filter(Boolean))}>{t("common.save")}</button>
    </section>
  );
}

function StaffUsers({ users, onAdd, onDelete }) {
  const { t } = useT();
  const [f, setF] = useState({ name: "", role: "STAFF", pin: "" });
  return (
    <section className="card stack">
      <h2>{t("admin.staffUsers")}</h2>
      <table><thead><tr><th>Name</th><th>Role</th><th /></tr></thead>
        <tbody>{users.map((u) => <tr key={u.id}><td>{u.name}</td><td>{u.role}</td><td className="num"><button className="btn danger sm" onClick={() => onDelete(u.id)}>{t("admin.delete")}</button></td></tr>)}</tbody>
      </table>
      <form className="grid g4" style={{ alignItems: "end" }} onSubmit={(e) => { e.preventDefault(); onAdd(f); setF({ name: "", role: "STAFF", pin: "" }); }}>
        <div className="field" style={{ margin: 0 }}><label htmlFor="su-n">Name</label><input id="su-n" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div className="field" style={{ margin: 0 }}><label htmlFor="su-r">Role</label>
          <select id="su-r" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option>STAFF</option><option>ADMIN</option></select></div>
        <div className="field" style={{ margin: 0 }}><label htmlFor="su-p">PIN (4-6 digits)</label>
          <input id="su-p" required pattern="[0-9]{4,6}" inputMode="numeric" value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value })} /></div>
        <button className="btn primary" type="submit">+ {t("admin.add")}</button>
      </form>
      <p className="tiny muted" style={{ margin: 0 }}>PINs are stored hashed (bcrypt) and cannot be shown again.</p>
    </section>
  );
}

/* ---------------- Settings ---------------- */
function Settings({ slug, venue, reload }) {
  const { t } = useT();
  const [s, setS] = useState({ ...venue.settings });
  const save = async () => {
    try { await api(`/api/admin/venues/${slug}/settings`, { method: "PATCH", body: s, as: "staff", idem: true }); toast(t("common.saved")); reload(); }
    catch (e) { toast(e.message); }
  };
  return (
    <section className="card stack">
      <h2>{t("admin.tab.settings")}</h2>
      <div className="grid g2">
        {Object.keys(s).map((k) => {
          const [label, help] = SETTING_HELP[k] || [k, ""];
          const v = s[k];
          let input;
          if (typeof v === "boolean") input = <label className="row"><input type="checkbox" checked={v} onChange={(e) => setS({ ...s, [k]: e.target.checked })} /> {v ? "On" : "Off"}</label>;
          else if (k === "call_mode") input = <select id={k} value={v} onChange={(e) => setS({ ...s, [k]: e.target.value })}><option>staff_tap</option><option>auto_suggest</option></select>;
          else if (k === "default_language") input = <select id={k} value={v} onChange={(e) => setS({ ...s, [k]: e.target.value })}><option value="en">English</option><option value="hi">हिन्दी</option><option value="gu">ગુજરાતી</option></select>;
          else if (typeof v === "number") input = <input id={k} type="number" step="any" value={v} onChange={(e) => setS({ ...s, [k]: e.target.value === "" ? "" : +e.target.value })} />;
          else input = <input id={k} value={v ?? ""} onChange={(e) => setS({ ...s, [k]: e.target.value })} />;
          return (
            <div key={k} className="field" style={{ margin: 0 }}>
              <label htmlFor={k}>{label}</label>
              {input}
              <span className="tiny muted">{help}</span>
            </div>
          );
        })}
      </div>
      <button className="btn primary" onClick={save}>{t("common.save")}</button>
    </section>
  );
}

/* ---------------- Analytics ---------------- */
function Analytics({ slug, venue }) {
  const { t } = useT();
  const [range, setRange] = useState("today");
  const qs = () => {
    const to = new Date();
    const from = new Date(to.getTime() - (range === "today" ? 24 : range === "7d" ? 168 : 720) * 3600000);
    return `?from=${from.toISOString()}&to=${to.toISOString()}`;
  };
  const { data, error, loading, refresh } = usePoll(() => api(`/api/admin/venues/${slug}/analytics${qs()}`, { as: "staff" }), 30000, [range]);
  const tz = venue.timezone;
  if (loading && !data) return <Skeleton h={120} n={4} />;
  if (error && !data) return <ErrorBox error={error} onRetry={refresh} />;
  const k = data.kpis, c = data.charts, q = data.quality;
  const tiles = [
    ["Avg wait", fmtDur(k.avg_wait_s)], ["p90 wait", fmtDur(k.p90_wait_s)], ["Avg service", fmtDur(k.avg_service_s)],
    ["Throughput / h", k.throughput_per_hour == null ? "—" : k.throughput_per_hour.toFixed(1)], ["Utilisation", pct(k.utilisation)],
    ["No-show rate", pct(k.no_show_rate)], ["Abandonment", pct(k.abandonment_rate)], ["Avg queue", k.avg_queue_length == null ? "—" : k.avg_queue_length.toFixed(1)],
    ["Pre-booking share", pct(k.prebook_share)], ["Tickets", k.tickets],
  ];
  return (
    <div className="stack">
      <div className="row no-print">
        <div className="seg">{[["today", "24 h"], ["7d", "7 days"], ["30d", "30 days"]].map(([id, l]) => <button key={id} className={range === id ? "on" : ""} onClick={() => setRange(id)}>{l}</button>)}</div>
        <span className="spacer" />
        <a className="btn sm" href={`/api/admin/venues/${slug}/export.csv?kind=tickets`} onClick={(e) => downloadAuth(e, `/api/admin/venues/${slug}/export.csv?kind=tickets`, "tickets.csv")}>⬇ Tickets CSV</a>
        <a className="btn sm" href={`/api/admin/venues/${slug}/export.csv?kind=events`} onClick={(e) => downloadAuth(e, `/api/admin/venues/${slug}/export.csv?kind=events`, "events.csv")}>⬇ Events CSV</a>
      </div>
      <div className="grid g4">{tiles.map(([l, v]) => <div key={l} className="card kpi"><div className="k">{l}</div><div className="v">{v ?? "—"}</div></div>)}</div>

      <section className="card stack">
        <h2>{t("admin.quality")}</h2>
        <p style={{ margin: 0, fontWeight: 700 }}>{q.sentence}</p>
        <div className="grid g4">
          <div className="kpi"><div className="k">MAE</div><div className="v">{fmtDur(q.mae_s)}</div></div>
          <div className="kpi"><div className="k">MAPE</div><div className="v">{pct(q.mape)}</div></div>
          <div className="kpi"><div className="k">Range coverage (target ~60%)</div><div className="v">{pct(q.coverage)}</div></div>
          <div className="kpi"><div className="k">Sigma scale</div><div className="v">{q.sigma_scale == null ? "—" : q.sigma_scale.toFixed(2)}</div></div>
        </div>
        <div className="small muted">Samples: {Object.entries(q.samples || {}).map(([n, v]) => `${n} ${v}`).join(" · ") || "none yet"}</div>
      </section>

      {data.insights && data.insights.length > 0 && (
        <section className="card"><h2>{t("admin.insights")}</h2><ul style={{ margin: 0, paddingLeft: 18 }}>{data.insights.map((s) => <li key={s}>{s}</li>)}</ul></section>
      )}

      <div className="grid g2">
        <section className="card"><h3>Queue length over time</h3><LineChart tz={tz} series={[{ name: "Waiting", points: c.queue_length }]} /></section>
        <section className="card"><h3>Predicted vs actual wait</h3><Scatter points={c.pred_vs_actual} /></section>
        <section className="card"><h3>Wait-time distribution (min)</h3><Bars items={(c.wait_hist || []).map((b) => ({ label: b.bin, v: b.count }))} /></section>
        <section className="card"><h3>Service time trend</h3><LineChart tz={tz} fmtY={(v) => fmtDur(v)} series={(c.service_trend || []).map((s) => ({ name: s.service, points: s.points }))} /></section>
        <section className="card"><h3>Utilisation per resource</h3><HBars items={c.utilisation} /></section>
        <section className="card"><h3>Average wait by weekday × hour</h3><Heatmap heat={c.heatmap} /></section>
      </div>
    </div>
  );
}

async function downloadAuth(e, path, filename) {
  e.preventDefault();
  try {
    const me = auth.staff();
    const res = await fetch(path, { headers: { Authorization: `Bearer ${me && me.token}` } });
    if (!res.ok) throw new Error(res.statusText);
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  } catch (err) { toast(err.message); }
}

/* ---------------- What-if ---------------- */
function WhatIf({ slug, resources }) {
  const { t } = useT();
  const [add, setAdd] = useState(1);
  const [paused, setPaused] = useState([]);
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try { setRes(await api(`/api/admin/venues/${slug}/whatif`, { method: "POST", as: "staff", body: { add_resources: add, pause_resources: paused, horizon: 60 } })); }
    catch (e) { toast(e.message); } finally { setBusy(false); }
  };
  return (
    <section className="card stack">
      <h2>{t("admin.tab.whatif")}</h2>
      <p className="small muted" style={{ margin: 0 }}>Runs the same Monte Carlo simulation as live estimates on the current queue, with the resources changed for the next 60 minutes.</p>
      <div className="field"><span className="label">{t("admin.whatif.add")}</span>
        <div className="stepper"><button type="button" onClick={() => setAdd(Math.max(0, add - 1))} aria-label="Fewer">−</button><output>{add}</output>
          <button type="button" onClick={() => setAdd(Math.min(3, add + 1))} aria-label="More">+</button></div></div>
      <div className="field"><span className="label">{t("admin.whatif.pause")}</span>
        <div className="row small">{resources.map((r) => (
          <label key={r.id} className="row" style={{ gap: 4 }}><input type="checkbox" checked={paused.includes(r.id)}
            onChange={(e) => setPaused(e.target.checked ? [...paused, r.id] : paused.filter((x) => x !== r.id))} />{r.label}</label>))}</div></div>
      <button className="btn primary" onClick={run} disabled={busy}>{t("admin.whatif.run")}</button>
      {res && (
        <div className="grid g2">
          {[["before", t("admin.whatif.before")], ["after", t("admin.whatif.after")]].map(([key, label]) => (
            <div key={key} className={`card ${key === "after" ? "" : "flat"}`}>
              <h3>{label}</h3>
              <div className="kpi"><div className="k">{t("admin.whatif.wait")}</div><div className="v">{fmtDur(res[key].p50_seconds)}</div></div>
              <div className="kpi"><div className="k">{t("admin.whatif.clear")}</div><div className="v">{fmtDur(res[key].clear_seconds)}</div></div>
            </div>
          ))}
          {res.note && <p className="small muted">{res.note}</p>}
        </div>
      )}
    </section>
  );
}

/* ---------------- QR poster (printable) ---------------- */
function Poster({ slug, venue }) {
  const { t } = useT();
  const lines = [
    ["English", "Scan to join the queue", "1. Scan the code  2. Enter your mobile number  3. Wait anywhere, we'll tell you when it's your turn"],
    ["हिन्दी", "लाइन में जुड़ने के लिए स्कैन करें", "1. कोड स्कैन करें  2. मोबाइल नंबर डालें  3. कहीं भी इंतज़ार करें, बारी आने पर हम बताएँगे"],
    ["ગુજરાતી", "લાઇનમાં જોડાવા સ્કેન કરો", "1. કોડ સ્કેન કરો  2. મોબાઇલ નંબર દાખલ કરો  3. ક્યાંય પણ રાહ જુઓ, વારો આવે ત્યારે અમે જણાવીશું"],
  ];
  return (
    <section className="stack">
      <button className="btn primary no-print" onClick={() => window.print()}>🖨 {t("admin.print")}</button>
      <div className="card poster center stack" style={{ maxWidth: 640, margin: "0 auto", padding: 32 }}>
        <h1 style={{ fontSize: 40 }}>{venue.name}</h1>
        <img src={`/api/venues/${slug}/qr.svg`} alt="QR code to join the queue" style={{ width: 300, height: 300, margin: "0 auto", background: "#fff", padding: 8, borderRadius: 12 }} />
        {lines.map(([lang, a, b]) => (
          <div key={lang}><div style={{ fontSize: 22, fontWeight: 800 }}>{a}</div><div className="small">{b}</div></div>
        ))}
        <div className="small muted">No app needed · {window.location.host}/v/{slug}</div>
      </div>
    </section>
  );
}

export { Setup, Settings, Analytics, WhatIf, Poster };

