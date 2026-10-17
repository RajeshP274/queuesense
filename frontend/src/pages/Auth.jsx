import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { LanguageToggle } from "../components/ui.jsx";
import { useT } from "../i18n/index.jsx";
import { api, auth } from "../lib/api.js";

/** Only allow same-site relative paths as ?next= targets. */
function safeNext(n) {
  return n && n.startsWith("/") && !n.startsWith("//") ? n : "/account";
}

/** Operator sign up (mode="signup") and sign in (mode="signin"). Customers never need an account. */
export default function Auth({ mode }) {
  const { t } = useT();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const signup = mode === "signup";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => { document.title = `${signup ? t("auth.signUp") : t("auth.signIn")} · QueueSense`; }, [signup, t]);
  useEffect(() => { const o = auth.operator(); if (o && o.token) nav(next, { replace: true }); /* eslint-disable-next-line */ }, []);
  useEffect(() => { setErr(null); }, [mode]);

  const submit = async (e) => {
    e.preventDefault();
    setErr(null);
    if (signup && password.length < 8) { setErr({ field: "password", message: t("auth.pwRule") }); return; }
    setBusy(true);
    try {
      const body = signup ? { name: name.trim(), email: email.trim(), password } : { email: email.trim(), password };
      const r = await api(signup ? "/api/operators/signup" : "/api/operators/signin", { method: "POST", body });
      auth.setOperator({ token: r.token, operator: r.operator });
      nav(next, { replace: true });
    } catch (e2) {
      const map = {
        EMAIL_TAKEN: { field: "email", message: t("auth.err.taken") },
        WRONG_LOGIN: { field: "password", message: t("auth.err.wrong") },
        RATE_LIMITED: { message: e2.message + (e2.hint ? ` · ${e2.hint}` : "") },
        LOCKED_OUT: { message: e2.message + (e2.hint ? ` · ${e2.hint}` : "") },
        INVALID_INPUT: { message: t("auth.err.invalid") },
        NETWORK: { message: t("auth.err.network") },
      };
      setErr(map[e2.code] || (e2.status === 429 ? { message: e2.message + (e2.hint ? ` · ${e2.hint}` : "") } : { message: e2.message }));
    } finally { setBusy(false); }
  };

  const other = signup ? `/signin${params.get("next") ? `?next=${encodeURIComponent(next)}` : ""}` : `/signup${params.get("next") ? `?next=${encodeURIComponent(next)}` : ""}`;
  const fieldErr = (f) => err && err.field === f ? <span className="field-err" role="alert">{err.message}</span> : null;

  return (
    <div className="brandpage">
      <div className="bp-shapes" aria-hidden="true"><span /><span /><span /></div>
      <header className="bp-top">
        <Link to="/" className="brand"><span className="brand-logo" aria-hidden="true">Q</span>{t("app.name")}</Link>
        <span className="spacer" />
        <LanguageToggle />
      </header>
      <main className="bp-main auth-wrap">
        <form className="auth-card stack" onSubmit={submit} noValidate>
          <div className="auth-head">
            <span className="auth-ico" aria-hidden="true">{signup ? "✨" : "👋"}</span>
            <p className="kicker" style={{ margin: 0 }}>{t("who.operator")}</p>
            <h1>{signup ? t("auth.signupTitle") : t("auth.signinTitle")}</h1>
            <p className="muted small" style={{ margin: 0 }}>{signup ? t("auth.signupSub") : t("auth.signinSub")}</p>
          </div>

          {err && !err.field && <div className="alert-line" role="alert">{err.message}</div>}

          {signup && (
            <div className="field">
              <label htmlFor="a-name">{t("auth.name")}</label>
              <input id="a-name" autoComplete="name" required minLength={2} maxLength={60} value={name}
                onChange={(e) => setName(e.target.value)} autoFocus placeholder={t("auth.namePh")} />
            </div>
          )}
          <div className="field">
            <label htmlFor="a-email">{t("auth.email")}</label>
            <input id="a-email" type="email" autoComplete="email" required value={email} inputMode="email"
              onChange={(e) => setEmail(e.target.value)} autoFocus={!signup} placeholder="you@example.com"
              aria-invalid={!!(err && err.field === "email")} />
            {fieldErr("email")}
          </div>
          <div className="field">
            <label htmlFor="a-pw">{t("auth.password")}</label>
            <div className="pw-box">
              <input id="a-pw" type={show ? "text" : "password"} autoComplete={signup ? "new-password" : "current-password"}
                required minLength={signup ? 8 : 1} value={password} onChange={(e) => setPassword(e.target.value)}
                aria-invalid={!!(err && err.field === "password")} aria-describedby={signup ? "pw-hint" : undefined} />
              <button type="button" className="btn sm ghost" onClick={() => setShow((s) => !s)} aria-pressed={show}>
                {show ? t("links.hide") : t("links.show")}
              </button>
            </div>
            {signup && <span id="pw-hint" className={`tiny ${password && password.length < 8 ? "warn-text" : "muted"}`}>{t("auth.pwHint")}</span>}
            {fieldErr("password")}
          </div>

          <button className="btn primary bigbtn" type="submit"
            disabled={busy || !email.trim() || !password || (signup && !name.trim())}>
            {busy ? t("common.loading") : signup ? t("auth.createAccount") : t("auth.signIn")}
          </button>

          <p className="small center" style={{ margin: 0 }}>
            {signup ? t("auth.haveAccount") : t("auth.noAccount")} <Link to={other}><b>{signup ? t("auth.signIn") : t("auth.signUp")}</b></Link>
          </p>
          <p className="tiny muted center" style={{ margin: 0 }}>{t("auth.customerNote")}</p>
          <Link to="/" className="small center">← {t("nav.home")}</Link>
        </form>
      </main>
    </div>
  );
}
