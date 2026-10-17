// Small shared building blocks: BigButton, BottomSheet, Toast, EmptyState, Skeleton, LanguageToggle,
// ConnectionChip, ErrorBox, Page header.
import { useEffect, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { LANGS, useT } from "../i18n/index.jsx";

/** Large (>= 64 px) one-thumb button with haptic feedback. */
export function BigButton({ children, variant = "primary", huge = false, className = "", onClick, ...rest }) {
  return (
    <button type="button" {...rest} className={`btn ${variant} bigbtn ${huge ? "huge" : ""} ${className}`}
      onClick={(e) => { if (navigator.vibrate) navigator.vibrate(25); if (onClick) onClick(e); }}>
      {children}
    </button>
  );
}

export function BottomSheet({ open, onClose, title, children }) {
  useEffect(() => {
    if (!open) return undefined;
    const k = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="sheet-bg" onClick={onClose} role="presentation">
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>{title}</h2><span className="spacer" />
          <button className="btn ghost sm" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

let toastSetter = null;
export function toast(msg) { if (toastSetter) toastSetter({ msg, id: Date.now() }); }
export function ToastHost() {
  const [m, setM] = useState(null);
  useEffect(() => { toastSetter = setM; return () => { toastSetter = null; }; }, []);
  useEffect(() => {
    if (!m) return undefined;
    const id = setTimeout(() => setM(null), 3000);
    return () => clearTimeout(id);
  }, [m]);
  return m ? <div className="toast" role="status" aria-live="polite">{m.msg}</div> : <div className="sr-only" aria-live="polite" />;
}

export function EmptyState({ icon = "🗂️", title, children }) {
  return (
    <div className="empty">
      <div className="ico" aria-hidden="true">{icon}</div>
      <p style={{ fontWeight: 700, color: "var(--text-2)", margin: "8px 0 4px" }}>{title}</p>
      {children && <div className="small">{children}</div>}
    </div>
  );
}

export function Skeleton({ h = 80, n = 1 }) {
  return <div className="stack" aria-busy="true" aria-label="Loading">{Array.from({ length: n }, (_, i) => <div key={i} className="skel" style={{ minHeight: h }} />)}</div>;
}

export function ErrorBox({ error, onRetry }) {
  const { t } = useT();
  if (!error) return null;
  const offline = error.network || !navigator.onLine;
  return (
    <div className="card stack" role="alert">
      <div className={offline ? "alert-line" : "err-line"}>{offline ? t("common.offline") : error.message || t("common.error")}</div>
      {error.hint && <div className="small muted">{error.hint}</div>}
      {onRetry && <button className="btn" onClick={onRetry}>{t("common.retry")}</button>}
    </div>
  );
}

export function LanguageToggle() {
  const { lang, setLang, t } = useT();
  return (
    <label className="row small" style={{ gap: 4 }}>
      <span className="sr-only">{t("common.language")}</span>
      <span aria-hidden="true">🌐</span>
      <select value={lang} onChange={(e) => setLang(e.target.value)} style={{ minHeight: 40, width: "auto", padding: "4px 8px" }}>
        {LANGS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
      </select>
    </label>
  );
}

export function ConnectionChip({ conn, pending = 0 }) {
  const { t } = useT();
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  const state = !online ? "offline" : conn;
  return (
    <span className="row" style={{ gap: 6 }}>
      {state === "live" && <span className="badge open">● {t("conn.live")}</span>}
      {state === "paused" && <span className="badge warn">⏸ {t("conn.paused")}</span>}
      {state === "offline" && <span className="badge closed">⚠ {t("conn.offline")}</span>}
      {pending > 0 && <span className="badge warn">⟳ {t("staff.toSync", { n: pending })}</span>}
    </span>
  );
}

/** Top bar. `nav` = array of {to, label}; customers get no staff/admin links. */
export function TopBar({ right, nav }) {
  const { t } = useT();
  return (
    <header className="topbar">
      <div className="topbar-in">
        <Link to="/" className="brand"><span className="brand-logo" aria-hidden="true">Q</span>{t("app.name")}</Link>
        {nav && (
          <nav className="nav row" aria-label="Main">
            {nav.map((n) => <NavLink key={n.to} to={n.to} end>{n.label}</NavLink>)}
          </nav>
        )}
        <span className="spacer" />
        {right}
        <LanguageToggle />
      </div>
    </header>
  );
}
