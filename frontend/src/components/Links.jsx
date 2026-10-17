// "Your two websites": customer site + operator site links, PINs, QR and share. Used on /created/:slug and in
// the operator portal's "Your links" section.
import { useState } from "react";
import { useT } from "../i18n/index.jsx";
import { resolveTheme } from "../lib/theme.js";
import { ThemePreview } from "./Themed.jsx";
import { toast } from "./ui.jsx";

export function linksFor(slug, base) {
  // window.__QS_BASE__ is the network address (set in main.jsx when the page was opened as "localhost",
  // which phones can't reach).
  const b = (base || window.__QS_BASE__ || window.location.origin).replace(/\/$/, "");
  return { customer: `${b}/v/${slug}`, operator: `${b}/op/${slug}`, staff: `${b}/staff/${slug}`, board: `${b}/board/${slug}`, booking: `${b}/b/${slug}` };
}

function copy(text, t) {
  const done = () => toast(t("links.copied"));
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, () => fallback(text, done));
  else fallback(text, done);
}
function fallback(text, done) {
  const ta = document.createElement("textarea");
  ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.select();
  try { document.execCommand("copy"); done(); } catch { /* ignore */ }
  ta.remove();
}

function UrlBox({ url, t, dark }) {
  return (
    <div className={`urlbox ${dark ? "dark" : ""}`}>
      <code title={url}>{url}</code>
      <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
        <button type="button" className="btn sm" onClick={() => copy(url, t)}>⧉ {t("links.copy")}</button>
        <a className="btn sm primary" href={url} target="_blank" rel="noopener">{t("links.open")} ↗</a>
      </div>
    </div>
  );
}

function Pin({ label, value, t }) {
  const [show, setShow] = useState(false);
  return (
    <div className="pinrow">
      <span>{label}</span>
      <code className="tnum">{value ? (show ? value : "•".repeat(String(value).length)) : "—"}</code>
      {value && <button type="button" className="btn sm ghost" onClick={() => setShow((s) => !s)} aria-pressed={show}>{show ? t("links.hide") : t("links.show")}</button>}
    </div>
  );
}

export function LinksPanels({ venue, slug, links, staffPin, adminPin }) {
  const { t } = useT();
  const L = links || linksFor(slug);
  const th = resolveTheme(venue && venue.theme);
  const name = venue ? venue.name : slug;
  const wa = `https://wa.me/?text=${encodeURIComponent(t("links.shareText", { name, url: L.customer }))}`;
  return (
    <div className="sites">
      <section className="site site-customer" style={{ "--site": th.primary }}>
        <div className="site-head">
          <span className="site-ico" aria-hidden="true">👥</span>
          <div>
            <div className="site-kicker">{t("links.site1")}</div>
            <h2 style={{ margin: 0 }}>{t("links.customerTitle")}</h2>
          </div>
        </div>
        <p className="muted small" style={{ margin: 0 }}>{t("links.customerText")}</p>
        <UrlBox url={L.customer} t={t} />
        <div className="site-split">
          <ThemePreview theme={th} name={name} compact />
          <figure className="qrbox">
            <img src={`/api/venues/${slug}/qr.svg`} alt={t("poster.scan")} width="150" height="150" />
            <figcaption className="tiny muted">{t("poster.scan")}</figcaption>
          </figure>
        </div>
        <div className="row">
          <a className="btn sm" href={wa} target="_blank" rel="noopener">💬 {t("ticket.share")}</a>
          <a className="btn sm" href={L.booking} target="_blank" rel="noopener">📅 {t("links.bookingPage")}</a>
        </div>
      </section>

      <section className="site site-operator">
        <div className="site-head">
          <span className="site-ico" aria-hidden="true">🧑‍💼</span>
          <div>
            <div className="site-kicker">{t("links.site2")}</div>
            <h2 style={{ margin: 0 }}>{t("links.operatorTitle")}</h2>
          </div>
        </div>
        <p className="small" style={{ margin: 0, opacity: .8 }}>{t("links.operatorText")}</p>
        <UrlBox url={L.operator} t={t} dark />
        <div className="pins">
          <Pin label={t("links.adminPin")} value={adminPin} t={t} />
          <Pin label={t("links.staffPin")} value={staffPin} t={t} />
          {!adminPin && <p className="tiny" style={{ margin: 0, opacity: .7 }}>{t("links.pinsHidden")}</p>}
        </div>
        <div className="oplinks">
          <a href={L.staff} target="_blank" rel="noopener"><span aria-hidden="true">🎛️</span><b>{t("links.staffConsole")}</b><span className="tiny">{t("links.staffConsoleText")}</span></a>
          <a href={L.board} target="_blank" rel="noopener"><span aria-hidden="true">📺</span><b>{t("links.board")}</b><span className="tiny">{t("links.boardText")}</span></a>
        </div>
      </section>
    </div>
  );
}
