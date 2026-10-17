import { useState } from "react";
import { useT } from "../i18n/index.jsx";

const MARK = { High: "●", Medium: "◐", Low: "○" };

export function ConfidenceTag({ eta }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  if (!eta || !eta.confidence) return null;
  return (
    <span style={{ position: "relative" }}>
      <button type="button" className={`conf conf-${eta.confidence}`} onClick={() => setOpen((o) => !o)}
        aria-expanded={open} title={eta.reason || ""}>
        <span aria-hidden="true">{MARK[eta.confidence]}</span>
        {t("eta.confidence", { level: t(`eta.${eta.confidence}`) })}
      </button>
      {open && eta.reason && <span className="tiny muted" style={{ display: "block", marginTop: 4 }}>{eta.reason}</span>}
    </span>
  );
}

/** ETA with confidence tag. `size` big for the ticket page, small for cards. */
export default function EtaRange({ eta, size = "big", showWhy = false, text }) {
  const { t } = useT();
  if (!eta) return <span className="muted">{t("eta.none")}</span>;
  return (
    <div>
      <div className="row" style={{ alignItems: "baseline" }}>
        <span className={size === "big" ? "eta-num" : ""} style={size === "big" ? undefined : { fontSize: 22, fontWeight: 800 }}
          aria-live="polite">{text || eta.text}</span>
        <ConfidenceTag eta={eta} />
      </div>
      {eta.rise_reason && <div className="info-line" style={{ marginTop: 8 }}>{t("ticket.rose")}: {eta.rise_reason}</div>}
      {showWhy && (
        <details style={{ marginTop: 8 }}>
          <summary className="small" style={{ cursor: "pointer", fontWeight: 700 }}>{t("eta.why")}</summary>
          <p className="small muted" style={{ margin: "6px 0 0" }}>{eta.reason}. {t("eta.method")}</p>
        </details>
      )}
    </div>
  );
}
