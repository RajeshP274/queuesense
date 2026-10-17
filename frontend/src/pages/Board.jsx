import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useVenueStream } from "../lib/sse.js";
import { FONTS, readable, resolveTheme, useVenue } from "../lib/theme.js";

/** Public display board: ticket codes and counters only. No names, no phone numbers. */
export default function Board() {
  const { slug } = useParams();
  const { t } = useT();
  const live = useVenueStream(slug, { want: ["board"] });
  const b = live.board;
  const { venue } = useVenue(slug);
  const th = resolveTheme(venue && venue.theme);
  // The board is always dark: lift the venue colour until it reads well on near-black.
  const boardVars = { "--board-accent": readable(th.primary, "#10141B", 4.5), "--board-glow": `${th.primary}55`,
    fontFamily: (FONTS[th.font] || FONTS.modern).bodyStack };
  const [clock, setClock] = useState("");
  const [qrOn, setQrOn] = useState(true);
  const seen = useRef(new Set());

  useEffect(() => {
    document.body.classList.add("board-page");
    const tick = () => setClock(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
    tick();
    const a = setInterval(tick, 1000);
    const q = setInterval(() => setQrOn((v) => !v), 15000); // rotate QR panel with service waits
    return () => { clearInterval(a); clearInterval(q); document.body.classList.remove("board-page"); };
  }, []);
  useEffect(() => { if (b) document.title = `${t("status.CALLED")} · ${b.venue_name}`; }, [b, t]);

  const fresh = b ? b.now_serving.map((s) => s.code) : [];
  const isNew = (code) => seen.current.size > 0 && !seen.current.has(code);
  useEffect(() => { seen.current = new Set(fresh); }); // eslint-disable-line react-hooks/exhaustive-deps

  if (!b) {
    return <div className="board"><div className="col" style={{ gridColumn: "1 / -1", justifyContent: "center", alignItems: "center", fontSize: 32 }}>
      {live.error ? (live.error.message || "Unavailable") : t("common.loading")}</div></div>;
  }

  return (
    <div className="board" aria-live="polite" style={boardVars}>
      <section className="col">
        <h2>Now serving</h2>
        <div className="serving">
          {b.now_serving.length ? b.now_serving.map((s) => (
            <div key={s.code} style={{ display: "contents" }}>
              <div className="c" style={isNew(s.code) ? { color: "var(--board-accent)" } : undefined}>{s.code}</div>
              <div className="r">{s.resource_label}</div>
            </div>
          )) : <div className="c" style={{ color: "#667085" }}>—</div>}
        </div>
      </section>
      <section className="col">
        <h2>Next up</h2>
        <div className="next">
          {b.next_up.length ? b.next_up.slice(0, 6).map((c) => <div key={c}>{c}</div>)
            : <div style={{ gridColumn: "span 2", fontSize: "clamp(16px,2vw,32px)", color: "#98A2B3", background: "none", border: 0 }}>No queue · walk right in</div>}
        </div>
      </section>
      <section className="col">
        <div style={{ fontSize: "clamp(18px,2vw,34px)", fontWeight: 800, fontFamily: (FONTS[th.font] || FONTS.modern).headStack }}>
          <span aria-hidden="true">{th.emoji} </span>{b.venue_name}</div>
        <div className="tnum" style={{ color: "#98A2B3", fontSize: "clamp(14px,1.4vw,24px)" }}>{clock}</div>
        <h2 style={{ marginTop: "1.4vw" }}>Typical wait</h2>
        <div className="waits">
          {b.services.map((s) => <div key={s.name}><span>{s.name}</span><b className="tnum">{s.eta_text || "—"}</b></div>)}
        </div>
        <div className="qr" style={{ opacity: qrOn ? 1 : 0.9 }}>
          <img src={`/api/venues/${slug}/qr.svg`} alt="Scan to join the queue" />
          <div style={{ marginTop: ".6vw", fontWeight: 700, fontSize: "clamp(14px,1.4vw,24px)" }}>{t("poster.scan")}</div>
          <div style={{ color: "#98A2B3", fontSize: "clamp(12px,1vw,18px)" }}>{b.join_url}</div>
        </div>
      </section>
    </div>
  );
}
