import { readChoice } from './prefs.js';
import { STRINGS } from './strings.js';

// Offered in settings, each under its own name.
export const LANGUAGES = { en: 'English', 'zh-CN': '简体中文', ja: '日本語', de: 'Deutsch' };
export const LANGUAGE_CHOICES = ['auto', ...Object.keys(LANGUAGES)];

const base = (tag) => tag.toLowerCase().split('-')[0];

// The first of the device's languages that has a table, else English.
// ponytail: every Chinese locale gets Simplified Chinese; add a zh-TW table and match the
// script subtag when Traditional readers ask for one.
export function matchLanguage(wanted) {
  for (const tag of wanted) {
    const hit = Object.keys(LANGUAGES).find((code) => base(code) === base(tag));
    if (hit) return hit;
  }
  return 'en';
}

let lang = 'en';
let plural = new Intl.PluralRules('en');

export const getLang = () => lang;

export function setLang(code) {
  lang = code;
  plural = new Intl.PluralRules(code);
  // Also picks the right glyphs: Chinese and Japanese share code points that are drawn differently.
  if (typeof document !== 'undefined') document.documentElement.lang = code;
}

// Apply the language chosen in settings; 'auto' follows the device.
export function useStoredLang() {
  const choice = readChoice('lang', LANGUAGE_CHOICES, 'auto');
  setLang(choice === 'auto' ? matchLanguage(navigator.languages ?? []) : choice);
}

function lookup(table, key, n) {
  return table[key] ?? table[`${key}#${plural.select(n)}`] ?? table[`${key}#other`];
}

export const hasText = (key) => lookup(STRINGS.en, key) !== undefined;

// The text for `key` with each `{name}` replaced from `params`. `params.n` also picks
// the plural form. A key missing from the current language falls back to English.
export function t(key, params = {}) {
  const text = lookup(STRINGS[lang], key, params.n) ?? lookup(STRINGS.en, key, params.n) ?? key;
  return text.replace(/\{(\w+)\}/g, (match, name) => params[name] ?? match);
}

const ATTRIBUTES = ['aria-label', 'placeholder', 'alt'];

// Fill the static markup. `data-i18n` sets an element's text and `data-i18n-<attribute>`
// sets that attribute; the element's other data attributes are the parameters.
export function applyStatic(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n, el.dataset);
  for (const attribute of ATTRIBUTES) {
    const source = `data-i18n-${attribute}`;
    for (const el of root.querySelectorAll(`[${source}]`)) el.setAttribute(attribute, t(el.getAttribute(source), el.dataset));
  }
}
