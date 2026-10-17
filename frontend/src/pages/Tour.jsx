import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import EtaRange from "../components/EtaRange.jsx";
import ProgressQueue from "../components/ProgressQueue.jsx";
import ResourceCard from "../components/ResourceCard.jsx";
import StatusChip from "../components/StatusChip.jsx";
import { ThemeScope } from "../components/Themed.jsx";
import { LineChart } from "../components/charts.jsx";
import { LanguageToggle } from "../components/ui.jsx";
import { useT } from "../i18n/index.jsx";
import { PRESETS } from "../lib/theme.js";

// Guided demo with SAMPLE screens: real components, static props, no API calls, nothing written to any workplace.
const THEME = { preset: "restaurant", ...PRESETS.find((p) => p.id === "restaurant") };
const ETA_JOIN = { p20: 480, p50: 600, p80: 720, text: "8–12 min", confidence: "High", reason: "Based on the last 24 customers for Table for dining" };
const ETA_TICKET = { p20: 360, p50: 450, p80: 540, text: "6–9 min", confidence: "High", reason: "Based on the last 24 customers for Table for dining" };
const STEPS = ["scan", "ticket", "staff", "called", "operator", "start"];

function Device({ children, wide = false }) {
  const { t } = useT();
  return (
    <div className={`tour-device ${wide ? "wide" : ""}`}>
      <span className="tour-sample" aria-label={t("tour.sampleAria")}>{t("tour.sample")}</span>
      <ThemeScope theme={THEME} className="tour-screen">{children}</ThemeScope>
    </div>
  );
}

function SampleBar() {
  return (
    <div className="tour-vbar"><span aria-hidden="true">🍽️</span><b>Spice Garden</b><span className="spacer" /><span className="tiny">● Live</span></div>
  );
}

function ScreenScan() {
  const { t } = useT();
  return (
    <Device>
      <SampleBar />
      <div className="tour-body stack">
        <div className="tiny tour-open">● {t("common.open")}</div>
        <h3 className="tour-h">Welcome to Spice Garden</h3>
        <div className="tour-tiles">
          <div className="tour-tile on"><b>Table for dining</b><span className="tiny muted">8–12 min · 4 waiting</span></div>
          <div className="tour-tile"><b>Takeaway order</b><span className="tiny muted">~3 min · 1 waiting</span></div>
        </div>
        <div className="card flat">
          <div className="tiny muted">{t("join.rightNow")}</div>
          <EtaRange eta={ETA_JOIN} />
        </div>
        <div className="tour-cta">{t("tour.getToken")}</div>
      </div>
    </Device>
  );
}

function ScreenTicket() {
  const { t } = useT();
  return (
    <Device>
      <SampleBar />
      <div className="tour-body stack">
        <div className="card center stack" style={{ padding: 14 }}>
          <div className="tiny muted">Spice Garden · Table for dining · 4 {t("common.people")}</div>
          <div className="code-big" style={{ fontSize: 52 }}>R-012</div>
          <div><StatusChip status="WAITING" /></div>
        </div>
        <div className="card stack" style={{ padding: 14 }}>
          <EtaRange eta={ETA_TICKET} />
          <ProgressQueue ahead={2} position={3} />
        </div>
      </div>
    </Device>
  );
}

function ScreenStaff() {
  const now = useMemo(() => Date.now(), []);
  const r = useMemo(() => ({
    id: "sample-r", kind: "counter", label: "Takeaway", capacity: 1, status: "BUSY", service_type_ids: [],
    status_changed_at: new Date(now - 140000).toISOString(),
    ticket: { id: "sample-t", code: "R-009", status: "IN_SERVICE", party_size: 1, priority_class: "NORMAL", display_name: null,
      called_at: new Date(now - 140000).toISOString(), service_start_at: new Date(now - 125000).toISOString() },
    held_for_code: null, held_until: null, dwell_seconds: null, dwell_alert: false, pending_release: false,
  }), [now]);
  return (
    <Device>
      <div className="tour-body" style={{ paddingTop: 12 }}>
        <div className="row small" style={{ marginBottom: 10 }}><b>Spice Garden</b><span className="spacer" /><span className="muted">Waiting 4</span></div>
        <ResourceCard r={r} index={0} selected={false} onSelect={() => {}} onAction={() => {}} now={now} />
      </div>
    </Device>
  );
}

function ScreenCalled() {
  const { t } = useT();
  return (
    <Device>
      <SampleBar />
      <div className="tour-body stack">
        <div className="card center" style={{ padding: 12 }}><div className="code-big" style={{ fontSize: 44 }}>R-012</div><StatusChip status="CALLED" /></div>
        <section className="called" role="presentation">
          <div>{t("ticket.yourTurn")}</div>
          <div className="go">{t("ticket.goTo", { place: "Table 4" })}</div>
          <div className="small" style={{ opacity: .9 }}>Next in line, waiting 11 min; smallest free table that fits 4 (4 seats)</div>
        </section>
      </div>
    </Device>
  );
}

