import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { ThemeEditor, ThemePreview } from "../components/Themed.jsx";
import { LanguageToggle, Skeleton, toast } from "../components/ui.jsx";
import { useT } from "../i18n/index.jsx";
import { api, auth } from "../lib/api.js";
import { PRESETS, useThemes } from "../lib/theme.js";

const FALLBACK_TEMPLATES = [
  { id: "restaurant", name: "Restaurant", emoji: "🍽️", description: "Tables for groups, waitlist and reservations", default_theme: "restaurant" },
  { id: "canteen", name: "Canteen", emoji: "🍛", description: "Dine-in tables plus takeaway counters", default_theme: "canteen" },
  { id: "hospital", name: "Hospital OPD", emoji: "🏥", description: "Doctor rooms per department, senior and emergency priority", default_theme: "hospital" },
  { id: "admin_office", name: "Admin office", emoji: "🏛️", description: "Counters for documents, certificates and fees", default_theme: "admin_office" },
  { id: "custom", name: "Custom", emoji: "✨", description: "Start blank and set it up your way", default_theme: "custom" },
];
const STEPS = ["name", "type", "look", "pins"];
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 32);
const presetOf = (tpl) => (!tpl ? "custom" : typeof tpl.default_theme === "string" ? tpl.default_theme
  : (tpl.default_theme && (tpl.default_theme.preset || tpl.default_theme.id)) || tpl.id);

