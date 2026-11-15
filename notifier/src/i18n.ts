// The messenger's strings (SPEC.md §6): flat keys with {placeholder}s, identical keys in en/fr/de.
import en from './i18n/en.json' with { type: 'json' };
import fr from './i18n/fr.json' with { type: 'json' };
import de from './i18n/de.json' with { type: 'json' };

export const LANGUAGES = ['en', 'fr', 'de'] as const;
export type Language = (typeof LANGUAGES)[number];
export type MessageKey = keyof typeof en;

const TABLES: Record<Language, Record<string, string>> = { en, fr, de };

export const isLanguage = (x: unknown): x is Language => typeof x === 'string' && (LANGUAGES as readonly string[]).includes(x);
export const asLanguage = (x: unknown): Language => (isLanguage(x) ? x : 'en');

export function t(lang: string, key: MessageKey, params: Record<string, string | number> = {}): string {
  const s = TABLES[asLanguage(lang)][key] ?? en[key];
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
}

/** Picks a language from an Accept-Language header (for pages reached with an unknown token). */
export function fromAcceptLanguage(h: string | undefined): Language {
  for (const part of (h ?? '').split(',')) {
    const tag = part.trim().slice(0, 2).toLowerCase();
    if (isLanguage(tag)) return tag;
  }
  return 'en';
}
