// Venue-branded building blocks: ThemeScope (applies a workplace theme), VenueBar/VenueFooter (customer website
// chrome), ThemePreview (mini customer page) and ThemeEditor (presets, colours, fonts, emoji).
import { Link } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { FONTS, loadFont, resolveTheme, themeVars } from "../lib/theme.js";
import { LanguageToggle } from "./ui.jsx";

/** Wrap a subtree in a workplace theme. `page` makes it a full-height page with the theme background. */
export function ThemeScope({ theme, page = false, className = "", style, children }) {
  return (
    <div className={`themed ${page ? "themed-page" : ""} ${className}`} style={{ ...themeVars(theme), ...style }}>
      {children}
    </div>
  );
}

/** Customer website header: the venue's own brand, never links to staff/operator pages. */
export function VenueBar({ venue, slug, right }) {
  const th = resolveTheme(venue && venue.theme);
  const s = slug || (venue && venue.slug);
  return (
    <header className="vbar">
      <div className="vbar-in">
        <Link to={s ? `/v/${s}` : "#"} className="vbrand">
          <span className="vlogo" aria-hidden="true">{th.emoji}</span>
          <span className="vname">{venue ? venue.name : " "}</span>
        </Link>
        <span className="spacer" />
        {right}
        <LanguageToggle />
      </div>
    </header>
  );
}

export function VenueFooter() {
  return (
    <footer className="vfoot">
      <span>Powered by</span> <b><span className="qs-dot" aria-hidden="true">Q</span> QueueSense</b>
      <span className="muted"> · no cameras, no sensors</span>
    </footer>
  );
}

/** A miniature of the customer website in the given theme. */
export function ThemePreview({ theme, name, compact = false }) {
  const { t } = useT();
  const th = resolveTheme(theme);
  return (
    <ThemeScope theme={th} className={`preview ${compact ? "compact" : ""}`}>
      <div className="preview-bar">
        <span className="vlogo sm" aria-hidden="true">{th.emoji}</span>
        <b className="vname">{name || t("create.namePlaceholder")}</b>
        <span className="spacer" />
        <span className="badge open">● {t("common.open")}</span>
      </div>
      <div className="preview-body">
        <div className="small muted">{t("join.rightNow")}</div>
        <div className="preview-eta">8–12 min</div>
        <div className="preview-tags">
          <span className="conf conf-High">● {t("eta.confidence", { level: t("eta.High") })}</span>
          <span className="preview-accent">{t("join.waitingFor", { n: 4 })}</span>
        </div>
        {!compact && <div className="progress" style={{ marginTop: 12 }}><div style={{ width: "62%" }} /></div>}
        <button type="button" className="btn primary block" tabIndex={-1} style={{ marginTop: 14 }}>{t("join.submit")}</button>
      </div>
    </ThemeScope>
  );
}

const EMOJIS = ["🍽️", "🍛", "☕", "🍕", "🏥", "💊", "🏛️", "🏦", "✂️", "📚", "🎟️", "✨"];

/** Theme picker used by the create wizard and the operator "Look & feel" page. */
export function ThemeEditor({ value, onChange, presets, fonts }) {
  const { t } = useT();
  const th = resolveTheme(value);
  const set = (patch) => onChange({ ...value, ...patch });
  const fontList = (fonts && fonts.length ? fonts.map((f) => f.id) : Object.keys(FONTS)).filter((id) => FONTS[id]);
  fontList.forEach(loadFont);
  return (
    <div className="stack">
      <div>
        <span className="label">{t("theme.preset")}</span>
        <div className="swatches" role="radiogroup" aria-label={t("theme.preset")}>
          {presets.map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={th.preset === p.id && !value.primary}
              className={`swatch ${th.preset === p.id && !value.primary ? "on" : ""}`}
              onClick={() => onChange({ preset: p.id })}>
              <span className="sw-colors" aria-hidden="true">
                <span style={{ background: p.primary }} /><span style={{ background: p.accent }} /><span style={{ background: p.bg }} />
              </span>
              <span className="sw-name">{p.emoji} {p.name}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid g2">
        <label className="colorpick">
          <span className="label">{t("theme.primary")}</span>
          <span className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
            <input type="color" value={th.primary} onChange={(e) => set({ primary: e.target.value })} aria-label={t("theme.primary")} />
            <code className="small">{th.primary.toUpperCase()}</code>
          </span>
        </label>
        <label className="colorpick">
          <span className="label">{t("theme.accent")}</span>
          <span className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
            <input type="color" value={th.accent} onChange={(e) => set({ accent: e.target.value })} aria-label={t("theme.accent")} />
            <code className="small">{th.accent.toUpperCase()}</code>
          </span>
        </label>
      </div>

      <div>
        <span className="label">{t("theme.font")}</span>
        <div className="fontpick" role="radiogroup" aria-label={t("theme.font")}>
          {fontList.map((id) => (
            <button key={id} type="button" role="radio" aria-checked={th.font === id} className={`fontopt ${th.font === id ? "on" : ""}`}
              onClick={() => set({ font: id })}>
              <span className="fo-aa" style={{ fontFamily: FONTS[id].headStack }}>Aa</span>
              <span className="fo-name" style={{ fontFamily: FONTS[id].bodyStack }}>{FONTS[id].name}</span>
              <span className="tiny muted">{FONTS[id].heading}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <span className="label">{t("theme.emoji")}</span>
        <div className="emojis" role="radiogroup" aria-label={t("theme.emoji")}>
          {EMOJIS.map((e) => (
            <button key={e} type="button" role="radio" aria-checked={th.emoji === e} className={th.emoji === e ? "on" : ""}
              onClick={() => set({ emoji: e })}>{e}</button>
          ))}
        </div>
      </div>
    </div>
  );
}
