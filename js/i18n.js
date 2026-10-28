// Translations: English (default), Farsi, German.
// The engine never builds finished sentences: it produces M(key, params) objects
// and the UI turns them into text with tr(lang, msg), so a language switch also
// re-translates the move log.
import { COLOR_NAMES, STR } from "./strings.js";

export const LANGS = ["en", "fa", "de"];
export const LANG_NAMES = { en: "English", fa: "فارسی", de: "Deutsch" };
export const RTL = new Set(["fa"]);
export { COLOR_NAMES };

export function M(key, params = {}) {
  return { key, params };
}

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC_SCRIPT = /[؀-ۿ]/;

// Farsi text gets Persian digits (only when the text is in Arabic script).
export function shape(s) {
  s = String(s);
  return ARABIC_SCRIPT.test(s) ? s.replace(/[0-9]/g, d => PERSIAN_DIGITS[d]) : s;
}

// A bare number in the reading language (Persian digits for Farsi).
export function num(lang, n) {
  return lang === "fa" ? String(n).replace(/[0-9]/g, d => PERSIAN_DIGITS[d]) : String(n);
}

function fmt(tmpl, params) {
  return tmpl.replace(/\{(\w+)\}/g, (_, k) => (k in params ? params[k] : `{${k}}`));
}

// Turn a message (or string, number, list of them) into text in `lang`.
export function tr(lang, x) {
  if (x === null || x === undefined) return "";
  if (typeof x === "string") return x;
  if (typeof x === "number") return String(x);
  if (Array.isArray(x)) return x.map(y => tr(lang, y)).join(STR[lang].join);
  if (x.key === "color") return COLOR_NAMES[lang][x.params.i];
  const table = STR[lang] || STR.en;
  const tmpl = table[x.key] || STR.en[x.key] || x.key;
  const params = {};
  for (const [k, v] of Object.entries(x.params)) params[k] = tr(lang, v);
  return fmt(tmpl, params);
}

// Shortcut for UI texts: t(lang, "key", {params}) -> shaped text.
export function t(lang, key, params = {}) {
  return shape(tr(lang, M(key, params)));
}
