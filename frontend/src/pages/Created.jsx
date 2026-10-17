import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { linksFor, LinksPanels } from "../components/Links.jsx";
import { LanguageToggle, Skeleton } from "../components/ui.jsx";
import { useT } from "../i18n/index.jsx";
import { api, auth } from "../lib/api.js";

/** Success page after creating a workplace: the customer website and the operator website, side by side. */
export default function Created() {
  const { slug } = useParams();
  const { t } = useT();
  const loc = useLocation();
  const [info, setInfo] = useState(() => {
    if (loc.state) return loc.state;
    try { return JSON.parse(sessionStorage.getItem(`qs_created_${slug}`)); } catch { return null; }
  });
  const [venue, setVenue] = useState(info && info.venue);

  useEffect(() => {
    api(`/api/venues/${slug}`).then((v) => { setVenue(v); if (!info) setInfo({ venue: v, links: linksFor(slug) }); }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);
  useEffect(() => { document.title = `${t("created.title")} · QueueSense`; }, [t]);

  const links = (info && info.links) || linksFor(slug, info && info.base_url);
  return (
    <div className="brandpage">
      <div className="bp-shapes" aria-hidden="true"><span /><span /><span /></div>
      <header className="bp-top">
        <Link to="/" className="brand"><span className="brand-logo" aria-hidden="true">Q</span>{t("app.name")}</Link>
        <span className="spacer" />
        {auth.operator() && <Link to="/account" className="btn sm ghost">🏠 {t("account.myWorkplaces")}</Link>}
        <LanguageToggle />
      </header>
      <main className="bp-main">
        <section className="success">
          <div className="success-check" aria-hidden="true">✓</div>
          <p className="kicker">{venue ? venue.name : slug}</p>
          <h1 className="display sm">{t("created.title")}</h1>
          <p className="lead">{t("created.sub")}</p>
        </section>

        {!venue && !info ? <Skeleton h={260} n={1} /> : (
          <LinksPanels venue={venue} slug={slug} links={links} staffPin={info && info.staff_pin} adminPin={info && info.admin_pin} />
        )}

        <section className="card nextsteps">
          <h2>{t("created.nextTitle")}</h2>
          <ol>
            <li><b>{t("created.n1")}</b><span className="muted small">{t("created.n1t")}</span></li>
            <li><b>{t("created.n2")}</b><span className="muted small">{t("created.n2t")}</span></li>
            <li><b>{t("created.n3")}</b><span className="muted small">{t("created.n3t")}</span></li>
          </ol>
          <div className="row">
            <Link className="btn primary" to={`/op/${slug}`}>🧑‍💼 {t("created.goOp")}</Link>
            <a className="btn" href={links.customer} target="_blank" rel="noopener">👥 {t("created.goCustomer")} ↗</a>
            <Link className="btn" to={`/guide/${slug}`}>📘 {t("created.tutorial")}</Link>
            {auth.operator() && <Link className="btn ghost" to="/account">← {t("account.back")}</Link>}
          </div>
        </section>
      </main>
    </div>
  );
}
