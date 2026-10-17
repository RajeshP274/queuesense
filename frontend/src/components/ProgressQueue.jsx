import { useRef } from "react";
import { useT } from "../i18n/index.jsx";

/** Position + progress bar. Progress is relative to the largest "ahead" seen for this ticket. */
export default function ProgressQueue({ ahead, position }) {
  const { t } = useT();
  const max = useRef(null);
  if (ahead == null) return null;
  if (max.current == null || ahead > max.current) max.current = Math.max(ahead, 1);
  const done = Math.round(100 * (1 - ahead / (max.current + 1)));
  return (
    <div>
      <div className="row">
        <b>{ahead === 0 ? t("ticket.youreNext") : t("ticket.ahead", { n: ahead })}</b>
        <span className="spacer" />
        <span className="muted small tnum">{t("ticket.position", { n: position })}</span>
      </div>
      <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={done} style={{ marginTop: 8 }}>
        <div style={{ width: `${done}%` }} />
      </div>
    </div>
  );
}
