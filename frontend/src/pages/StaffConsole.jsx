import { useCallback, useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import ResourceCard from "../components/ResourceCard.jsx";
import { ThemeScope } from "../components/Themed.jsx";
import { BottomSheet, ConnectionChip, EmptyState, ErrorBox, Skeleton, TopBar, toast } from "../components/ui.jsx";
import { useName, useT } from "../i18n/index.jsx";
import { auth } from "../lib/api.js";
import { fmtClock, fmtDur, secondsUntil } from "../lib/format.js";
import { flush, onQueueChange, pendingCount, staffAction } from "../lib/offline.js";
import { useVenueStream } from "../lib/sse.js";

const PATHS = {
  next: (id) => `/api/staff/resources/${id}/next`,
  left: (id) => `/api/staff/resources/${id}/left`,
  pause: (id) => `/api/staff/resources/${id}/pause`,
  resume: (id) => `/api/staff/resources/${id}/resume`,
  arrived: (id) => `/api/staff/tickets/${id}/arrived`,
  served: (id) => `/api/staff/tickets/${id}/served`,
  noshow: (id) => `/api/staff/tickets/${id}/no-show`,
  skip: (id) => `/api/staff/tickets/${id}/skip`,
};
const REASONS = ["Emergency", "Regular customer error", "Other"];

/** Full staff page at /staff/:slug, or embedded inside the operator portal (embedded = no top bar). */
export default function StaffConsole({ embedded = false, slug: slugProp }) {
  const params = useParams();
  const slug = slugProp || params.slug;
  const { t } = useT();
  const name = useName();
  const nav = useNavigate();
  const me = auth.staff();
  const allowed = me && me.slug === slug;
  const live = useVenueStream(allowed ? slug : null, { want: ["console"], token: me && me.token });
  const c = live.console;
  const [now, setNow] = useState(Date.now());
  const [sel, setSel] = useState(0);
  const [pending, setPending] = useState(pendingCount());
  const [undoUntil, setUndoUntil] = useState(null);
  const [override, setOverride] = useState(null);
  const [ovRes, setOvRes] = useState(null);
  const [sheet, setSheet] = useState(null); // "walkin" | "emergency"
  const [form, setForm] = useState({ service_type_id: "", party_size: 1, display_name: "" });
  const [issued, setIssued] = useState(null);

  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  useEffect(() => onQueueChange(setPending), []);
  useEffect(() => { flush((e) => toast(e.message)); }, []);

  const run = useCallback(async (kind, id, body) => {
    if (navigator.vibrate) navigator.vibrate(30);
    try {
      const r = await staffAction(PATHS[kind](id), body);
      if (r.queued) toast(t("staff.queuedOffline"));
      else toast(r.called ? `→ ${r.called}` : r.message || t("staff.done"));
      setUndoUntil(Date.now() + 120000);
      live.refresh();
    } catch (e) { toast(e.message); }
  }, [live, t]);

  const undo = useCallback(async () => {
    try {
      const r = await staffAction("/api/staff/undo");
      toast(r.queued ? t("staff.queuedOffline") : r.message || t("staff.undo"));
      setUndoUntil(null);
      live.refresh();
    } catch (e) { toast(e.message); }
  }, [live, t]);

  // Keyboard shortcuts for desk staff: 1-9 select, N next, S served/left, X no-show, U undo.
  useEffect(() => {
    const onKey = (e) => {
      if (!c || ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (/^[1-9]$/.test(k) && +k <= c.resources.length) { setSel(+k - 1); return; }
      const r = c.resources[sel];
      if (k === "u") { undo(); return; }
      if (!r) return;
      if (k === "n") run("next", r.id);
      if (k === "s" && r.ticket) {
        if (r.kind === "table") run(r.ticket.status === "CALLED" ? "arrived" : "left", r.ticket.status === "CALLED" ? r.ticket.id : r.id);
        else run(r.ticket.status === "CALLED" ? "arrived" : "served", r.ticket.id);
      }
      if (k === "x" && r.ticket) run("noshow", r.ticket.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [c, sel, run, undo]);

  if (!allowed) return embedded ? null : <Navigate to="/staff" replace />;
  const venue = c && c.venue;
  const serverUndo = c && c.undo;
  const undoLeft = serverUndo ? secondsUntil(serverUndo.expires_at, now) : undoUntil ? (undoUntil - now) / 1000 : 0;

  const openSheet = (kind) => {
    const st = venue.service_types[0];
    setForm({ service_type_id: st ? st.id : "", party_size: 1, display_name: "" });
    setIssued(null);
    setSheet(kind);
  };
  const submitSheet = async (e) => {
    e.preventDefault();
    const path = sheet === "emergency" ? `/api/staff/venues/${slug}/emergency` : `/api/staff/venues/${slug}/walkins`;
    const body = sheet === "emergency" ? { service_type_id: form.service_type_id, display_name: form.display_name || undefined }
      : { service_type_id: form.service_type_id, party_size: +form.party_size, display_name: form.display_name || undefined };
    try {
      const r = await staffAction(path, body);
      if (r.queued) { toast(t("staff.queuedOffline")); setSheet(null); return; }
      setIssued(r.code);
      toast(t("staff.issued", { code: r.code }));
      live.refresh();
    } catch (err) { toast(err.message); }
  };
  const doOverride = async (reason) => {
    try {
      await staffAction(`/api/staff/assignments/${override.ticket_id}/override`, { resource_id: ovRes, reason });
      toast(`${override.code} → ${(c.resources.find((r) => r.id === ovRes) || {}).label}`);
      setOverride(null);
      live.refresh();
    } catch (e) { toast(e.message); }
  };
  const formService = venue && venue.service_types.find((s) => s.id === form.service_type_id);

  return (
    <ThemeScope theme={venue && venue.theme} page={!embedded}>
      {embedded ? (
        <div className="row" style={{ justifyContent: "flex-end" }}><ConnectionChip conn={live.conn} pending={pending} /></div>
      ) : (
        <TopBar right={
          <>
            <ConnectionChip conn={live.conn} pending={pending} />
            <button className="btn sm ghost" onClick={() => { auth.logoutStaff(); nav("/staff"); }}>{t("staff.logout")}</button>
          </>
        } />
      )}
      <main className={embedded ? "stack" : "page stack"}>
        {!c && live.error && <ErrorBox error={live.error} onRetry={live.refresh} />}
        {!c && !live.error && <Skeleton h={180} n={3} />}
        {c && (
          <>
            <section className="card row">
              <div>
                <b style={{ fontSize: 20 }}>{venue.name}</b>
                <div className="small muted">{c.staff_name || me.name}</div>
              </div>
              <span className="spacer" />
              <div className="kpi center"><div className="k">{t("staff.queue")}</div><div className="v">{c.queue_length}</div></div>
              <button className="btn" style={{ minHeight: 56 }} onClick={() => openSheet("walkin")}>{t("staff.walkin")}</button>
              {venue.template === "hospital" && <button className="btn danger" style={{ minHeight: 56 }} onClick={() => openSheet("emergency")}>{t("staff.emergency")}</button>}
            </section>

            {c.flags && c.flags.length > 0 && c.flags.map((f) => <div key={f.code + f.message} className="alert-line" role="alert">⚠ {f.code}: {f.message}</div>)}

            <div className="grid console-grid">
              <div className="grid g2" style={{ minWidth: 0 }}>
                {c.resources.length === 0 && <div className="card"><EmptyState icon="🪑" title="No counters, tables or rooms yet. Add them in Admin." /></div>}
                {c.resources.map((r, i) => (
                  <ResourceCard key={r.id} r={r} index={i} selected={i === sel} onSelect={() => setSel(i)} now={now}
                    onAction={(kind, id) => run(kind, id, kind === "pause" ? { reason: "Staff break" } : undefined)} />
                ))}
              </div>
              <aside className="card" style={{ minWidth: 0 }}>
                <h2>{t("staff.upNext")}</h2>
                {(!c.up_next || !c.up_next.length) && <EmptyState icon="☕" title={t("staff.upNextEmpty")} />}
                <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {(c.up_next || []).map((u) => (
                    <li key={u.ticket_id} style={{ borderBottom: "1px solid var(--border)" }}>
                      <button className="btn ghost block" style={{ justifyContent: "flex-start", textAlign: "left", minHeight: 56, flexDirection: "column", alignItems: "flex-start", gap: 0 }}
                        onClick={() => { setOverride(u); setOvRes(null); }}>
                        <span><b className="tnum">{u.code}</b>{u.party_size > 1 ? ` × ${u.party_size}` : ""}
                          {u.priority_class !== "NORMAL" ? ` ★ ${u.priority_class}` : ""}{u.display_name ? ` · ${u.display_name}` : ""}</span>
                        <span className="small muted" style={{ fontWeight: 500 }}>{u.reason}</span>
                      </button>
                    </li>
                  ))}
                </ol>
                <p className="tiny muted" style={{ marginBottom: 0 }}>{t("staff.shortcuts")}</p>
              </aside>
            </div>
          </>
        )}
      </main>

      {undoLeft > 0 && (
        <div className="undo-bar" role="status">
          <span className="small">{serverUndo ? serverUndo.label : t("staff.done")} · {fmtClock(undoLeft)}</span>
          <button className="btn sm primary" onClick={undo}>↶ {t("staff.undo")}</button>
        </div>
      )}

      <BottomSheet open={!!override} onClose={() => setOverride(null)} title={`${t("staff.override")}: ${override ? override.code : ""}`}>
        {override && c && (
          <div className="stack">
            <div className="tiles">
              {c.resources.filter((r) => r.status !== "PAUSED" && r.status !== "CLOSED").map((r) => (
                <button key={r.id} type="button" className={`tile ${ovRes === r.id ? "on" : ""}`} onClick={() => setOvRes(r.id)} aria-pressed={ovRes === r.id}>
                  <b>{r.label}</b><span className="tiny muted">{r.status}{r.kind === "table" ? ` · ${r.capacity}` : ""}</span>
                </button>
              ))}
            </div>
            <div className="label">{t("staff.overrideReason")}</div>
            <div className="grid g3">
              {REASONS.map((rs) => <button key={rs} className="btn" disabled={!ovRes} style={{ minHeight: 56 }} onClick={() => doOverride(rs)}>{t(`staff.reason.${rs}`)}</button>)}
            </div>
          </div>
        )}
      </BottomSheet>

      <BottomSheet open={!!sheet} onClose={() => setSheet(null)} title={sheet === "emergency" ? t("staff.emergency") : t("staff.walkin")}>
        {venue && (issued ? (
          <div className="center stack">
            <div className="code-big">{issued}</div>
            <button className="btn primary block" onClick={() => setSheet(null)}>{t("common.close")}</button>
          </div>
        ) : (
          <form onSubmit={submitSheet}>
            <div className="field">
              <label htmlFor="w-svc">{t("join.service")}</label>
              <select id="w-svc" value={form.service_type_id} onChange={(e) => setForm({ ...form, service_type_id: e.target.value })}>
                {venue.service_types.map((s) => <option key={s.id} value={s.id}>{name(s.name)}</option>)}
              </select>
            </div>
            {sheet === "walkin" && formService && formService.resource_kind === "table" && (
              <div className="field">
                <label htmlFor="w-party">{t("join.party")}</label>
                <input id="w-party" type="number" min="1" max={venue.party_max || 12} value={form.party_size} onChange={(e) => setForm({ ...form, party_size: e.target.value })} />
              </div>
            )}
            <div className="field">
              <label htmlFor="w-name">{t("join.name")}</label>
              <input id="w-name" value={form.display_name} maxLength={40} onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
            </div>
            <button className="btn primary bigbtn" type="submit">{t("staff.issue")}</button>
          </form>
        ))}
      </BottomSheet>
    </ThemeScope>
  );
}