/** Operator wizard: name -> type -> look & feel -> PINs -> creates the workplace and both websites. */
export default function Create() {
  const { t } = useT();
  const nav = useNavigate();
  const themes = useThemes();
  const [step, setStep] = useState(0);
  const [templates, setTemplates] = useState(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [tpl, setTpl] = useState(null);
  const [theme, setTheme] = useState({ preset: "restaurant" });
  const [staffPin, setStaffPin] = useState("1234");
  const [adminPin, setAdminPin] = useState("0000");
  const [showPins, setShowPins] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api("/api/admin/templates").then((d) => setTemplates(d && d.length ? d : FALLBACK_TEMPLATES)).catch(() => setTemplates(FALLBACK_TEMPLATES));
  }, []);
  useEffect(() => { document.title = `${t("create.title")} · QueueSense`; }, [t]);

  const pickType = (tp) => { setTpl(tp); setTheme({ preset: presetOf(tp) }); };
  const pinOk = (p) => /^\d{4,6}$/.test(p);
  const valid = [
    name.trim().length >= 2 && /^[a-z0-9-]{3,40}$/.test(slug || slugify(name)),
    !!tpl,
    true,
    pinOk(staffPin) && pinOk(adminPin) && staffPin !== adminPin,
  ];

  const submit = async () => {
    if (!valid.every(Boolean)) return;
    setBusy(true);
    try {
      const body = { name: name.trim(), template: tpl.id, slug: slug || slugify(name), theme, staff_pin: staffPin, admin_pin: adminPin };
      const r = await api("/api/admin/venues", { method: "POST", body, idem: true, as: "operator" });
      const s = r.venue.slug;
      let session = r.admin_session;
      if (!session) session = await api("/api/auth/login", { method: "POST", body: { slug: s, pin: adminPin } });
      auth.setStaff(session);
      const saved = { ...r, staff_pin: r.staff_pin || staffPin, admin_pin: r.admin_pin || adminPin };
      try { sessionStorage.setItem(`qs_created_${s}`, JSON.stringify(saved)); } catch { /* ignore */ }
      nav(`/created/${s}`, { state: saved });
    } catch (e) {
      if (e.status === 401) { nav("/signin?next=/create"); return; }
      toast(e.message);
      if (e.code === "CANNOT_CREATE" && /slug/i.test(e.message)) { setStep(0); setSlugTouched(true); }
    } finally { setBusy(false); }
  };

  const next = () => { if (step < STEPS.length - 1) setStep(step + 1); else submit(); };

  // Only signed-in operators can create workplaces; the workplace is owned by their account.
  const op = auth.operator();
  if (!op || !op.token) return <Navigate to="/signin?next=/create" replace />;

  return (
    <div className="brandpage">
      <div className="bp-shapes" aria-hidden="true"><span /><span /><span /></div>
      <header className="bp-top">
        <Link to="/" className="brand"><span className="brand-logo" aria-hidden="true">Q</span>{t("app.name")}</Link>
        <span className="spacer" />
        <LanguageToggle />
      </header>
      <main className="bp-main wizard">
        <div className="wiz-head">
          <Link to="/account" className="small">← {t("account.back")}</Link>
          <h1 className="display sm">{t("create.title")}</h1>
          <p className="lead">{t("create.sub")}</p>
          <ol className="wiz-steps" aria-label={t("create.progress")}>
            {STEPS.map((k, i) => (
              <li key={k} className={i === step ? "on" : i < step ? "done" : ""}>
                <button type="button" onClick={() => i <= step || valid.slice(0, i).every(Boolean) ? setStep(i) : null} aria-current={i === step ? "step" : undefined}>
                  <span className="wiz-n">{i < step ? "✓" : i + 1}</span><span className="wiz-l">{t(`create.step.${k}`)}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>

        <div className="wiz-grid">
          <form className="card wiz-card stack" onSubmit={(e) => { e.preventDefault(); if (valid[step]) next(); }}>
            {step === 0 && (
              <>
                <h2>{t("create.q.name")}</h2>
                <div className="field">
                  <label htmlFor="wname">{t("create.nameLabel")}</label>
                  <input id="wname" autoFocus value={name} maxLength={60} placeholder={t("create.namePlaceholder")}
                    onChange={(e) => { setName(e.target.value); if (!slugTouched) setSlug(slugify(e.target.value)); }} />
                </div>
                <div className="field">
                  <label htmlFor="wslug">{t("create.linkLabel")}</label>
                  <div className="slugbox"><span className="tiny muted">{window.location.host}/v/</span>
                    <input id="wslug" value={slug} maxLength={40} pattern="[a-z0-9\-]{3,40}"
                      onChange={(e) => { setSlugTouched(true); setSlug(slugify(e.target.value)); }} /></div>
                  <span className="tiny muted">{t("create.linkHelp")}</span>
                </div>
              </>
            )}

            {step === 1 && (
              <>
                <h2>{t("create.q.type")}</h2>
                {!templates ? <Skeleton h={90} n={3} /> : (
                  <div className="typegrid" role="radiogroup" aria-label={t("create.q.type")}>
                    {templates.map((tp) => {
                      const p = (themes.presets || PRESETS).find((x) => x.id === presetOf(tp));
                      return (
                        <button key={tp.id} type="button" role="radio" aria-checked={tpl && tpl.id === tp.id}
                          className={`typecard ${tpl && tpl.id === tp.id ? "on" : ""}`} onClick={() => pickType(tp)}
                          style={p ? { "--tc": p.primary } : undefined}>
                          <span className="tc-ico" aria-hidden="true">{tp.emoji || (p && p.emoji) || "📍"}</span>
                          <b>{tp.name}</b>
                          <span className="small muted">{tp.description}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            )}

            {step === 2 && (
              <>
                <h2>{t("create.q.look")}</h2>
                <ThemeEditor value={theme} onChange={setTheme} presets={themes.presets || PRESETS} fonts={themes.fonts} />
              </>
            )}

            {step === 3 && (
              <>
                <h2>{t("create.q.pins")}</h2>
                <p className="small muted" style={{ marginTop: 0 }}>{t("create.pinsHelp")}</p>
                <div className="grid g2">
                  <div className="field">
                    <label htmlFor="apin">🧑‍💼 {t("links.adminPin")}</label>
                    <input id="apin" type={showPins ? "text" : "password"} inputMode="numeric" maxLength={6} value={adminPin}
                      onChange={(e) => setAdminPin(e.target.value.replace(/\D/g, ""))} autoComplete="new-password" />
                    <span className="tiny muted">{t("create.adminPinHelp")}</span>
                  </div>
                  <div className="field">
                    <label htmlFor="spin">🎛️ {t("links.staffPin")}</label>
                    <input id="spin" type={showPins ? "text" : "password"} inputMode="numeric" maxLength={6} value={staffPin}
                      onChange={(e) => setStaffPin(e.target.value.replace(/\D/g, ""))} autoComplete="new-password" />
                    <span className="tiny muted">{t("create.staffPinHelp")}</span>
                  </div>
                </div>
                <label className="row small" style={{ fontWeight: 600 }}>
                  <input type="checkbox" checked={showPins} onChange={(e) => setShowPins(e.target.checked)} /> {t("create.showPins")}
                </label>
                {(!pinOk(staffPin) || !pinOk(adminPin)) && <div className="alert-line">{t("create.pinRule")}</div>}
                {pinOk(staffPin) && staffPin === adminPin && <div className="alert-line">{t("create.pinDiff")}</div>}
                <div className="card flat small">
                  <b>{name || t("create.namePlaceholder")}</b> · {tpl ? tpl.name : ""}<br />
                  <span className="muted">{window.location.host}/v/{slug || slugify(name)}</span>
                </div>
              </>
            )}

            <div className="row wiz-nav">
              {step > 0 && <button type="button" className="btn" onClick={() => setStep(step - 1)}>← {t("common.back")}</button>}
              <span className="spacer" />
              <button type="submit" className="btn primary" disabled={!valid[step] || busy}>
                {step < STEPS.length - 1 ? `${t("common.next")} →` : busy ? t("common.loading") : `✓ ${t("create.submit")}`}
              </button>
            </div>
          </form>

          <aside className="wiz-preview" aria-label={t("create.preview")}>
            <div className="small muted" style={{ marginBottom: 8 }}>👀 {t("create.preview")}</div>
            <ThemePreview theme={theme} name={name} />
            <p className="tiny muted" style={{ marginTop: 10 }}>{t("create.previewHelp")}</p>
          </aside>
        </div>
      </main>
    </div>
  );
}
