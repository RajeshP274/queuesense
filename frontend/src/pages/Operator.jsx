import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import EtaRange, { ConfidenceTag } from "../components/EtaRange.jsx";
import { linksFor, LinksPanels } from "../components/Links.jsx";
import { ThemeEditor, ThemePreview, ThemeScope } from "../components/Themed.jsx";
import { ErrorBox, LanguageToggle, Skeleton, toast } from "../components/ui.jsx";
import { useName, useT } from "../i18n/index.jsx";
import { api, auth } from "../lib/api.js";
import { useVenueStream } from "../lib/sse.js";
import { PRESETS, resolveTheme, themeVars, useThemes } from "../lib/theme.js";
import { Analytics, Poster, Settings, Setup, WhatIf } from "./Admin.jsx";
import StaffConsole from "./StaffConsole.jsx";

const SECTIONS = [
  { id: "overview", icon: "📊" },
  { id: "staff", icon: "🎛️" },
  { id: "analytics", icon: "📈" },
  { id: "whatif", icon: "🧪" },
  { id: "setup", icon: "🛠️" },
  { id: "settings", icon: "⚙️" },
  { id: "look", icon: "🎨" },
  { id: "poster", icon: "🖨️" },
  { id: "links", icon: "🔗" },
];
const MOBILE_TABS = ["overview", "staff", "analytics", "look", "links"];

