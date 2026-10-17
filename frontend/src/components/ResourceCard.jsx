import { useT } from "../i18n/index.jsx";
import { fmtClock, secondsSince, secondsUntil } from "../lib/format.js";
import { BigButton } from "./ui.jsx";

const STATE_ICON = { OPEN: "●", BUSY: "◉", HELD: "⏳", PAUSED: "⏸", CLOSED: "✕" };

/**
 * One counter / table / room on the staff console.
 * onAction(kind, target): kind in next|arrived|served|noshow|skip|left|pause|resume
 */
export default function ResourceCard({ r, index, selected, onSelect, onAction, now }) {
  const { t } = useT();
  const tk = r.ticket;
  const isTable = r.kind === "table";
  const paused = r.status === "PAUSED" || r.status === "CLOSED";
  const since = tk ? (tk.service_start_at || tk.called_at) : r.status_changed_at;
  const elapsed = secondsSince(since, now);
  const callLeft = r.held_until && tk && tk.status === "CALLED" ? secondsUntil(r.held_until, now) : null;

  return (
    <section className={`card rcard st-${r.status} ${selected ? "sel" : ""}`} onClick={onSelect} aria-label={r.label}>
      <div className="row">
        {index < 9 && <kbd className="tiny muted" aria-hidden="true">{index + 1}</kbd>}
        <b style={{ fontSize: 18 }}>{r.label}</b>
        {isTable && <span className="muted small">{t("staff.capacity", { n: r.capacity })}</span>}
        <span className="spacer" />
        <span className="badge"><span aria-hidden="true">{STATE_ICON[r.status]}</span> {r.status}</span>
      </div>

      <div className="row" style={{ alignItems: "baseline" }}>
        <span className="who">{tk ? tk.code : "—"}</span>
        {tk && tk.party_size > 1 && <span className="muted small">× {tk.party_size}</span>}
        {tk && tk.priority_class !== "NORMAL" && <span className="badge closed">★ {tk.priority_class}</span>}
        {tk && tk.display_name && <span className="small muted">{tk.display_name}</span>}
        <span className="spacer" />
        <span className="tnum muted" title="Timer">{tk || r.status !== "OPEN" ? fmtClock(elapsed) : ""}</span>
      </div>
      {tk && <div className="small muted">{t(`status.${tk.status}`)}{callLeft != null && callLeft > 0 ? ` · ${fmtClock(callLeft)}` : ""}</div>}
      {r.held_for_code && !tk && <div className="info-line">{t("staff.heldFor", { code: r.held_for_code })}</div>}
      {r.dwell_alert && <div className="alert-line" role="alert">⚠ {t("staff.stillOccupied")}</div>}
      {r.pending_release && <div className="info-line">↩ {t("staff.leavingPending")}</div>}

      {/* Primary actions: one tap per customer */}
      {isTable ? (
        tk && tk.status === "CALLED" ? (
          <BigButton variant="success" huge onClick={(e) => { e.stopPropagation(); onAction("arrived", tk.id); }}>✓ {t("staff.seated")}</BigButton>
        ) : tk ? (
          <BigButton variant="success" huge onClick={(e) => { e.stopPropagation(); onAction("left", r.id); }}>✓ {t("staff.left")}</BigButton>
        ) : (
          <BigButton variant="primary" huge disabled={paused} onClick={(e) => { e.stopPropagation(); onAction("next", r.id); }}>{t("staff.next")} →</BigButton>
        )
      ) : (
        <div className="grid" style={{ gridTemplateColumns: tk ? "1fr 1fr" : "1fr" }}>
          {tk && tk.status === "CALLED" && (
            <BigButton variant="success" onClick={(e) => { e.stopPropagation(); onAction("arrived", tk.id); }}>✓ {t("staff.arrived")}</BigButton>
          )}
          {tk && tk.status === "IN_SERVICE" && (
            <BigButton variant="success" onClick={(e) => { e.stopPropagation(); onAction("served", tk.id); }}>✓ {t("staff.served")}</BigButton>
          )}
          <BigButton variant="primary" huge={!tk} disabled={paused} onClick={(e) => { e.stopPropagation(); onAction("next", r.id); }}>{t("staff.next")} →</BigButton>
        </div>
      )}

      <div className="row">
        <button className="btn warning" style={{ flex: 1, minHeight: 56 }} disabled={!tk}
          onClick={(e) => { e.stopPropagation(); onAction("noshow", tk.id); }}>{t("staff.noShow")}</button>
        <button className="btn" style={{ flex: 1, minHeight: 56 }} disabled={!tk || tk.status !== "CALLED"}
          onClick={(e) => { e.stopPropagation(); onAction("skip", tk.id); }}>{t("staff.skip")}</button>
        <button className="btn" style={{ flex: 1, minHeight: 56 }}
          onClick={(e) => { e.stopPropagation(); onAction(paused ? "resume" : "pause", r.id); }}>{paused ? `▶ ${t("staff.resume")}` : `⏸ ${t("staff.pause")}`}</button>
      </div>
    </section>
  );
}