function ScreenOperator() {
  const { t } = useT();
  const series = useMemo(() => {
    const now = Date.now();
    const vals = [1, 2, 2, 3, 5, 6, 8, 7, 6, 4, 4, 3, 2, 3, 4];
    return [{ name: t("tour.queueLen"), points: vals.map((v, i) => ({ t: new Date(now - (vals.length - 1 - i) * 600000).toISOString(), v })) }];
  }, [t]);
  return (
    <Device wide>
      <div className="tour-body stack">
        <div className="row"><b>📊 {t("op.s.overview")}</b><span className="spacer" /><span className="tiny muted">Spice Garden</span></div>
        <div className="op-kpis tour-kpis">
          <div className="op-kpi"><span>{t("op.k.waiting")}</span><b className="tnum">4</b><em>{t("op.k.waitingSub")}</em></div>
          <div className="op-kpi"><span>{t("op.k.open")}</span><b className="tnum">10/10</b><em>{t("op.k.busy", { n: 7 })}</em></div>
          <div className="op-kpi accent"><span>{t("op.k.wait")}</span><b className="tnum">8–12 min</b><em>● High</em></div>
        </div>
        <div className="card flat"><LineChart series={series} height={150} tz="Asia/Kolkata" /></div>
      </div>
    </Device>
  );
}

function ScreenStart() {
  const { t } = useT();
  return (
    <div className="tour-final card stack center">
      <div style={{ fontSize: 56 }} aria-hidden="true">🚀</div>
      <h3 style={{ margin: 0, fontSize: 24 }}>{t("tour.s6.panel")}</h3>
      <p className="muted small" style={{ margin: 0 }}>{t("tour.s6.panelText")}</p>
      <Link to="/signup" className="btn primary bigbtn">✨ {t("tour.signupCta")}</Link>
      <Link to="/signin" className="small">{t("auth.haveAccount")} <b>{t("auth.signIn")}</b></Link>
    </div>
  );
}

const SCREENS = { scan: ScreenScan, ticket: ScreenTicket, staff: ScreenStaff, called: ScreenCalled, operator: ScreenOperator, start: ScreenStart };
const ICONS = { scan: "📱", ticket: "🎫", staff: "👆", called: "🔔", operator: "📊", start: "🚀" };

export default function Tour() {
  const { t } = useT();
  const [i, setI] = useState(0);
  const key = STEPS[i];
  const Screen = SCREENS[key];
  const go = (n) => setI(Math.max(0, Math.min(STEPS.length - 1, n)));

  useEffect(() => { document.title = `${t("who.takeTour")} · QueueSense`; }, [t]);
  useEffect(() => {
    const onKey = (e) => {
      if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement && document.activeElement.tagName)) return;
      if (e.key === "ArrowRight") setI((x) => Math.min(STEPS.length - 1, x + 1));
      if (e.key === "ArrowLeft") setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="brandpage">
      <div className="bp-shapes" aria-hidden="true"><span /><span /><span /></div>
      <header className="bp-top">
        <Link to="/" className="brand"><span className="brand-logo" aria-hidden="true">Q</span>{t("app.name")}</Link>
        <span className="spacer" />
        <Link to="/signup" className="btn sm primary">{t("auth.signUp")}</Link>
        <LanguageToggle />
      </header>
      <main className="bp-main tour">
        <div className="tour-head">
          <p className="kicker" style={{ margin: 0 }}>{t("tour.kicker")}</p>
          <h1 className="display sm" style={{ margin: "4px 0 0" }}>{t("tour.title")}</h1>
        </div>

        <ol className="tour-dots" aria-label={t("tour.progress")}>
          {STEPS.map((s, n) => (
            <li key={s}>
              <button type="button" className={n === i ? "on" : n < i ? "done" : ""} onClick={() => go(n)}
                aria-current={n === i ? "step" : undefined} aria-label={`${n + 1}. ${t(`tour.s${n + 1}.title`)}`}>
                <span aria-hidden="true">{ICONS[s]}</span>
              </button>
            </li>
          ))}
        </ol>

        <section className="tour-step" aria-live="polite">
          <div className="tour-text">
            <div className="tour-n">{t("tour.stepOf", { n: i + 1, total: STEPS.length })}</div>
            <h2>{t(`tour.s${i + 1}.title`)}</h2>
            <p>{t(`tour.s${i + 1}.text`)}</p>
            <ul className="who-points small">
              {[1, 2].map((k) => <li key={k}>✓ {t(`tour.s${i + 1}.p${k}`)}</li>)}
            </ul>
          </div>
          <div className="tour-visual"><Screen /></div>
        </section>

        <div className="row tour-nav">
          <button type="button" className="btn" onClick={() => go(i - 1)} disabled={i === 0}>← {t("common.back")}</button>
          <span className="spacer" />
          <span className="tiny muted tour-keys">{t("tour.keys")}</span>
          {i < STEPS.length - 1
            ? <button type="button" className="btn primary" onClick={() => go(i + 1)}>{t("common.next")} →</button>
            : <Link to="/signup" className="btn primary">✨ {t("tour.signupCta")}</Link>}
        </div>
        <p className="tiny muted center">{t("tour.disclaimer")}</p>
      </main>
    </div>
  );
}