/** Operator website: a business portal for one workplace (admin PIN). Visually separate from the customer site. */
export default function Operator() {
  const { slug, section: secParam } = useParams();
  const { t } = useT();
  const nav = useNavigate();
  const me = auth.staff();
  const authed = me && me.slug === slug && me.role === "ADMIN";
  const section = SECTIONS.some((s) => s.id === secParam) ? secParam : "overview";
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [menu, setMenu] = useState(false);
  const load = () => api(`/api/admin/venues/${slug}`, { as: "staff" }).then((d) => { setData(d); setErr(null); }).catch(setErr);
  useEffect(() => { if (authed) load(); /* eslint-disable-next-line */ }, [slug, authed]);
  useEffect(() => { setMenu(false); window.scrollTo(0, 0); }, [section]);
  useEffect(() => { if (data) document.title = `${t(`op.s.${section}`)} · ${data.venue.name}`; }, [data, section, t]);

  if (!authed) return <OpLogin slug={slug} />;
  const venue = data && data.venue;
  const th = resolveTheme(venue && venue.theme);
  const go = (id) => nav(id === "overview" ? `/op/${slug}` : `/op/${slug}/${id}`);

  return (
    <div className="op" style={themeVars(th)}>
      <aside className={`op-side ${menu ? "open" : ""}`} aria-label={t("op.menu")}>
        <div className="op-venue">
          <span className="op-logo" aria-hidden="true">{th.emoji}</span>
          <div style={{ minWidth: 0 }}>
            <b className="op-vname">{venue ? venue.name : slug}</b>
            <div className="op-kicker">{t("op.portal")}</div>
          </div>
        </div>
        <nav className="op-nav">
          {SECTIONS.map((s) => (
            <button key={s.id} type="button" className={section === s.id ? "on" : ""} aria-current={section === s.id ? "page" : undefined} onClick={() => go(s.id)}>
              <span aria-hidden="true">{s.icon}</span>{t(`op.s.${s.id}`)}
            </button>
          ))}
          <div className="op-sep" />
          <a href={`/board/${slug}`} target="_blank" rel="noopener"><span aria-hidden="true">📺</span>{t("links.board")} ↗</a>
          <a href={`/v/${slug}`} target="_blank" rel="noopener"><span aria-hidden="true">👥</span>{t("op.customerSite")} ↗</a>
          <a href={`/guide/${slug}`} target="_blank" rel="noopener"><span aria-hidden="true">📘</span>{t("nav.tutorial")} ↗</a>
          {auth.operator() && <Link to="/account"><span aria-hidden="true">🏠</span>{t("account.myWorkplaces")}</Link>}
        </nav>
        <div className="op-side-foot">
          <LanguageToggle />
          <button type="button" className="btn sm ghost" onClick={() => { auth.logoutStaff(); nav("/"); }}>{t("staff.logout")}</button>
          <Link to="/" className="op-qs"><span className="qs-dot" aria-hidden="true">Q</span> QueueSense</Link>
        </div>
      </aside>
      {menu && <div className="op-scrim" onClick={() => setMenu(false)} role="presentation" />}

      <div className="op-main">
        <header className="op-top">
          <button type="button" className="btn sm ghost op-burger" onClick={() => setMenu(true)} aria-label={t("op.menu")}>☰</button>
          <h1>{t(`op.s.${section}`)}</h1>
          <span className="spacer" />
          <a className="btn sm" href={`/v/${slug}`} target="_blank" rel="noopener">👥 {t("op.customerSite")} ↗</a>
        </header>
        <main className="op-content">
          {err && <ErrorBox error={err} onRetry={load} />}
          {!data && !err && <Skeleton h={160} n={3} />}
          {data && (
            <>
              {section === "overview" && <Overview slug={slug} data={data} go={go} />}
              {section === "staff" && <StaffConsole embedded slug={slug} />}
              {section === "analytics" && <Analytics slug={slug} venue={venue} />}
              {section === "whatif" && <WhatIf slug={slug} resources={data.resources} />}
              {section === "setup" && <Setup slug={slug} data={data} reload={load} isNew={false} />}
              {section === "settings" && <Settings slug={slug} venue={venue} reload={load} />}
              {section === "look" && <LookFeel slug={slug} venue={venue} reload={load} />}
              {section === "poster" && <Poster slug={slug} venue={venue} />}
              {section === "links" && <YourLinks slug={slug} venue={venue} />}
            </>
          )}
        </main>
      </div>

      <nav className="op-tabbar" aria-label={t("op.menu")}>
        {MOBILE_TABS.map((id) => {
          const s = SECTIONS.find((x) => x.id === id);
          return (
            <button key={id} type="button" className={section === id ? "on" : ""} onClick={() => go(id)} aria-current={section === id ? "page" : undefined}>
              <span aria-hidden="true">{s.icon}</span><span>{t(`op.s.${id}`)}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

/* ---------------- login (admin PIN for this workplace) ---------------- */
function OpLogin({ slug }) {
  const { t } = useT();
  const [venue, setVenue] = useState(null);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [, force] = useState(0);
  const op = auth.operator();
  useEffect(() => { api(`/api/venues/${slug}`).then(setVenue).catch(() => setVenue(false)); }, [slug]);
  const th = resolveTheme(venue && venue.theme);
  const withAccount = async () => {
    setBusy(true);
    try {
      const s = await api(`/api/operators/workplaces/${slug}/session`, { method: "POST", as: "operator" });
      auth.setStaff(s);
      force((n) => n + 1);
    } catch (e2) { toast(e2.status === 403 ? t("op.notOwner") : e2.message); } finally { setBusy(false); }
  };
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api("/api/auth/login", { method: "POST", body: { slug, pin } });
      if (r.role !== "ADMIN") { toast(t("op.needAdmin")); return; }
      auth.setStaff(r);
      force((n) => n + 1);
    } catch (e2) { toast(e2.message); } finally { setBusy(false); }
  };
  return (
    <div className="op-login" style={themeVars(th)}>
      <form className="op-login-card stack" onSubmit={submit}>
        <span className="op-logo lg" aria-hidden="true">{th.emoji}</span>
        <div>
          <div className="op-kicker dark">{t("op.portal")}</div>
          <h1 style={{ margin: "4px 0 0" }}>{venue ? venue.name : venue === false ? t("op.unknown") : "…"}</h1>
        </div>
        {op && op.token && venue !== false && (
          <>
            <button type="button" className="btn primary bigbtn" onClick={withAccount} disabled={busy}>
              🧑‍💼 {t("op.withAccount", { name: (op.operator && op.operator.name) || "" })}
            </button>
            <div className="or-line"><span>{t("op.orPin")}</span></div>
          </>
        )}
        <div className="field">
          <label htmlFor="op-pin">{t("links.adminPin")}</label>
          <input id="op-pin" type="password" inputMode="numeric" autoComplete="current-password" pattern="[0-9]{4,6}" maxLength={6}
            value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} required autoFocus={!(op && op.token)} />
        </div>
        <button className={`btn bigbtn ${op && op.token ? "" : "primary"}`} type="submit" disabled={busy || venue === false}>{t("staff.signin")}</button>
        <p className="tiny muted" style={{ margin: 0 }}>{t("op.loginHelp")}</p>
        {!(op && op.token) && <Link to={`/signin?next=${encodeURIComponent(`/op/${slug}`)}`} className="small">{t("op.signinOwner")}</Link>}
        <Link to="/" className="small">← {t("nav.home")}</Link>
      </form>
    </div>
  );
}

/* ---------------- overview ---------------- */
function Overview({ slug, data, go }) {
  const { t } = useT();
  const name = useName();
  const me = auth.staff();
  const live = useVenueStream(slug, { want: ["queue", "console"], token: me && me.token });
  const q = live.queue;
  const c = live.console;
  const res = (c && c.resources) || data.resources || [];
  const open = res.filter((r) => r.status !== "PAUSED" && r.status !== "CLOSED").length;
  const busy = res.filter((r) => r.status === "BUSY" || r.status === "HELD").length;
  const etas = q && q.services ? q.services.filter((s) => s.eta) : [];
  const worst = etas.length ? etas.reduce((a, b) => (b.eta.p50 > a.eta.p50 ? b : a)) : null;
  return (
    <div className="stack">
      <div className="op-kpis">
        <div className="op-kpi"><span>{t("op.k.waiting")}</span><b className="tnum">{q ? q.queue_length : "—"}</b><em>{t("op.k.waitingSub")}</em></div>
        <div className="op-kpi"><span>{t("op.k.open")}</span><b className="tnum">{open}/{res.length}</b><em>{t("op.k.busy", { n: busy })}</em></div>
        <div className="op-kpi accent"><span>{t("op.k.wait")}</span><b className="tnum">{worst ? worst.eta.text : "—"}</b><em>{worst ? <ConfidenceTag eta={worst.eta} /> : t("eta.none")}</em></div>
        <div className="op-kpi"><span>{t("op.k.status")}</span><b>{q ? (q.open_now ? `● ${t("common.open")}` : `○ ${t("common.closed")}`) : "—"}</b><em>{live.conn === "live" ? t("conn.live") : t("conn.paused")}</em></div>
      </div>

      <div className="grid g2">
        <section className="card stack">
          <div className="row"><h2 style={{ margin: 0 }}>{t("op.byService")}</h2><span className="spacer" /><button className="btn sm" onClick={() => go("whatif")}>🧪 {t("admin.tab.whatif")}</button></div>
          {!q && <Skeleton h={60} n={2} />}
          {q && q.services.map((s) => (
            <div key={s.service_type_id} className="svc-row">
              <div><b>{name(s.name)}</b><div className="tiny muted">{t("join.waitingFor", { n: s.waiting })} · {t("op.openRes", { n: s.open_resources })}</div></div>
              <div style={{ textAlign: "right" }}>{s.eta ? <EtaRange eta={s.eta} size="small" /> : <span className="muted">—</span>}</div>
            </div>
          ))}
        </section>

        <section className="card stack">
          <div className="row"><h2 style={{ margin: 0 }}>{t("staff.upNext")}</h2><span className="spacer" /><button className="btn sm primary" onClick={() => go("staff")}>🎛️ {t("op.s.staff")}</button></div>
          {!c && <Skeleton h={60} n={2} />}
          {c && (!c.up_next || !c.up_next.length) && <p className="muted">{t("staff.upNextEmpty")}</p>}
          {c && (c.up_next || []).slice(0, 4).map((u) => (
            <div key={u.ticket_id} className="svc-row"><div><b className="tnum">{u.code}</b>{u.priority_class !== "NORMAL" ? ` ★ ${u.priority_class}` : ""}<div className="tiny muted">{u.reason}</div></div></div>
          ))}
        </section>
      </div>

      <section className="card op-share">
        <img src={`/api/venues/${slug}/qr.svg`} alt={t("poster.scan")} width="120" height="120" />
        <div className="stack" style={{ minWidth: 0, flex: 1 }}>
          <h2 style={{ margin: 0 }}>{t("op.shareTitle")}</h2>
          <p className="small muted" style={{ margin: 0 }}>{t("op.shareText")}</p>
          <code className="op-url">{linksFor(slug).customer}</code>
          <div className="row">
            <button className="btn sm" onClick={() => go("links")}>🔗 {t("op.s.links")}</button>
            <button className="btn sm" onClick={() => go("poster")}>🖨️ {t("admin.tab.poster")}</button>
          </div>
        </div>
      </section>
    </div>
  );
}

/* ---------------- look & feel ---------------- */
function LookFeel({ slug, venue, reload }) {
  const { t } = useT();
  const themes = useThemes();
  const cur = venue.theme || {};
  const [value, setValue] = useState({ preset: cur.preset, primary: cur.primary, accent: cur.accent, font: cur.font, emoji: cur.emoji });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api(`/api/admin/venues/${slug}`, { method: "PATCH", body: { theme: value }, as: "staff", idem: true });
      toast(t("theme.saved"));
      reload();
    } catch (e) { toast(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="grid look-grid">
      <section className="card stack">
        <p className="small muted" style={{ margin: 0 }}>{t("theme.help")}</p>
        <ThemeEditor value={value} onChange={setValue} presets={themes.presets || PRESETS} fonts={themes.fonts} />
        <div className="row">
          <button className="btn" type="button" onClick={() => setValue({ preset: cur.preset })}>{t("theme.reset")}</button>
          <span className="spacer" />
          <button className="btn primary" type="button" onClick={save} disabled={busy}>✓ {t("common.save")}</button>
        </div>
      </section>
      <aside className="stack">
        <div className="small muted">👀 {t("create.preview")}</div>
        <ThemePreview theme={value} name={venue.name} />
      </aside>
    </div>
  );
}

/* ---------------- links ---------------- */
function YourLinks({ slug, venue }) {
  const { t } = useT();
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem(`qs_created_${slug}`)); } catch { /* ignore */ }
  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>{t("op.linksText")}</p>
      <LinksPanels venue={venue} slug={slug} links={(saved && saved.links) || linksFor(slug)}
        staffPin={saved && saved.staff_pin} adminPin={saved && saved.admin_pin} />
      <ThemeScope theme={venue.theme} className="card flat small">
        <b>{t("op.pinNoteTitle")}</b> {t("op.pinNote")}
      </ThemeScope>
    </div>
  );
}
