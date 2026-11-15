import { test, expect, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { detectLanguage, formatCkb, formatDate, formatDuration, MESSAGES, setLanguage, t, translate } from '../src/core/i18n';

afterEach(() => setLanguage('en'));

test('i18n_same_keys_in_all_languages', () => {
  const keys = (l: 'en' | 'fr' | 'de') => Object.keys(MESSAGES[l]).sort();
  expect(keys('fr')).toEqual(keys('en'));
  expect(keys('de')).toEqual(keys('en'));
  for (const l of ['en', 'fr', 'de'] as const) for (const [k, v] of Object.entries(MESSAGES[l])) expect(v.trim(), `${l} ${k}`).not.toBe('');
  // every key used literally in app/src (t('…') / translate(lang, '…')) exists
  const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));
  const src = files(new URL('../src', import.meta.url).pathname).filter((f) => f.endsWith('.ts')).map((f) => readFileSync(f, 'utf8')).join('\n');
  for (const m of src.matchAll(/\b(?:t|translate)\((?:\w+, )?'([a-z_]+\.[a-z0-9_.]+)'/g)) expect(MESSAGES.en[m[1]!], m[1]).toBeDefined();
  // the fixed vocabulary of SPEC.md §2
  expect([MESSAGES.en['word.vault'], MESSAGES.fr['word.vault'], MESSAGES.de['word.vault']]).toEqual(['vault', 'coffre', 'Tresor']);
});

test('i18n_detect_order', () => {
  const store = (v: string | null) => ({ getItem: () => v });
  expect(detectLanguage('?lang=de', store('fr'), ['en-US'])).toBe('de');
  expect(detectLanguage('?x=1&lang=FR', null, [])).toBe('fr');
  expect(detectLanguage('?lang=es', store('fr'), ['de-DE'])).toBe('fr');
  expect(detectLanguage('', store(null), ['es-ES', 'de-AT', 'fr'])).toBe('de');
  expect(detectLanguage(new URLSearchParams(''), { getItem: () => { throw new Error('blocked'); } }, ['fr-CA'])).toBe('fr');
  expect(detectLanguage(null, null, ['es', 'it'])).toBe('en');
  expect(detectLanguage(undefined, undefined, undefined)).toBe('en');
});

test('i18n_plural_forms', () => {
  expect(translate('en', 'unit.days', { count: 1 })).toBe('1 day');
  expect(translate('en', 'unit.days', { count: 3 })).toBe('3 days');
  expect(translate('fr', 'unit.days', { count: 0 })).toBe('0 jour'); // French: 0 is singular
  expect(translate('fr', 'unit.days', { count: 2 })).toBe('2 jours');
  expect(translate('de', 'unit.days', { count: 1 })).toBe('1 Tag');
  expect(translate('de', 'unit.days', { count: 1500 })).toBe('1 500 Tage');
  expect(translate('en', 'letter.files_total', { count: 0, size: '0 B' })).toBe('No files, 0 B in total');
  expect(translate('en', 'letter.files_total', { count: 1, size: '2 MB' })).toBe('1 file, 2 MB in total');
  expect(translate('de', 'letter.files_total', { count: 4, size: '2 MB' })).toBe('4 Dateien, insgesamt 2 MB');
  setLanguage('fr');
  expect(t('rhythm.option', { months: 1 })).toBe('Chaque mois');
  expect(t('rhythm.option', { months: 3 })).toBe('Tous les 3 mois');
  expect(t('missing.key')).toBe('missing.key');
  expect(formatCkb(1530, 'en')).toBe('1 530 CKB');
  expect(formatCkb(153_050_000_000n, 'de')).toBe('1 530,5 CKB');
  expect(formatDuration(3 * 86_400, 'en')).toBe('3 days');
  expect(formatDuration(3 * 3600, 'de')).toBe('3 Stunden');
  expect(formatDuration(30 * 60, 'fr')).toBe('30 minutes');
  expect(formatDate(0, 'en', { timeZone: 'UTC' })).toContain('1970');
});
