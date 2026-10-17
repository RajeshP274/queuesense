import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ErrorBox, TopBar, toast } from "../components/ui.jsx";
import { useT } from "../i18n/index.jsx";
import { api, auth } from "../lib/api.js";

/** Login for staff (/staff -> staff console) and admin (/admin -> operator website). */
export default function StaffLogin({ role }) {
  const { t } = useT();
  const nav = useNavigate();
  const [venues, setVenues] = useState(null);
  const [err, setErr] = useState(null);
  const [slug, setSlug] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const isAdmin = role === "ADMIN";
  const base = isAdmin ? "/op" : "/staff";   // admins land on the operator website

  const load = () => api("/api/venues").then((v) => { setVenues(v); setSlug((s) => s || (v[0] && v[0].slug) || ""); setErr(null); }).catch(setErr);
  useEffect(() => {
    load();
    const a = auth.staff();
    if (a && (!isAdmin || a.role === "ADMIN")) nav(`${base}/${a.slug}`, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api("/api/auth/login", { method: "POST", body: { slug, pin } });
      if (isAdmin && r.role !== "ADMIN") { toast(t("op.needAdmin")); return; }
      auth.setStaff(r);
      nav(`${base}/${r.slug}`);
    } catch (e2) { toast(e2.message); } finally { setBusy(false); }
  };

  return (
    <>
      <TopBar />
      <main className="page narrow stack">
        <form className="card stack" onSubmit={login}>
          <h1 style={{ fontSize: 26 }}>{isAdmin ? t("staff.adminLogin") : t("staff.login")}</h1>
          {err && <ErrorBox error={err} onRetry={load} />}
          <div className="field">
            <label htmlFor="venue">{t("staff.venue")}</label>
            <select id="venue" value={slug} onChange={(e) => setSlug(e.target.value)} required>
              {(venues || []).map((v) => <option key={v.slug} value={v.slug}>{v.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="pin">{t("staff.pin")}</label>
            <input id="pin" type="password" inputMode="numeric" autoComplete="current-password" pattern="[0-9]{4,6}" maxLength={6}
              value={pin} onChange={(e) => setPin(e.target.value)} required />
          </div>
          <button className="btn primary bigbtn" type="submit" disabled={busy || !slug}>{t("staff.signin")}</button>
          <p className="small muted" style={{ margin: 0 }}>{t("staff.pinHelp")}</p>
        </form>

        {isAdmin && (
          <Link to="/signin?next=/account" className="card card-link row" style={{ flexWrap: "nowrap" }}>
            <span style={{ fontSize: 28 }} aria-hidden="true">🧑‍💼</span>
            <span><b>{t("auth.ownerSignin")}</b><br /><span className="small muted">{t("auth.ownerSigninText")}</span></span>
          </Link>
        )}
      </main>
    </>
  );
}
