// Internationalisation (SPEC.md §6): three flat JSON files bundled statically, ICU-style `{name}`,
// `{count, plural, =0 {…} one {…} other {…}}` and `{x, select, a {…} other {…}}`. No DOM.
import de from '../i18n/de.json';
import en from '../i18n/en.json';
import fr from '../i18n/fr.json';
import type { Language } from './bundle';

export type { Language };
export const LANGUAGES: readonly Language[] = ['en', 'fr', 'de'];
export const DEFAULT_LANGUAGE: Language = 'en';
export const LANGUAGE_STORAGE_KEY = 'dms.language';

export const MESSAGES: Record<Language, Record<string, string>> = { en, fr, de };

export type Params = Record<string, string | number>;

let current: Language = DEFAULT_LANGUAGE;

export const isLanguage = (v: unknown): v is Language => typeof v === 'string' && (LANGUAGES as readonly string[]).includes(v);

export function setLanguage(lang: Language): void {
  if (!isLanguage(lang)) throw new RangeError(`unknown language ${String(lang)}`);
  current = lang;
}
export const getLanguage = (): Language => current;

/** Maps `fr-CA`, `de_AT`, `EN` … to a supported language, or null. */
export function normaliseLanguage(tag: string | null | undefined): Language | null {
  if (!tag) return null;
  const base = String(tag).trim().toLowerCase().split(/[-_]/)[0];
  return isLanguage(base) ? base : null;
}

interface StorageLike { getItem(key: string): string | null }

/** `?lang=` → `localStorage` → `navigator.languages` → `en`. `query` is a search string or URLSearchParams. */
export function detectLanguage(query: string | URLSearchParams | null | undefined, storage: StorageLike | null | undefined,
  navigatorLanguages: readonly string[] | null | undefined): Language {
  const params = typeof query === 'string' ? new URLSearchParams(query.replace(/^[^?]*\?/, '')) : query;
  const fromQuery = normaliseLanguage(params?.get('lang'));
  if (fromQuery) return fromQuery;
  let stored: string | null = null;
  try { stored = storage?.getItem(LANGUAGE_STORAGE_KEY) ?? null; } catch { stored = null; }
  const fromStorage = normaliseLanguage(stored);
  if (fromStorage) return fromStorage;
  for (const l of navigatorLanguages ?? []) {
    const n = normaliseLanguage(l);
    if (n) return n;
  }
  return DEFAULT_LANGUAGE;
}

// ---- message formatting ----------------------------------------------------------------------------------------

/** Index of the `}` closing the `{` at `open`. */
function closing(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}' && --depth === 0) return i;
  }
  return -1;
}

/** Parses `=0 {…} one {…} other {…}` into a map. */
function options(body: string): Map<string, string> {
  const out = new Map<string, string>();
  let i = 0;
  while (i < body.length) {
    while (i < body.length && /\s/.test(body[i]!)) i++;
    const start = i;
    while (i < body.length && body[i] !== '{' && !/\s/.test(body[i]!)) i++;
    const sel = body.slice(start, i);
    while (i < body.length && /\s/.test(body[i]!)) i++;
    if (body[i] !== '{') break;
    const end = closing(body, i);
    if (end < 0) break;
    out.set(sel, body.slice(i + 1, end));
    i = end + 1;
  }
  return out;
}

function formatMessage(msg: string, params: Params, lang: Language, hash?: string): string {
  let out = '';
  let i = 0;
  while (i < msg.length) {
    const c = msg[i]!;
    if (c === '#' && hash !== undefined) { out += hash; i++; continue; }
    if (c !== '{') { out += c; i++; continue; }
    const end = closing(msg, i);
    if (end < 0) { out += msg.slice(i); break; }
    const inner = msg.slice(i + 1, end);
    const m = /^\s*([\w.]+)\s*(?:,\s*(plural|select)\s*,([\s\S]*))?$/.exec(inner);
    if (!m) { out += msg.slice(i, end + 1); i = end + 1; continue; }
    const name = m[1]!;
    const value = params[name];
    if (!m[2]) {
      out += value === undefined ? `{${name}}` : typeof value === 'number' ? formatNumber(value, lang) : value;
    } else {
      const opts = options(m[3]!);
      let chosen: string | undefined;
      if (m[2] === 'plural') {
        const n = Number(value ?? 0);
        chosen = opts.get(`=${n}`) ?? opts.get(new Intl.PluralRules(lang).select(n)) ?? opts.get('other');
        if (chosen !== undefined) out += formatMessage(chosen, params, lang, formatNumber(n, lang));
      } else {
        chosen = opts.get(String(value)) ?? opts.get('other');
        if (chosen !== undefined) out += formatMessage(chosen, params, lang, hash);
      }
    }
    i = end + 1;
  }
  return out;
}

/** Translates `key` in `lang`; a missing key falls back to English, then to the key itself. */
export function translate(lang: Language, key: string, params: Params = {}): string {
  const msg = MESSAGES[lang]?.[key] ?? MESSAGES.en[key];
  if (msg === undefined) return key;
  return formatMessage(msg, params, lang);
}

/** Translates `key` in the active language. */
export const t = (key: string, params: Params = {}): string => translate(current, key, params);

export const hasKey = (key: string): boolean => key in MESSAGES.en;

// ---- numbers, amounts, dates, durations --------------------------------------------------------------------------

const THIN = ' ';
const NBSP = ' ';

/** Number in the locale, thousands separated by a thin space (SPEC.md §6). */
export function formatNumber(n: number, lang: Language = current, maxFractionDigits = 2): string {
  return new Intl.NumberFormat(lang, { maximumFractionDigits: maxFractionDigits, useGrouping: true }).formatToParts(n)
    .map((p) => (p.type === 'group' ? THIN : p.value)).join('');
}

/** CKB amount: a number in CKB, or a bigint in shannons. `1530` → `1 530 CKB` (thin space grouping). */
export function formatCkb(amount: number | bigint, lang: Language = current, opts: { unit?: boolean; maxFractionDigits?: number } = {}): string {
  const ckb = typeof amount === 'bigint' ? Number(amount) / 1e8 : amount;
  const s = formatNumber(ckb, lang, opts.maxFractionDigits ?? 2);
  return opts.unit === false ? s : `${s}${NBSP}${translate(lang, 'unit.ckb')}`;
}

/** Date and time (unix seconds, or a Date) in the locale. */
export function formatDate(when: number | bigint | Date, lang: Language = current,
  opts: { timeZone?: string; time?: boolean } = {}): string {
  const d = when instanceof Date ? when : new Date(Number(when) * 1000);
  return new Intl.DateTimeFormat(lang, {
    dateStyle: 'long', ...(opts.time === false ? {} : { timeStyle: 'short' }), ...(opts.timeZone ? { timeZone: opts.timeZone } : {}),
  }).format(d);
}

/** Rounded to the largest sensible unit: days (from 2 days, or whole days), hours, then minutes. */
export function formatDuration(seconds: number, lang: Language = current): string {
  const s = Math.max(0, Math.round(seconds));
  if (s >= 2 * 86_400 || (s >= 86_400 && s % 86_400 === 0)) return translate(lang, 'unit.days', { count: Math.round(s / 86_400) });
  if (s >= 3600) return translate(lang, 'unit.hours', { count: Math.round(s / 3600) });
  return translate(lang, 'unit.minutes', { count: Math.max(1, Math.round(s / 60)) });
}
