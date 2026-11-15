// @vitest-environment jsdom
// Phase 4 of aiworker/03-dms-ui.md: screens in three languages, no hard-coded strings, mainnet disabled.
import { beforeEach, expect, test } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LANGUAGES, MESSAGES, setLanguage } from '../src/core/i18n';
import { loadNetworks, selectNetwork } from '../src/ui/network';
import { parseHash, ROUTES } from '../src/ui/router';
import { screenFor } from '../src/ui/shell';

const here = dirname(fileURLToPath(import.meta.url));
const rd = (rel: string): string => readFileSync(join(here, rel), 'utf8');
const testnetConfig = JSON.parse(rd('../public/config/testnet.json'));
const mainnetConfig = JSON.parse(rd('../public/config/mainnet.json'));
const fakeFetch = (files: Record<string, unknown>) => async (url: string) => {
  const body = files[url];
  return { ok: body !== undefined, status: body === undefined ? 404 : 200, json: async () => body };
};
const networks = (enabled: boolean) => loadNetworks(fakeFetch({
  '/app/config/testnet.json': testnetConfig, '/app/config/mainnet.json': { ...mainnetConfig, enabled },
}));

beforeEach(() => { document.body.replaceChildren(); localStorage.clear(); setLanguage('en'); });

test('ui_renders_three_languages', async () => {
  const network = await networks(false);
  const seen = new Set<string>();
  for (const lang of LANGUAGES) {
    setLanguage(lang);
    for (const hash of Object.keys(ROUTES)) {
      const el = screenFor(parseHash(hash), network);
      const h1 = el.querySelector('h1')?.textContent ?? '';
      expect(h1, `${lang} ${hash}`).toBeTruthy();
      const raw = (el.textContent ?? '').match(/[a-z]+(?:\.[a-z_0-9]+)+/g)?.filter((w) => w in MESSAGES.en) ?? [];
      expect(raw, `${lang} ${hash}: untranslated keys`).toEqual([]);
    }
    const home = screenFor(parseHash('#/'), network);
    expect(home.querySelector('h1')!.textContent).toBe(MESSAGES[lang]['app.tagline']);
    seen.add(home.querySelector('h1')!.textContent!);
  }
  expect(seen.size).toBe(3);
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

test('i18n_no_hardcoded_strings', () => {
  const files = walk(join(here, '../src')).filter((f) => f.endsWith('.ts') && !f.includes('/i18n/'));
  const offenders: string[] = [];
  for (const f of files) {
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (/console\.|https?:\/\/|querySelector|getElementById|import |from '|aria-|data-|\/\/|\* /.test(line)) return;
      const m = line.match(/(['"`])([A-ZÀ-Ü][a-zà-ü]+ [a-zà-ü]+[^'"`]*)\1/);
      if (m && !/^(text\/|application\/)/.test(m[2]!)) offenders.push(`${f}:${i + 1}: ${m[2]!.slice(0, 40)}`);
    });
  }
  expect(offenders).toEqual([]);
  // the three catalogues have the same keys
  const keys = (l: 'en' | 'fr' | 'de'): string[] => Object.keys(MESSAGES[l]).sort();
  expect(keys('fr')).toEqual(keys('en'));
  expect(keys('de')).toEqual(keys('en'));
});

test('ui_mainnet_disabled', async () => {
  const off = await networks(false);
  expect(off.mainnetEnabled).toBe(false);
  expect(selectNetwork(off, 'mainnet')).toBe(false);
  expect(off.current).toBe('testnet');
  expect(JSON.parse(rd('../public/config/mainnet.json')).enabled).toBe(false);
  for (const hash of ['#/drill', '#/drill/report']) {
    expect(screenFor(parseHash(hash), off).querySelector('.dms-ribbon')?.textContent ?? '').not.toContain('mainnet');
  }
});
