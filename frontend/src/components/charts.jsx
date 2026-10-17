// Tiny hand-written SVG charts (no chart library). Hover tooltips via <title>.
import { fmtDur, fmtTime } from "../lib/format.js";

export const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#6250d6", "#e87ba4"];
const W = 600;

function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  return Math.ceil(v / p) * p;
}

function Legend({ items }) {
  if (!items || items.length < 2) return null;
  return (
    <div className="row tiny" style={{ marginTop: 6 }}>
      {items.map((it, i) => (
        <span key={it.name} className="row" style={{ gap: 4 }}>
          <span style={{ width: 12, height: 3, background: it.color || SERIES[i % SERIES.length], display: "inline-block", borderRadius: 2 }} />
          {it.name}
        </span>
      ))}
    </div>
  );
}

/** series: [{name, color?, points: [{t: iso, v: number}]}]; fmtY formats values */
export function LineChart({ series, height = 200, fmtY = (v) => v, tz }) {
  const pts = series.flatMap((s) => s.points || []);
  if (!pts.length) return <p className="muted small">No data yet.</p>;
  const ts = pts.map((p) => new Date(p.t).getTime());
  const t0 = Math.min(...ts), t1 = Math.max(...ts) || t0 + 1;
  const ymax = niceMax(Math.max(...pts.map((p) => p.v || 0)));
  const L = 44, R = 10, T = 10, B = 24, H = height;
  const x = (t) => L + ((new Date(t).getTime() - t0) / Math.max(1, t1 - t0)) * (W - L - R);
  const y = (v) => T + (1 - v / ymax) * (H - T - B);
  const ticks = [0, ymax / 2, ymax];
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={series.map((s) => s.name).join(", ")}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth="1" />
            <text x={L - 6} y={y(v) + 4} textAnchor="end">{fmtY(v)}</text>
          </g>
        ))}
        <text x={L} y={H - 6}>{fmtTime(new Date(t0).toISOString(), tz)}</text>
        <text x={W - R} y={H - 6} textAnchor="end">{fmtTime(new Date(t1).toISOString(), tz)}</text>
        {series.map((s, i) => {
          const c = s.color || SERIES[i % SERIES.length];
          const d = (s.points || []).map((p, j) => `${j ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v || 0).toFixed(1)}`).join(" ");
          return (
            <g key={s.name}>
              <path d={d} fill="none" stroke={c} strokeWidth="2" strokeLinejoin="round" />
              {(s.points || []).map((p, j) => (
                <circle key={j} cx={x(p.t)} cy={y(p.v || 0)} r="6" fill="transparent">
                  <title>{`${s.name} · ${fmtTime(p.t, tz)}: ${fmtY(p.v)}`}</title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>
      <Legend items={series.map((s, i) => ({ name: s.name, color: s.color || SERIES[i % SERIES.length] }))} />
    </div>
  );
}

/** items: [{label, v}] horizontal or vertical bars */
export function Bars({ items, height = 180, fmtV = (v) => v, max }) {
  if (!items || !items.length) return <p className="muted small">No data yet.</p>;
  const m = max || niceMax(Math.max(...items.map((i) => i.v || 0)));
  const L = 8, B = 22, T = 8, H = height;
  const bw = (W - L * 2) / items.length;
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Bar chart">
        <line x1={L} x2={W - L} y1={H - B} y2={H - B} stroke="var(--border)" />
        {items.map((it, i) => {
          const h = ((it.v || 0) / m) * (H - B - T);
          return (
            <g key={it.label}>
              <rect x={L + i * bw + 2} y={H - B - h} width={Math.max(2, bw - 4)} height={h} rx="3" fill={SERIES[0]}>
                <title>{`${it.label}: ${fmtV(it.v)}`}</title>
              </rect>
              {items.length <= 14 && <text x={L + i * bw + bw / 2} y={H - 6} textAnchor="middle">{it.label}</text>}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Horizontal bars for utilisation (0-1) */
export function HBars({ items }) {
  if (!items || !items.length) return <p className="muted small">No data yet.</p>;
  return (
    <div className="stack" style={{ gap: 6 }}>
      {items.map((it) => (
        <div key={it.label} className="row" style={{ flexWrap: "nowrap" }}>
          <span className="small" style={{ width: 110, flex: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.label}</span>
          <div className="progress" style={{ flex: 1 }}><div style={{ width: `${Math.round((it.v || 0) * 100)}%`, background: SERIES[0] }} /></div>
          <span className="small tnum" style={{ width: 44, textAlign: "right" }}>{Math.round((it.v || 0) * 100)}%</span>
        </div>
      ))}
    </div>
  );
}

/** points: [{p, a}] seconds; y = x reference line */
export function Scatter({ points, height = 240 }) {
  if (!points || !points.length) return <p className="muted small">No completed tickets yet.</p>;
  const m = niceMax(Math.max(...points.flatMap((q) => [q.p || 0, q.a || 0])));
  const L = 44, B = 28, T = 10, R = 10, H = height;
  const x = (v) => L + (v / m) * (W - L - R);
  const y = (v) => T + (1 - v / m) * (H - T - B);
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Predicted versus actual wait">
        <line x1={x(0)} y1={y(0)} x2={x(m)} y2={y(m)} stroke="var(--muted)" strokeDasharray="5 4" />
        <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} stroke="var(--border)" />
        <text x={L - 6} y={y(m) + 4} textAnchor="end">{fmtDur(m)}</text>
        <text x={W - R} y={H - 8} textAnchor="end">predicted → {fmtDur(m)}</text>
        <text x={L} y={H - 8}>0</text>
        {points.map((q, i) => (
          <circle key={i} cx={x(q.p)} cy={y(q.a)} r="4" fill={SERIES[0]} fillOpacity=".75" stroke="var(--surface)" strokeWidth="1">
            <title>{`predicted ${fmtDur(q.p)} · actual ${fmtDur(q.a)}`}</title>
          </circle>
        ))}
      </svg>
      <div className="tiny muted">Dots on the dashed line = perfect prediction. Above = waited longer than predicted.</div>
    </div>
  );
}

const SEQ = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"];
/** heat: {days: [], hours: [], values: [[seconds|null]]} */
export function Heatmap({ heat }) {
  if (!heat || !heat.values || !heat.values.some((r) => r.some((v) => v != null))) return <p className="muted small">Not enough history yet.</p>;
  const all = heat.values.flat().filter((v) => v != null);
  const max = Math.max(1, ...all);
  return (
    <div className="scroll-x">
      <table style={{ borderCollapse: "separate", borderSpacing: 2, width: "auto" }}>
        <thead><tr><th />{heat.hours.map((h) => <th key={h} className="tiny" style={{ padding: 2, textAlign: "center" }}>{h}</th>)}</tr></thead>
        <tbody>
          {heat.values.map((row, d) => (
            <tr key={heat.days[d]}>
              <th className="tiny" style={{ padding: "2px 6px" }}>{heat.days[d]}</th>
              {row.map((v, h) => {
                const i = v == null ? -1 : Math.min(6, Math.floor((v / max) * 7));
                return (
                  <td key={h} title={v == null ? "no data" : fmtDur(v)}
                    style={{ width: 26, height: 24, padding: 0, borderRadius: 4, border: 0, background: i < 0 ? "var(--surface-2)" : SEQ[i] }} />
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row tiny muted" style={{ marginTop: 4 }}>
        <span>0</span>{SEQ.map((c) => <span key={c} style={{ width: 16, height: 8, background: c, display: "inline-block" }} />)}<span>{fmtDur(max)}</span>
      </div>
    </div>
  );
}
