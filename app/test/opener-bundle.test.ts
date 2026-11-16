import { beforeAll, expect, test } from 'vitest';
import { webcrypto } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { encryptBundle } from '../src/core/bundle';
import { buildVault, setOpenerScript, getOpenerScript } from '../src/core/vault';
import type { OpenerWindow } from '../src/opener/opener';
import { buildOpener } from '../vite.config';
import en from '../src/i18n/en.json';
import { descriptor, envelopes, K, letter, seeded } from './helpers';

let opener = '';
beforeAll(async () => { opener = await buildOpener(); }, 120_000);

const d = descriptor();

async function vaultHtml(index: number, name: string): Promise<string> {
  const sealed = await encryptBundle(K, d.identity, index, letter(index, name, { language: 'en' }), seeded(5));
  return buildVault({
    descriptor: d, envelopes: envelopes(d), deadline: 1_900_000_000, recipient: { index, name }, sealed, script: opener,
    meta: { network: 'testnet', language: 'en', sender_label: 'Patrick', drill: false, created_at: 1_763_000_000, app_url: 'https://dead-man-switch.chainsolution.net' },
  });
}

/** Opens a vault the way a browser does: the kit's script, then the opener; the network is unreachable. */
function open(html: string): OpenerWindow {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'file:///vault.html',
    beforeParse(win) {
      const g = win as unknown as Record<string, unknown>;
      Object.defineProperty(win, 'crypto', { value: webcrypto, configurable: true });
      g.TextEncoder = TextEncoder; g.TextDecoder = TextDecoder;
      g.fetch = () => Promise.reject(new TypeError('offline'));
      let n = 0;
      win.URL.createObjectURL = () => `blob:vault/${++n}`;
    },
  });
  return dom.window as unknown as OpenerWindow;
}

const settle = () => new Promise((r) => setTimeout(r, 50));

test('opener_contains_no_script_close', () => {
  expect(opener.length).toBeGreaterThan(10_000);
  expect(opener).not.toMatch(/<\/script/i);
  expect(opener).not.toContain('<!--');
  expect(new TextEncoder().encode(opener).length).toBeLessThan(300 * 1024);
  // self-contained: no module syntax, no loader, no network beyond the kit's chain reads
  expect(opener).not.toMatch(/^\s*(import|export)\s/m);
  expect(opener).not.toMatch(/\bimport\s*\(|importScripts|XMLHttpRequest|sendBeacon/);
  expect(opener).toContain('crtApplication');
  // the three languages are inside
  expect(opener).toContain('Tresor');
  expect(opener).toContain('coffre');
  // the vault accepts it as its default opener
  const before = getOpenerScript();
  setOpenerScript(opener);
  expect(getOpenerScript()).toBe(opener);
  setOpenerScript(before);
  expect(() => setOpenerScript('x = "</script>"')).toThrow();
});

test('opener_bundle_runs_in_vault', async () => {
  const w = open(await vaultHtml(2, 'Ben'));
  await settle();
  // the kit ran (api, self-verification) and the opener registered its hook and rendered its UI
  expect(typeof w.CRT_KIT?.api?.recover).toBe('function');
  expect(w.document.getElementById('crt-verify')!.className).toContain('match');
  expect(typeof w.crtApplication?.onKey).toBe('function');
  const root = w.document.getElementById('crt-application')!;
  expect(w.document.body.firstElementChild).toBe(root);
  expect(root.textContent).toContain(en['open.integrity.match']);
  expect(root.textContent).toContain(en['open.status.offline']); // readSwitch through the kit failed: offline
  // what the kit does after recovery: `crtApplication.onKey(K)`
  const ok = await w.crtApplication!.onKey(new Uint8Array(Buffer.from(K.slice(2), 'hex')));
  expect(ok).toBe(true);
  expect(w.document.querySelector('#dms-letter .dms-text h1')?.textContent).toBe('Pour Ben');
  expect(w.document.querySelector('#dms-letter .dms-files a')?.getAttribute('href')).toBe('blob:vault/1');
});

test('offline_box_opens_with_the_recovered_key', async () => {
  const w = open(await vaultHtml(2, 'Ben'));
  await settle();
  const paste = w.document.getElementById('crt-paste') as HTMLTextAreaElement;
  const click = () => (w.document.getElementById('crt-btn-offline') as HTMLButtonElement).click();
  // a value that is neither a guardian's release value nor K: a clear message, nothing opens
  paste.value = '0x' + '42'.repeat(32);
  click(); await settle();
  expect(w.document.getElementById('crt-status')!.textContent).toContain('neither the release value');
  expect(w.document.querySelector('#dms-letter .dms-text h1')).toBeNull();
  // the recovered key K kept from an earlier opening: opens without any chain read
  paste.value = K;
  click(); await settle();
  expect(w.document.getElementById('crt-status')!.textContent).toContain('Opened with the recovered key');
  expect(w.document.querySelector('#dms-letter .dms-text h1')?.textContent).toBe('Pour Ben');
});
