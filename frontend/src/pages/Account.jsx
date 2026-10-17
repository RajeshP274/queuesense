import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { ConfidenceTag } from "../components/EtaRange.jsx";
import { ErrorBox, LanguageToggle, Skeleton, toast } from "../components/ui.jsx";
import { useT } from "../i18n/index.jsx";
import { api, auth } from "../lib/api.js";
import { FONTS, resolveTheme, themeVars } from "../lib/theme.js";

/** Operator home: all my workplaces, each with its operator website, customer website, tutorial and links. */
export default function Account() {
  const { t } = useT();
  const nav = useNavigate();
  const session = auth.operator();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [opening, setOpening] = useState("");

  const load = () => api("/api/operators/me", { as: "operator" }).then((d) => { setData(d); setErr(null); }).catch((e) => {
    if (e.status === 401) nav("/signin?next=/account", { replace: true }); else setErr(e);
  });
  useEffect(() => { if (session) { load(); const id = setInterval(load, 15000); return () => clearInterval(id); } return undefined; /* eslint-disable-next-line */ }, []);
  useEffect(() => { document.title = `${t("account.title")} · QueueSense`; }, [t]);
  // Without a database (no MONGO_URL) the server keeps data in memory only: warn the operator.
  const [temporary, setTemporary] = useState(false);
  useEffect(() => { api("/api/health").then((h) => setTemporary(h.storage === "mongomock")).catch(() => {}); }, []);

  if (!session || !session.token) return <Navigate to="/signin?next=/account" replace />;

  const openOperator = async (slug) => {
    setOpening(slug);
    try {
      const s = await api(`/api/operators/workplaces/${slug}/session`, { method: "POST", as: "operator" });
      auth.setStaff(s);
      nav(`/op/${slug}`);
    } catch (e) { toast(e.message); } finally { setOpening(""); }
  };
  const signOut = () => { auth.logoutOperator(); nav("/", { replace: true }); };
  const me = (data && data.operator) || session.operator || {};
  const list = (data && data.workplaces) || [];

  return (
    <div className="brandpage">
      <div className="bp-shapes" aria-hidden="true"><span /><span /><span /></div>
      <header className="bp-top">
        <Link to="/" className="brand"><span className="brand-logo" aria-hidden="true">Q</span>{t("app.name")}</Link>
        <span className="spacer" />
        <Link to="/guide" className="btn sm ghost">📘 {t("nav.tutorial")}</Link>
        <LanguageToggle />
        <button type="button" className="btn sm" onClick={signOut}>{t("auth.signOut")}</button>
      </header>

      <main className="bp-main">
        {temporary && (
          <div className="card" role="status" style={{ borderColor: "var(--warning, #F79009)", marginBottom: 16 }}>
            <b>⚠ Temporary storage</b>
            <p className="small muted" style={{ margin: "4px 0 0" }}>
              This server has no database connected, so accounts, workplaces and tickets are erased when it restarts
              (free hosting restarts after about 15 idle minutes). Add a MongoDB Atlas connection string as MONGO_URL
              in your hosting settings to keep data permanently.
            </p>
          </div>
        )}
        <section className="acct-head">
          <div>
            <p className="kicker" style={{ margin: 0 }}>{t("account.kicker")}</p>
            <h1 className="display sm" style={{ margin: "4px 0" }}>{t("account.hi", { name: (me.name || "").split(" ")[0] || "" })}</h1>
            <p className="muted" style={{ margin: 0 }}>{me.email}</p>
          </div>
          <Link to="/create" className="btn primary bigbtn acct-new">＋ {t("choose.create")}</Link>
        </section>

        <h2 className="acct-h2">{t("account.myWorkplaces")}{data ? ` · ${list.length}` : ""}</h2>
        {err && <ErrorBox error={err} onRetry={load} />}
        {!data && !err && <Skeleton h={140} n={2} />}
        {data && !list.length && (
          <div className="empty-places card">
            <div className="ep-ico" aria-hidden="true">🏪</div>
            <b>{t("account.emptyTitle")}</b>
            <p className="small muted">{t("account.emptyText")}</p>
            <Link to="/create" className="btn primary">＋ {t("choose.create")}</Link>
          </div>
        )}
        <div className="acct-grid">
          {list.map((w) => {
            const th = resolveTheme(w.theme);
            const L = w.links || {};
            return (
              <article key={w.slug} className="acct-card" style={themeVars(th)}>
                <div className="acct-card-top">
                  <span className="vcard-ico" aria-hidden="true">{w.emoji || th.emoji}</span>
                  <div style={{ minWidth: 0 }}>
                    <b className="acct-name" style={{ fontFamily: (FONTS[th.font] || FONTS.modern).headStack }}>{w.name}</b>
                    <div className="vcard-meta">
                      <span className={`dot ${w.open_now ? "on" : ""}`} aria-hidden="true" />
                      {w.open_now ? t("common.open") : t("common.closed")} · {t("landing.waiting", { n: w.queue_length || 0 })}
                    </div>
                  </div>
                  <span className="spacer" />
                  <div className="acct-eta">
                    <b className="tnum">{w.typical_eta ? w.typical_eta.text : "—"}</b>
                    <ConfidenceTag eta={w.typical_eta} />
                  </div>
                </div>
                <code className="tiny acct-url">{L.customer || `/v/${w.slug}`}</code>
                <div className="acct-actions">
                  <button type="button" className="btn primary" disabled={opening === w.slug} onClick={() => openOperator(w.slug)}>
                    🧑‍💼 {opening === w.slug ? t("common.loading") : t("account.opSite")}
                  </button>
                  <a className="btn" href={L.customer || `/v/${w.slug}`} target="_blank" rel="noopener">👥 {t("account.custSite")} ↗</a>
                  <Link className="btn sm ghost" to={`/guide/${w.slug}`}>📘 {t("nav.tutorial")}</Link>
                  <Link className="btn sm ghost" to={`/created/${w.slug}`}>🔗 {t("account.links")}</Link>
                </div>
              </article>
            );
          })}
        </div>
      </main>
    </div>
  );
}
