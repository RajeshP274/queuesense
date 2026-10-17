import { useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ConfidenceTag } from "../components/EtaRange.jsx";
import { EmptyState, ErrorBox, LanguageToggle, Skeleton } from "../components/ui.jsx";
import { useT } from "../i18n/index.jsx";
import { api, auth } from "../lib/api.js";
import { myTickets } from "../lib/mine.js";
import { usePoll } from "../lib/sse.js";
import { FONTS, resolveTheme, themeVars } from "../lib/theme.js";

/** Front door: "Who are you?" - customer, operator (sign up / sign in) or demo tour. QueueSense brand look. */
export default function Landing() {
  const { t } = useT();
  const nav = useNavigate();
  const op = auth.operator();
  const [showPlaces, setShowPlaces] = useState(false);
  const placesRef = useRef(null);
  const { data, error, loading, refresh } = usePoll(() => api("/api/venues"), 8000);
  const [q, setQ] = useState("");
  const [code, setCode] = useState("");
  const list = useMemo(() => (data || []).filter((v) => v.name.toLowerCase().includes(q.trim().toLowerCase())), [data, q]);
  const mine = myTickets();

  const findPlaces = () => {
    setShowPlaces(true);
    setTimeout(() => placesRef.current && placesRef.current.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };
  const openTicket = (e) => {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    if (c) nav(`/t/${encodeURIComponent(c)}`);
  };

  return (
    <div className="brandpage">
      <div className="bp-shapes" aria-hidden="true"><span /><span /><span /></div>
      <header className="bp-top">
        <Link to="/" className="brand"><span className="brand-logo" aria-hidden="true">Q</span>{t("app.name")}</Link>
        <span className="spacer" />
        <Link to="/guide" className="btn sm ghost">📘 {t("nav.tutorial")}</Link>
        <Link to="/help" className="btn sm ghost">{t("nav.help")}</Link>
        <LanguageToggle />
      </header>

      <main className="bp-main">
        <section className="bp-hero">
          <p className="kicker">{t("app.tagline")}</p>
          <h1 className="display">{t("who.welcome")}</h1>
          <p className="lead">{t("who.lead")}</p>
        </section>

        <h2 className="who-q">{t("who.question")}</h2>
        <div className="who-grid">
          {/* ---------- customer ---------- */}
          <section className="who-card who-customer" aria-labelledby="who-c">
            <span className="who-ico" aria-hidden="true">🙋</span>
            <h3 id="who-c">{t("who.customer")}</h3>
            <p className="small muted">{t("who.customerText")}</p>
            <ul className="who-points small">
              <li>✓ {t("who.cp1")}</li><li>✓ {t("who.cp2")}</li><li>✓ {t("who.cp3")}</li>
            </ul>
            <div className="who-actions">
              <button type="button" className="btn primary bigbtn" onClick={findPlaces}>🔎 {t("who.findPlace")}</button>
              <form className="who-code" onSubmit={openTicket}>
                <label htmlFor="tcode" className="tiny muted">{t("who.haveCode")}</label>
                <div className="row" style={{ flexWrap: "nowrap" }}>
                  <input id="tcode" value={code} onChange={(e) => setCode(e.target.value)} placeholder="R-012" autoCapitalize="characters" maxLength={12} />
                  <button type="submit" className="btn" disabled={!code.trim()}>{t("who.open")}</button>
                </div>
              </form>
            </div>
          </section>

          {/* ---------- operator ---------- */}
          <section className="who-card who-operator" aria-labelledby="who-o">
            <span className="who-ico" aria-hidden="true">🧑‍💼</span>
            <h3 id="who-o">{t("who.operator")}</h3>
            <p className="small" style={{ opacity: .85 }}>{t("who.operatorText")}</p>
            <ul className="who-points small">
              <li>✓ {t("choose.perk1")}</li><li>✓ {t("choose.perk2")}</li><li>✓ {t("choose.perk3")}</li>
            </ul>
            <div className="who-actions">
              {op && op.operator ? (
                <>
                  <Link to="/account" className="btn primary bigbtn">→ {t("who.continueAs", { name: op.operator.name })}</Link>
                  <button type="button" className="btn sm ghost" onClick={() => { auth.logoutOperator(); nav(0); }}>{t("auth.notYou")}</button>
                </>
              ) : (
                <>
                  <Link to="/signup" className="btn primary bigbtn"><span className="who-btn-k">{t("who.new")}</span> {t("auth.signUp")}</Link>
                  <Link to="/signin" className="btn bigbtn"><span className="who-btn-k">{t("who.existing")}</span> {t("auth.signIn")}</Link>
                </>
              )}
              <Link to="/staff" className="tiny staff-link">🎛️ {t("choose.staffLogin")}</Link>
            </div>
          </section>

          {/* ---------- demo ---------- */}
          <section className="who-card who-demo" aria-labelledby="who-d">
            <span className="who-ico" aria-hidden="true">🎬</span>
            <h3 id="who-d">{t("who.demo")}</h3>
            <p className="small muted">{t("who.demoText")}</p>
            <ul className="who-points small">
              <li>✓ {t("who.dp1")}</li><li>✓ {t("who.dp2")}</li><li>✓ {t("who.dp3")}</li>
            </ul>
            <div className="who-actions">
              <Link to="/tour" className="btn bigbtn">▶ {t("who.takeTour")}</Link>
            </div>
          </section>
        </div>

        {(showPlaces || mine.length > 0) && (
          <section ref={placesRef} className="choice choice-visit places" aria-labelledby="places-h">
            <div className="row">
              <h2 id="places-h" style={{ margin: 0 }}>🔎 {t("who.placesTitle")}</h2>
              <span className="spacer" />
              {data && data.length > 4 && (
                <input type="search" style={{ maxWidth: 260 }} placeholder={t("choose.search")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("choose.search")} />
              )}
            </div>
            {loading && !data && <Skeleton h={84} n={3} />}
            {error && !data && <ErrorBox error={error} onRetry={refresh} />}
            {data && !data.length && (
              <div className="empty-places">
                <div className="ep-ico" aria-hidden="true">🏪</div>
                <b>{t("choose.noneTitle")}</b>
                <p className="small muted">{t("who.noneText")}</p>
              </div>
            )}
            {data && data.length > 0 && !list.length && <EmptyState icon="🔎" title={t("choose.noMatch")} />}
            <div className="vlist" aria-live="polite">
              {list.map((v) => {
                const th = resolveTheme(v.theme);
                return (
                  <Link key={v.slug} to={`/v/${v.slug}`} className="vcard" style={themeVars(th)}>
                    <span className="vcard-ico" aria-hidden="true">{v.emoji || th.emoji}</span>
                    <span className="vcard-main">
                      <b className="vcard-name" style={{ fontFamily: (FONTS[th.font] || FONTS.modern).headStack }}>{v.name}</b>
                      <span className="vcard-meta">
                        <span className={`dot ${v.open_now ? "on" : ""}`} aria-hidden="true" />
                        {v.open_now ? t("common.open") : t("common.closed")} · {t("landing.waiting", { n: v.queue_length })}
                      </span>
                    </span>
                    <span className="vcard-eta">
                      <span className="tnum">{v.typical_eta ? v.typical_eta.text : "—"}</span>
                      <ConfidenceTag eta={v.typical_eta} />
                    </span>
                    <span className="vcard-go" aria-hidden="true">→</span>
                  </Link>
                );
              })}
            </div>
            {mine.length > 0 && (
              <div className="mine">
                <span className="small muted">🎫 {t("choose.myTickets")}</span>
                <div className="row">{mine.map((m) => <Link key={m.code} className="btn sm" to={`/t/${encodeURIComponent(m.code)}`}>{m.code} · {m.venue}</Link>)}</div>
              </div>
            )}
          </section>
        )}
      </main>

      <footer className="bp-foot">
        <span>{t("landing.footer")}</span>
        <span className="row" style={{ justifyContent: "center", gap: 14 }}>
          <Link to="/guide">📘 {t("nav.tutorial")}</Link>
          <Link to="/tour">🎬 {t("who.takeTour")}</Link>
          <Link to="/help">{t("nav.help")}</Link>
        </span>
      </footer>
    </div>
  );
}
