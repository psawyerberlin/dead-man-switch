// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { encryptBundle, type Letter } from '../src/core/bundle';
import { letterKey } from '../src/core/keys';
import { buildVault, parseVault, vaultPayload, type VaultMeta } from '../src/core/vault';
import { installOpener, type CrtKit, type KitApi, type OpenerHandle, type OpenerWindow } from '../src/opener/opener';
import { markdownToSafeHtml } from '../src/opener/markdown';
import en from '../src/i18n/en.json';
import fr from '../src/i18n/fr.json';
import de from '../src/i18n/de.json';
import { descriptor, envelopes, K, letter, seeded } from './helpers';

if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });

const d = descriptor();
const I = d.identity;
const w = window as unknown as OpenerWindow;
const meta = (language: Letter['language'] = 'fr', drill = false): VaultMeta =>
  ({ network: 'testnet', language, sender_label: 'Patrick', drill, created_at: 1_763_000_000, app_url: 'https://dead-man-switch.chainsolution.net' });

const offlineApi = (): KitApi => ({
  readSwitch: vi.fn(async () => { throw new TypeError('fetch failed'); }),
  collectReleases: vi.fn(async () => new Map()),
  recover: vi.fn(async () => { throw new TypeError('fetch failed'); }),
});

/** Loads the body of a real vault (scripts do not run through `innerHTML`) and sets `CRT_KIT` as the kit would. */
async function setup(opts: { index?: number; name?: string; l?: Letter; language?: Letter['language']; drill?: boolean; api?: KitApi; sealedFor?: number; raw?: Uint8Array } = {}): Promise<OpenerHandle> {
  const index = opts.index ?? 1, name = opts.name ?? 'Anna';
  const l = opts.l ?? letter(index, name, { language: opts.language ?? 'fr' });
  const sealed = await encryptBundle(K, I, opts.sealedFor ?? index, opts.raw ? opts.raw : opts.sealedFor ? { ...l, recipient: { index: opts.sealedFor, name } } : l, seeded(11));
  const m = meta(opts.language ?? 'fr', opts.drill);
  const html = buildVault({ descriptor: d, envelopes: envelopes(d), deadline: 1_900_000_000, recipient: { index, name }, sealed, meta: m, script: '/* test */' });
  document.documentElement.innerHTML = html.replace(/^<!DOCTYPE html>\s*<html[^>]*>/i, '').replace(/<\/html>\s*$/i, '');
  document.getElementById('crt-verify')!.className = 'banner match';
  const parsed = parseVault(html);
  const kit: CrtKit = {
    descriptor: parsed.descriptor, application: { name: 'dead-man-switch', version: '2', payload: vaultPayload({ recipient: { index, name }, sealed, meta: m }) },
    api: opts.api ?? offlineApi(),
  };
  w.CRT_KIT = kit;
  return installOpener(window);
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const text = (): string => document.getElementById('crt-application')!.textContent ?? '';

beforeEach(() => {
  delete w.__dmsOpener; delete w.crtApplication; delete w.CRT_KIT; delete w.DMS_PRACTICE; delete w.DMS_PRACTICE_KEY;
  let n = 0;
  URL.createObjectURL = vi.fn(() => `blob:vault/${++n}`);
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => { document.documentElement.innerHTML = '<head></head><body></body>'; });

test('opener_registers_hook', async () => {
  const h = await setup();
  expect(typeof w.crtApplication?.onKey).toBe('function');
  expect(installOpener(window)).toBe(h); // idempotent
  const root = document.getElementById('crt-application')!;
  expect(document.body.firstElementChild).toBe(root); // the opener's UI comes first
  expect(root.classList.contains('dms')).toBe(true);
  expect(document.getElementById('dms-opener-style')).not.toBeNull();
  await flush();
  expect(w.CRT_KIT!.api!.readSwitch).toHaveBeenCalled(); // status through the kit's api, offline here
  expect(text()).toContain(fr['open.status.offline']);
  expect(text()).toContain(fr['open.integrity.match']);
  expect(text()).toContain('Patrick');
  expect(await w.crtApplication!.onKey(new Uint8Array(31))).toBe(false);
  expect(text()).toContain(fr['open.error.key_length']);
  expect(await w.crtApplication!.onKey(K as unknown as Uint8Array)).toBe(true);
  expect(document.getElementById('dms-letter')).not.toBeNull();
  expect(document.body.classList.contains('dms-letter-open')).toBe(true);
});

test('opener_renders_letter_in_three_languages', async () => {
  for (const [lang, msgs, other] of [['en', en, 'de'], ['fr', fr, 'en'], ['de', de, 'fr']] as const) {
    delete w.__dmsOpener;
    const h = await setup({ language: lang, drill: true });
    await flush();
    expect(document.documentElement.getAttribute('lang')).toBe(lang);
    expect(text()).toContain(msgs['open.title']);
    expect(text()).toContain(msgs['open.drill_banner']);
    expect(text()).toContain(msgs['drill.ribbon']);
    expect(await h.onKey(K)).toBe(true);
    const letterEl = document.getElementById('dms-letter')!;
    expect(letterEl.querySelector('h1')!.textContent).toBe(msgs['open.letter_from'].replace('{sender}', 'Patrick'));
    expect(letterEl.querySelector('.dms-text h1')!.textContent).toBe('Pour Anna');
    expect(letterEl.textContent).toContain(msgs['open.files']);
    expect(letterEl.textContent).toContain(msgs['open.print']);
    expect(letterEl.textContent).toContain('Une note.');
    // the language switch re-renders the page in another language
    const select = document.getElementById('dms-language') as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(['en', 'fr', 'de']);
    select.value = other;
    select.dispatchEvent(new Event('change'));
    expect(h.state.lang).toBe(other);
    expect(document.documentElement.getAttribute('lang')).toBe(other);
    const o = { en, fr, de }[other];
    expect(text()).toContain(o['open.files']);
    expect(text()).toContain(o['open.drill_banner']);
  }
  // practice mode: the label on the screen and the embedded key
  delete w.__dmsOpener;
  w.DMS_PRACTICE = true; w.DMS_PRACTICE_KEY = K;
  await setup({ language: 'en' });
  expect(text()).toContain(en['open.practice']);
  expect(w.CRT_KIT!.api!.readSwitch).not.toHaveBeenCalled(); // no chain in practice
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent === en['open.practice_open'])!;
  btn.click();
  await flush(); await flush();
  expect(document.getElementById('dms-letter')).not.toBeNull();
  expect(text()).toContain(en['open.practice']);
});

test('opener_markdown_is_sanitised', async () => {
  const evil = [
    '# Title', '', '<script>window.__pwned = 1</script>', '', '<img src=x onerror="window.__pwned = 2">',
    '', '![remote](https://example.org/track.png)', '', '[bad](javascript:window.__pwned=3) [good](https://example.org) [mail](mailto:a@example.org)',
    '', '*em* **strong** `code`', '', '- one', '- two', '', '<a href="https://x.org" onclick="x()">raw</a>',
  ].join('\n');
  const h = await setup({ l: { ...letter(1, 'Anna'), text_markdown: evil, note_markdown: '<iframe src="https://x.org"></iframe>' } });
  expect(await h.onKey(K)).toBe(true);
  await flush();
  const el = document.getElementById('dms-letter')!;
  expect(el.querySelector('script, img, iframe, [onerror], [onclick], [src]')).toBeNull();
  expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  // raw HTML is shown as text, not markup
  expect(el.textContent).toContain('<script>window.__pwned = 1</script>');
  expect(el.textContent).toContain('<img src=x onerror=');
  const links = [...el.querySelectorAll('.dms-text a')];
  expect(links.map((a) => a.getAttribute('href'))).toEqual([null, 'https://example.org', 'mailto:a@example.org']);
  for (const a of links.filter((x) => x.hasAttribute('href'))) expect(a.getAttribute('rel')).toContain('noopener');
  expect(el.querySelector('.dms-text h1')?.textContent).toBe('Title');
  expect(el.querySelector('.dms-text em')?.textContent).toBe('em');
  expect(el.querySelector('.dms-text strong')?.textContent).toBe('strong');
  expect(el.querySelector('.dms-text code')?.textContent).toBe('code');
  expect(el.querySelectorAll('.dms-text li').length).toBe(2);
  const raw = markdownToSafeHtml('<b onmouseover="x()">b</b> <svg onload="x()"></svg> [d](data:text/html,hi)', window);
  expect(raw).not.toMatch(/<b[\s>]|<svg|href="data:/);
});

test('opener_file_download_links', async () => {
  const files = [
    { name: 'will.pdf', mime: 'application/pdf', size: 4, data_b64: 'JVBERg==' },
    { name: 'page.html', mime: 'text/html', size: 5, data_b64: 'aGVsbG8=' },
    { name: '../../etc/passwd', mime: 'text/plain', size: 5, data_b64: 'aGVsbG8=' },
  ];
  const h = await setup({ language: 'en', l: { ...letter(1, 'Anna', { language: 'en' }), files } });
  expect(await h.onKey(K)).toBe(true);
  expect(URL.createObjectURL).toHaveBeenCalledTimes(3);
  const blobs = vi.mocked(URL.createObjectURL).mock.calls.map((c) => c[0] as Blob);
  expect(blobs.map((b) => b.type)).toEqual(['application/pdf', 'application/octet-stream', 'text/plain']);
  const bytes = await new Promise<ArrayBuffer>((ok) => { const fr = new FileReader(); fr.onload = () => ok(fr.result as ArrayBuffer); fr.readAsArrayBuffer(blobs[0]!); });
  expect(new Uint8Array(bytes)).toEqual(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
  const items = [...document.querySelectorAll('#dms-letter .dms-files li')];
  expect(items).toHaveLength(3);
  const anchors = items.map((li) => li.querySelector('a')!);
  expect(anchors.map((a) => a.getAttribute('href'))).toEqual(['blob:vault/1', 'blob:vault/2', 'blob:vault/3']);
  expect(anchors.map((a) => a.getAttribute('download'))).toEqual(['will.pdf', 'page.html', 'passwd']);
  expect(anchors.every((a) => a.textContent === en['open.download'])).toBe(true);
  expect(items[0]!.textContent).toContain('will.pdf');
  expect(items[0]!.textContent).toMatch(/4\s?byte/);
  // print stylesheet: the letter alone once open
  expect(document.getElementById('dms-opener-style')!.textContent).toMatch(/@media print[\s\S]*dms-letter-open/);
  const print = vi.fn(); window.print = print;
  [...document.querySelectorAll('button')].find((b) => b.textContent === en['open.print'])!.click();
  expect(print).toHaveBeenCalled();
});

test('opener_uses_recipient_key', async () => {
  // the vault of recipient 2 opens with K (through K_letter(2)) …
  let h = await setup({ index: 2, name: 'Ben', language: 'en' });
  expect(await h.onKey(K)).toBe(true);
  expect(document.querySelector('#dms-letter .dms-text h1')!.textContent).toBe('Pour Ben');
  // … but not with recipient 1's derived key
  delete w.__dmsOpener;
  h = await setup({ index: 2, name: 'Ben', language: 'en' });
  expect(await h.onKey(letterKey(K, I, 1))).toBe(false);
  expect(text()).toContain(en['open.error.decrypt']);
  expect(document.getElementById('dms-letter')).toBeNull();
  // a ciphertext sealed for recipient 1 cannot be passed off as recipient 2's
  delete w.__dmsOpener;
  h = await setup({ index: 2, name: 'Ben', language: 'en', sealedFor: 1 });
  expect(await h.onKey(K)).toBe(false);
  expect(text()).toContain(en['open.error.decrypt']);
  // an unknown bundle version is named as such, a wrong key length too
  delete w.__dmsOpener;
  h = await setup({ language: 'en', raw: new Uint8Array(Buffer.from(JSON.stringify({ ...letter(1, 'Anna'), version: 3 }))) });
  expect(await h.onKey(K)).toBe(false);
  expect(text()).toContain(en['open.error.version']);
  expect(await h.onKey('0x1234')).toBe(false);
  expect(text()).toContain(en['open.error.key_length']);
  expect(text()).not.toMatch(/Error|at \w+ \(/); // no stack traces
});

test('opener_chain_status_and_recovery', async () => {
  const status = (released: number, alive = true) => ({
    alive, released, deadline: 1_900_000_000n, descriptorHashMatches: true,
    nodes: d.nodes.map((n, i) => ({ R: n.runner_lock_hash, state: i < released ? 2 : 1, deadline: 1_900_000_000n, descriptorHash: '0x' })),
  });
  const api: KitApi = { readSwitch: vi.fn(async () => status(0)), collectReleases: vi.fn(async () => new Map()), recover: vi.fn() };
  const h = await setup({ language: 'en', api });
  await flush();
  expect(text()).toContain(en['open.integrity.chain_match']);
  expect(text()).toMatch(/^.*Not yet\./m);
  vi.mocked(api.readSwitch).mockResolvedValueOnce(status(1));
  await h.checkChain();
  expect(text()).toContain('1 of 2 pieces are available. 1 more are needed.');
  vi.mocked(api.readSwitch).mockResolvedValueOnce(status(0, false));
  await h.checkChain();
  expect(text()).toContain(en['open.status.cancelled_undated']);
  vi.mocked(api.readSwitch).mockResolvedValueOnce(status(2));
  await h.checkChain();
  expect(text()).toContain('Released. 2 of 3 guardians');
  // a bad piece is named by guardian
  const R0 = d.nodes[0]!.runner_lock_hash;
  vi.mocked(api.recover).mockRejectedValueOnce(Object.assign(new Error('x'), {
    report: { leaves: [{ position: 0, runner_lock_hash: R0, status: 'commitment-mismatch' }, { position: 1, runner_lock_hash: d.nodes[1]!.runner_lock_hash, status: 'ok' }] },
  }));
  [...document.querySelectorAll('button')].find((b) => b.textContent === en['open.recover'])!.click();
  await flush(); await flush();
  expect(text()).toContain(en['open.error.recover']);
  expect(text()).toContain(`The piece from guardian ${d.nodes[0]!.label ?? R0.slice(0, 10) + '…'} is wrong`);
  // a successful recovery: the kit calls onKey itself
  vi.mocked(api.recover).mockImplementationOnce(async () => { await w.crtApplication!.onKey(new Uint8Array(Buffer.from(K.slice(2), 'hex'))); return new Uint8Array(32); });
  [...document.querySelectorAll('button')].find((b) => b.textContent === en['open.recover'])!.click();
  await flush(); await flush(); await flush();
  expect(document.getElementById('dms-letter')).not.toBeNull();
});
