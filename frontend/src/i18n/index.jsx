import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import en from "./en.json";
import hi from "./hi.json";
import gu from "./gu.json";

const DICTS = { en, hi, gu };
export const LANGS = [
  { id: "en", label: "English" },
  { id: "hi", label: "हिन्दी" },
  { id: "gu", label: "ગુજરાતી" },
];

const I18n = createContext({ lang: "en", setLang: () => {}, t: (k) => k });

function initialLang() {
  try {
    const saved = localStorage.getItem("qs_lang");
    if (saved && DICTS[saved]) return saved;
  } catch { /* ignore */ }
  return "en";
}

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(initialLang);
  const setLang = useCallback((l) => {
    setLangState(l);
    try { localStorage.setItem("qs_lang", l); } catch { /* ignore */ }
  }, []);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  const t = useCallback((key, vars) => {
    let s = (DICTS[lang] && DICTS[lang][key]) || en[key] || key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
    return s;
  }, [lang]);
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <I18n.Provider value={value}>{children}</I18n.Provider>;
}

export function useT() {
  return useContext(I18n);
}

/** Pick a localized name from {en, hi, gu} objects (falls back to en / plain string). */
export function useName() {
  const { lang } = useT();
  return useCallback((n) => (n == null ? "" : typeof n === "string" ? n : n[lang] || n.en || Object.values(n)[0] || ""), [lang]);
}
