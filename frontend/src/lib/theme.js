// Workplace themes: fonts (Google Fonts on demand, with system fallbacks so it still looks right offline),
// colour maths (tints, WCAG contrast) and the CSS custom properties applied to venue-branded pages.
import { useEffect, useState } from "react";
import { api } from "./api.js";

const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Noto Sans Devanagari", "Noto Sans Gujarati", sans-serif';
const SERIF = 'Georgia, Cambria, "Times New Roman", "Noto Serif", serif';

export const FONTS = {
  modern: { name: "Modern", heading: "Inter", body: "Inter", headStack: `"Inter", ${SANS}`, bodyStack: `"Inter", ${SANS}`,
    gf: "family=Inter:wght@400;600;700;800" },
  friendly: { name: "Friendly", heading: "Nunito", body: "Nunito", headStack: `"Nunito", "Segoe UI Rounded", ${SANS}`, bodyStack: `"Nunito", ${SANS}`,
    gf: "family=Nunito:wght@400;600;700;800;900" },
  elegant: { name: "Elegant", heading: "Playfair Display", body: "Lato", headStack: `"Playfair Display", ${SERIF}`, bodyStack: `"Lato", ${SANS}`,
    gf: "family=Playfair+Display:wght@600;700;800&family=Lato:wght@400;700;900" },
  clean: { name: "Clean", heading: "DM Sans", body: "DM Sans", headStack: `"DM Sans", ${SANS}`, bodyStack: `"DM Sans", ${SANS}`,
    gf: "family=DM+Sans:wght@400;500;700;800" },
  classic: { name: "Classic", heading: "Merriweather", body: "Merriweather", headStack: `"Merriweather", ${SERIF}`, bodyStack: `"Merriweather", ${SERIF}`,
    gf: "family=Merriweather:wght@400;700;900" },
};

// Fallback presets (mirror backend config.THEMES) so pages theme correctly before /api/themes answers.
export const PRESETS = [
  { id: "restaurant", name: "Restaurant", primary: "#B9472A", accent: "#E9A23B", bg: "#FBF7F2", font: "elegant", emoji: "🍽️", description: "Warm terracotta with elegant serif headings" },
  { id: "canteen", name: "Canteen", primary: "#C2410C", accent: "#2F9E44", bg: "#FFF8F1", font: "friendly", emoji: "🍛", description: "Bright, friendly orange" },
  { id: "hospital", name: "Hospital", primary: "#0B7A70", accent: "#2F80ED", bg: "#F3FAF9", font: "clean", emoji: "🏥", description: "Calm teal, easy to read under stress" },
  { id: "admin_office", name: "Office", primary: "#1F5FD6", accent: "#7A5AF8", bg: "#F5F7FB", font: "modern", emoji: "🏛️", description: "Trustworthy blue, clean and formal" },
  { id: "custom", name: "Violet", primary: "#6D48E5", accent: "#EC4899", bg: "#F8F7FD", font: "modern", emoji: "✨", description: "Modern violet" },
  { id: "forest", name: "Forest", primary: "#2F6B3A", accent: "#C9A227", bg: "#F5F8F3", font: "classic", emoji: "🌿", description: "Natural greens, classic serif" },
  { id: "midnight", name: "Midnight", primary: "#1E2A4A", accent: "#F2B705", bg: "#F4F5F8", font: "clean", emoji: "🌙", description: "Deep navy with a gold accent" },
];
export const DEFAULT_THEME = PRESETS[3];

const loaded = new Set();
/** Inject the Google Fonts stylesheet for a font id once. Offline it simply fails and the fallback stack is used. */
export function loadFont(id) {
  const f = FONTS[id];
  if (!f || loaded.has(id) || typeof document === "undefined") return;
  loaded.add(id);
  const l = document.createElement("link");
  l.rel = "stylesheet";
  l.href = `https://fonts.googleapis.com/css2?${f.gf}&display=swap`;
  document.head.appendChild(l);
}

// ---------------------------------------------------------------- colour maths
const clamp = (x) => Math.max(0, Math.min(255, Math.round(x)));
export function hexToRgb(hex) {
  const h = String(hex || "").replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(h)) return [31, 111, 235];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
export const rgbToHex = (r) => "#" + r.map((x) => clamp(x).toString(16).padStart(2, "0")).join("");
/** Mix colour a towards b by amount t (0 = a, 1 = b). */
export function mix(a, b, t) {
  const x = hexToRgb(a), y = hexToRgb(b);
  return rgbToHex(x.map((v, i) => v + (y[i] - v) * t));
}
export function luminance(hex) {
  return hexToRgb(hex).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; })
    .reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
}
export function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (l1 + 0.05) / (l2 + 0.05);
}
/** White or near-black text on a coloured background, whichever reads better (WCAG). */
export const onColor = (bg) => (contrast(bg, "#FFFFFF") >= contrast(bg, "#101828") ? "#FFFFFF" : "#101828");
/** Darken (or lighten) until the colour reaches `target` contrast against `against`. */
export function readable(hex, against, target = 4.5) {
  let c = hex;
  const towards = luminance(against) > 0.5 ? "#000000" : "#FFFFFF";
  for (let i = 0; i < 20 && contrast(c, against) < target; i++) c = mix(c, towards, 0.08);
  return c;
}

/** Fill in any missing fields from the matching preset. */
export function resolveTheme(theme) {
  const t = theme || {};
  const base = PRESETS.find((p) => p.id === t.preset) || DEFAULT_THEME;
  return { ...base, ...Object.fromEntries(Object.entries(t).filter(([, v]) => v)), preset: t.preset || base.id };
}

/** CSS custom properties for a venue theme (light + dark variants; styles.css picks per colour scheme). */
export function themeVars(theme) {
  const t = resolveTheme(theme);
  loadFont(t.font);
  const f = FONTS[t.font] || FONTS.modern;
  const p = t.primary;
  return {
    "--primary": p,
    "--on-primary": onColor(p),
    "--accent": t.accent,
    "--on-accent": onColor(t.accent),
    "--theme-bg": t.bg,
    "--psl": mix(p, "#FFFFFF", 0.88),
    "--psd": mix(p, "#0E1116", 0.72),
    "--ptl": readable(p, "#FFFFFF"),
    "--ptd": readable(mix(p, "#FFFFFF", 0.35), "#171B22"),
    "--pring": `${p}66`,
    "--font": f.bodyStack,
    "--font-heading": f.headStack,
  };
}

// ---------------------------------------------------------------- data hooks
let themesCache = null;
/** GET /api/themes (presets + fonts), falling back to the built-in list. */
export function useThemes() {
  const [data, setData] = useState(themesCache || { presets: PRESETS, fonts: Object.entries(FONTS).map(([id, f]) => ({ id, name: f.name, heading: f.heading, body: f.body })) });
  useEffect(() => {
    if (themesCache) return;
    api("/api/themes").then((d) => {
      if (d && d.presets && d.presets.length) { themesCache = d; setData(d); }
    }).catch(() => {});
  }, []);
  return data;
}

const venueCache = new Map();
/** Fetch a venue once per page load (for its theme). */
export function useVenue(slug) {
  const [venue, setVenue] = useState(() => (slug ? venueCache.get(slug) || null : null));
  const [error, setError] = useState(null);
  const load = () => {
    if (!slug) return Promise.resolve();
    return api(`/api/venues/${slug}`).then((v) => { venueCache.set(slug, v); setVenue(v); setError(null); }).catch(setError);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [slug]);
  return { venue, error, reload: load };
}
