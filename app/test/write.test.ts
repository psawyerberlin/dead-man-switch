// @vitest-environment jsdom
// Phase 2 of aiworker/03-dms-ui.md: the Write flow against a fake chain driver and a fake messenger.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Runner } from '@crt/client';
import { validateConfig, type Config, type LockLike } from '../src/core/config';
import { accessTree, candidatePool, guardianBounds } from '../src/core/guardians';
import { formatCkb, MESSAGES, setLanguage, t } from '../src/core/i18n';
import { parseVault } from '../src/core/vault';
import { parseOwnerCode } from '../src/core/messenger';
import { guideSteps, MAX_GUIDE_STEPS, MIN_GUIDE_STEPS, PLACES } from '../src/core/places';
import { addRhythm, parseRhythmIso, rhythmIso } from '../src/core/rhythm';
import { templateText } from '../src/core/templates';
import { PRESS_CLASS } from '../src/ui/components/seal';
import type { WriteIO } from '../src/ui/files';
import { guideScreen } from '../src/ui/screens/guide';
import { writeScreen } from '../src/ui/write/flow';
import { type MessengerLike, OWNER_CODE_KEY, type SwitchDriver, WriteSession } from '../src/ui/write/session';
import type { WriteApp } from '../src/ui/write/view';
import { descriptor, envelopes } from './helpers';

const testnet = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../public/config/testnet.json'), 'utf8'));
const cfg = (over: Record<string, unknown> = {}): Config => validateConfig({ ...testnet, ...over }, 'testnet');

const hex = (b: number, n = 32): string => '0x' + b.toString(16).padStart(2, '0').repeat(n);
function runner(i: number, over: Partial<Runner> = {}): Runner {
  return {
    R: hex(0x10 + i), servicePubkey: '0x02' + 'aa'.repeat(32), peerId: `peer${i}`, payoutLockHash: hex(0x60 + i),
    stake: { txHash: hex(0x70 + i), index: 0 }, expiryMs: 0n, endpoint: '', registryOutPoint: { tx_hash: hex(0x80 + i), index: '0x0' },
    monitor: null, crtAnnounced: true, unproven: true, label: `Runner ${i}`, diversityKey: `C${i}/AS${i}`, ...over,
  };
}

interface Log { events: string[] }

function fakeDriver(log: Log, opts: { runners?: Runner[]; lock?: LockLike; failVerify?: boolean } = {}): SwitchDriver {
  const d = descriptor();
  return {
    runners: async () => opts.runners ?? [runner(1)],
    organiserLock: async () => opts.lock ?? { occupiedSize: 53 },
    prepareCreate: async () => {
      log.events.push('build');
      return { T: d.type_id, I: d.identity, ownerLockHash: hex(0x99), send: async () => { log.events.push('sign'); return hex(0xab); } };
    },
    waitForCommits: async (_c, _T, n, progress) => { for (let i = 1; i <= n; i++) progress(i); log.events.push('commits'); },
    describe: async () => {
      if (opts.failVerify) {
        const { VerificationError } = await import('@crt/client');
        throw new VerificationError(3, 'pubkey mismatch');
      }
      log.events.push('describe');
      return d;
    },
    arm: async () => { log.events.push('arm'); },
    wrap: async () => envelopes(d),
  };
}

function fakeMessenger(log: Log): MessengerLike & { records: unknown[] } {
  const m = {
    records: [] as unknown[],
    claim: async (_n: string, _T: string, adminHash: string) => { log.events.push(`claim:${adminHash}`); return { ok: true }; },
    put: async (record: unknown) => { m.records.push(record); log.events.push('put'); return { ok: true }; },
  };
  return m;
}

interface Harness { app: WriteApp; s: WriteSession; log: Log; saved: string[]; nav: string[]; messenger: ReturnType<typeof fakeMessenger> }

function harness(o: { config?: Config; runners?: Runner[]; lock?: LockLike; messenger?: boolean; reduced?: boolean; failVerify?: boolean } = {}): Harness {
  const log: Log = { events: [] };
  const config = o.config ?? cfg();
  const messenger = fakeMessenger(log);
  let seed = 7;
  const rng = (n: number): Uint8Array => Uint8Array.from({ length: n }, () => (seed = (seed * 1103515245 + 12345) >>> 0) & 0xff);
  const s = new WriteSession({ config: () => config, driver: fakeDriver(log, o), messenger: o.messenger === false ? null : () => messenger, rng,
    now: () => 1_763_000_000, storage: localStorage });
  const saved: string[] = [];
  const nav: string[] = [];
  const io: WriteIO = { save: (name) => saved.push(name), print: () => undefined, copy: async () => true,
    motion: { matchMedia: () => ({ matches: o.reduced === true }) } };
  const app: WriteApp = { session: s, io, walletConnected: () => true, navigate: (h) => nav.push(h) };
  return { app, s, log, saved, nav, messenger };
}

function show(step: string, app: WriteApp): HTMLElement {
  const el = writeScreen(step, app);
  document.body.replaceChildren(el);
  return el;
}

/** Letters, recipients, guardians filled in; Create run to the end. */
async function armed(h: Harness): Promise<void> {
  const s = h.s;
  s.senderLabel = 'Patrick';
  s.shared.text = '# Hello\n\nA letter.';
  s.recipients[0]!.name = 'Anna';
  s.recipients[0]!.email = 'anna@example.org';
  s.addRecipient();
  s.recipients[1]!.name = 'Ben';
  s.recipients[1]!.language = 'de';
  await s.loadRunners();
  await s.loadOrganiser();
  await s.create(t('guardians.ack_phrase'));
  expect(s.status.phase, s.status.error ?? '').toBe('done');
}

beforeEach(() => { document.body.replaceChildren(); localStorage.clear(); setLanguage('en'); });
afterEach(() => { setLanguage('en'); vi.useRealTimers(); });

// ---- letters and recipients ----------------------------------------------------------------------------------------

test('ui_recipients_max_ten', () => {
  const { app, s } = harness();
  let el = show('recipients', app);
  expect(el.querySelector('h1')!.textContent).toBe(MESSAGES.en['recipients.title']);
  for (let i = 0; i < 9; i++) el.querySelector<HTMLButtonElement>('.dms-recipients__add')!.click();
  el = document.body.firstElementChild as HTMLElement;
  expect(el.querySelectorAll('.dms-recipient')).toHaveLength(10);
  const add = el.querySelector<HTMLButtonElement>('.dms-recipients__add')!;
  expect(add.disabled).toBe(true);
  expect(el.textContent).toContain(t('recipients.max_reached', { max: 10 }));
  // the eleventh cannot be added, neither by the button nor by the session
  add.click();
  expect(s.addRecipient()).toBe(false);
  expect(s.recipients).toHaveLength(10);
  expect(new Set(s.recipients.map((r) => r.index)).size).toBe(10);
  // a lower max_recipients in the config is respected
  const small = harness({ config: cfg({ max_recipients: 2 }) });
  expect(small.s.addRecipient()).toBe(true);
  expect(small.s.addRecipient()).toBe(false);
});

test('ui_letters_modes_size_and_templates', async () => {
  const { app, s } = harness({ config: cfg({ max_vault_bytes: 2048 }) });
  let el = show('letters', app);
  expect(el.querySelector('[aria-current=step]')!.getAttribute('data-step')).toBe('letters');
  expect(el.textContent).toContain(MESSAGES.en['letter.memory_note']);
  const next = () => [...el.querySelectorAll<HTMLButtonElement>('.dms-write__actions button')].pop()!;
  expect(next().disabled).toBe(true);
  // the template picker inserts templateText(id, language)
  const tpl = el.querySelector<HTMLSelectElement>('[data-k="shared:template"]')!;
  tpl.value = 'crypto_assets';
  el.querySelector<HTMLButtonElement>('[data-k="shared:insert"]')!.click();
  const body = templateText('crypto_assets', 'en');
  expect(s.shared.text).toBe(`# ${body.title}\n\n${body.body}`);
  const sender = el.querySelector<HTMLInputElement>('[data-k="sender"]')!;
  sender.value = 'Patrick';
  sender.dispatchEvent(new Event('input'));
  s.recipients[0]!.name = 'Anna';
  expect(next().disabled).toBe(false);
  // live size per vault against max_vault_bytes
  const area = el.querySelector<HTMLTextAreaElement>('[data-k="shared:text"]')!;
  area.value = 'x'.repeat(3000);
  area.dispatchEvent(new Event('input'));
  expect(el.querySelector('[data-size="1"]')!.classList.contains('is-over')).toBe(true);
  expect(next().disabled).toBe(true);
  area.value = 'short';
  area.dispatchEvent(new Event('input'));
  expect(el.querySelector('[data-size="1"]')!.classList.contains('is-over')).toBe(false);
  expect(s.vaultSize(s.recipients[0]!)).toBe(s.vaultSize(s.recipients[0]!));
  // per recipient letters: one editor per recipient, in their language
  el.querySelector<HTMLInputElement>('input[value="each"]')!.click();
  el = document.body.firstElementChild as HTMLElement;
  expect(s.mode).toBe('each');
  expect(el.querySelector('[data-k="r1:text"]')).not.toBeNull();
  expect(el.querySelector('[data-k="shared:text"]')).toBeNull();
  // shared + note: the bundle carries both
  s.mode = 'note';
  s.shared.text = 'for all';
  s.recipients[0]!.note = 'for Anna';
  expect(s.letterFor(s.recipients[0]!)).toMatchObject({ text_markdown: 'for all', note_markdown: 'for Anna', sender_label: 'Patrick' });
});

test('ui_rhythm_consequence', () => {
  const { app, s } = harness();
  const el = show('rhythm', app);
  expect(el.querySelectorAll('input[type=radio]')).toHaveLength(testnet.rhythms_months.length + 1);
  const deadline = addRhythm(1_763_000_000, { kind: 'months', months: 3 });
  const text = el.querySelector('.dms-consequence')!.textContent!;
  expect(text).toBe(t('rhythm.consequence', { deadline: new Intl.DateTimeFormat('en', { dateStyle: 'long', timeStyle: 'short' }).format(deadline * 1000),
    opens: new Intl.DateTimeFormat('en', { dateStyle: 'long', timeStyle: 'short' }).format((deadline + 86_400) * 1000) }));
  el.querySelector<HTMLInputElement>('input[value="m12"]')!.click();
  expect(s.rhythm).toEqual({ kind: 'months', months: 12 });
  expect(rhythmIso(s.rhythm)).toBe('P12M');
  expect(parseRhythmIso('P10D')).toEqual({ kind: 'days', days: 10 });
  expect(addRhythm(Date.UTC(2026, 0, 31) / 1000, { kind: 'months', months: 1 })).toBe(Date.UTC(2026, 1, 28) / 1000);
});

// ---- guardians and price -------------------------------------------------------------------------------------------

test('ui_guardians_clamped', async () => {
  // testnet, one CRT candidate: the default is 1-of-1 and n cannot be raised
  const h = harness({ config: cfg({ default_n: 3, default_t: 2 }), runners: [runner(1), runner(2, { crtAnnounced: false })] });
  await h.s.loadRunners();
  const el = show('guardians', h.app);
  expect(h.s.candidates()).toHaveLength(1); // runner 2 does not run CRT
  expect(h.s.n).toBe(1);
  expect(h.s.t).toBe(1);
  expect(el.querySelector('[data-available]')!.textContent).toBe(t('guardians.available', { count: 1 }));
  const nInput = el.querySelector<HTMLInputElement>('[data-k="n"]')!;
  expect(nInput.max).toBe('1');
  expect(el.querySelector<HTMLButtonElement>('[data-stepnum="n"] .dms-stepnum__plus')!.disabled).toBe(true);
  nInput.value = '2';
  nInput.dispatchEvent(new Event('change'));
  expect(h.s.n).toBe(1);
  expect(el.querySelector('svg.dms-constellation')).not.toBeNull();
  // bounds: n within n_min..min(n_max, candidates), defaults clamped
  expect(guardianBounds({ n_min: 3, n_max: 16, default_n: 8, default_t: 5 }, 4)).toMatchObject({ nMax: 4, defaultN: 4, defaultT: 4, enough: true });
  expect(guardianBounds({ n_min: 3, n_max: 16, default_n: 8, default_t: 5 }, 2)).toMatchObject({ enough: false, defaultN: 0 });
  // requireDepositedValid from the config
  const strict = [runner(1, { monitor: { rank: 1, availability: { d7: 1, d30: 1, d365: 1 }, checkType: 'p2p_verified', stakeStatus: 'deposited', attestationStatus: 'valid' } }), runner(2)];
  expect(candidatePool(strict, { requireDepositedValid: true })).toHaveLength(1);
  expect(candidatePool(strict, { requireDepositedValid: false })).toHaveLength(2);
  // with more candidates n can go up to the number of candidates
  const many = harness({ runners: [1, 2, 3, 4].map((i) => runner(i)) });
  await many.s.loadRunners();
  expect(many.s.n).toBe(1);
  many.s.setN(9);
  expect(many.s.n).toBe(4);
});

test('ui_mandatory_guardian_trade_and_ack', async () => {
  const h = harness({ runners: [1, 2, 3].map((i) => runner(i)) });
  await h.s.loadRunners();
  h.s.setN(3);
  let el = show('guardians', h.app);
  expect(el.querySelector('[data-trade]')).toBeNull();
  el.querySelector<HTMLButtonElement>('[data-k="mandatory-add"]')!.click();
  el = document.body.firstElementChild as HTMLElement;
  expect(el.querySelector('[data-trade]')!.textContent).toBe(MESSAGES.en['guardians.mandatory_trade']);
  // 1-of-1 mandatory: the acknowledgement phrase must be typed (real switch)
  const phrase = t('guardians.ack_phrase');
  expect(h.s.guardiansValid(phrase)).toBe(false);
  const ack = el.querySelector<HTMLInputElement>('[data-k="ack"]')!;
  ack.value = phrase;
  ack.dispatchEvent(new Event('input'));
  expect(h.s.guardiansValid(phrase)).toBe(true);
  expect(accessTree(3, 2, 1)).toEqual({ kind: 'xor', branches: [
    { kind: 'threshold', t: 1, n: 1, leaves: [{ node: 0 }] }, { kind: 'threshold', t: 2, n: 2, leaves: [{ node: 1 }, { node: 2 }] }] });
  expect(accessTree(2, 1)).toEqual({ kind: 'threshold', t: 1, n: 2, leaves: [{ node: 0 }, { node: 1 }] });
  // a drill needs no acknowledgement
  h.s.drill = true;
  h.s.ack = '';
  expect(h.s.guardiansValid(phrase)).toBe(true);
});

test('ui_cost_panel_live', async () => {
  const h = harness();
  await h.s.loadRunners();
  const el = show('guardians', h.app);
  const monthly = (): string => el.querySelector('[data-cost="monthly"]')!.textContent!;
  const amount = (): number => Number(monthly().replace(/[^\d.]/g, ''));
  el.querySelector<HTMLInputElement>('input[value="8000"]')!.click(); // daily
  const daily = amount();
  expect(monthly()).toContain('CKB');
  el.querySelector<HTMLInputElement>('input[value="56000"]')!.click(); // weekly
  const weekly = amount();
  expect(h.s.heartbeat).toBe(56000);
  expect(weekly).toBeLessThan(daily);
  // the same panel content in the trade-off sentence
  expect(el.querySelector('[data-tradeoff]')!.textContent).toContain(MESSAGES.en['heartbeat.tradeoff']!.split('{delay}')[0]!);
  expect(el.textContent).toContain(MESSAGES.en['heartbeat.title']);
});

test('ui_fee_below_capacity_refused', async () => {
  // fee 50 CKB, organiser lock of 53 bytes: the output needs 61 CKB
  const bad = harness({ config: cfg({ organiser_fee_ckb: 50 }), lock: { occupiedSize: 53 } });
  await armedInputs(bad);
  let el = show('price', bad.app);
  await vi.waitFor(() => expect(bad.s.organiser.lock).not.toBeNull());
  el = document.body.firstElementChild as HTMLElement;
  expect(el.querySelector('[data-config-error]')!.textContent).toContain('organiser_fee_ckb 50');
  expect(el.querySelector('.dms-price__create')).toBeNull();
  await bad.s.create(t('guardians.ack_phrase'));
  expect(bad.s.status.phase).toBe('failed');
  expect(bad.log.events).toEqual([]);
  // the valid testnet config: the fee is its own line and Create is offered
  const good = harness({ lock: { occupiedSize: 53 } });
  await armedInputs(good);
  await good.s.loadOrganiser();
  el = show('price', good.app);
  expect(el.querySelector('[data-config-error]')).toBeNull();
  expect(el.querySelector('.dms-price__create')).not.toBeNull();
  expect(el.querySelector('[data-cost="organiser"] dd')!.textContent).toBe(formatCkb(70, 'en'));
  expect(el.querySelector('[data-cost="monthly"]')!.textContent).toContain(MESSAGES.en['price.monthly']!.split('{amount}')[1]!.trim());
  expect(el.querySelector('input[data-cost], [data-cost="organiser"] input')).toBeNull(); // not editable
});

test('ui_price_matches_quote', async () => {
  const h = harness({ lock: { occupiedSize: 53 } });
  await armedInputs(h);
  await h.s.loadOrganiser();
  const q = h.s.quote()!;
  expect(q).not.toBeNull();
  const el = show('price', h.app);
  expect(el.querySelector('[data-cost="now"] dd')!.textContent).toBe(formatCkb(q.spentNow));
  expect(el.querySelector('[data-cost="term"] dd')!.textContent).toBe(formatCkb(q.spentOverTerm));
  expect(el.querySelector('[data-cost="parked"] dd')!.textContent).toBe(formatCkb(q.parked));
  expect(el.querySelector('[data-cost="monthly"]')!.textContent).toContain(formatCkb(q.monthly, undefined, { unit: false }));
});

async function armedInputs(h: Harness): Promise<void> {
  h.s.senderLabel = 'Patrick';
  h.s.shared.text = 'Hello';
  h.s.recipients[0]!.name = 'Anna';
  await h.s.loadRunners();
}

// ---- create ------------------------------------------------------------------------------------------------------

test('ui_claim_before_create', async () => {
  const h = harness();
  await armedInputs(h);
  await h.s.loadOrganiser();
  const el = show('price', h.app);
  el.querySelector<HTMLButtonElement>('.dms-price__create')!.click();
  expect(h.nav).toEqual(['#/write/create']);
  await vi.waitFor(() => expect(h.s.status.phase).toBe('done'));
  const claim = h.log.events.findIndex((e) => e.startsWith('claim:'));
  const sign = h.log.events.indexOf('sign');
  expect(claim).toBeGreaterThan(-1);
  expect(claim).toBeLessThan(sign);
  expect(h.log.events.slice(sign)).toEqual(['sign', 'commits', 'describe', 'arm']);
  // the claim carries the hash of the new owner code
  const code = localStorage.getItem(OWNER_CODE_KEY('testnet', h.s.created!.T))!;
  expect(h.log.events[claim]).toBe(`claim:${parseOwnerCode(code).adminHash}`);
  const screen = show('create', h.app);
  expect(screen.querySelectorAll('.dms-progress__item.is-done')).toHaveLength(5);
  // without the messenger nothing is claimed
  const solo = harness({ messenger: false });
  await armedInputs(solo);
  await solo.s.loadOrganiser();
  await solo.s.create(t('guardians.ack_phrase'));
  expect(solo.s.status.phase).toBe('done');
  expect(solo.log.events.some((e) => e.startsWith('claim:'))).toBe(false);
});

test('ui_create_verification_hard_fail', async () => {
  const h = harness({ failVerify: true });
  await armedInputs(h);
  await h.s.loadOrganiser();
  await h.s.create(t('guardians.ack_phrase'));
  expect(h.s.status).toMatchObject({ phase: 'failed', rule: 3, sent: true });
  const el = show('create', h.app);
  expect(el.querySelector('[data-create-error]')!.textContent).toBe(t('create.verify_failed', { rule: 3 }));
  expect(el.querySelector('.dms-write__actions button')).toBeNull(); // no override, no retry
  expect(h.log.events).not.toContain('arm');
  // a second attempt never creates a second switch
  await h.s.create(t('guardians.ack_phrase'));
  expect(h.log.events.filter((e) => e === 'build')).toHaveLength(1);
});

// ---- seal --------------------------------------------------------------------------------------------------------

test('ui_seal_reduced_motion', async () => {
  for (const reduced of [true, false]) {
    const h = harness({ reduced });
    await armed(h);
    show('seal', h.app);
    await vi.waitFor(() => expect(h.s.vaults).not.toBeNull());
    const seals = [...document.querySelectorAll('.dms-seals svg.dms-seal')];
    expect(seals).toHaveLength(2);
    expect(seals.some((el) => el.classList.contains(PRESS_CLASS))).toBe(!reduced);
    expect(document.querySelectorAll(`.${PRESS_CLASS}`).length > 0).toBe(!reduced);
  }
});

test('ui_seal_checkbox_gates_next', async () => {
  const h = harness();
  await armed(h);
  show('seal', h.app);
  await vi.waitFor(() => expect(document.querySelector('[data-k="saved"]')).not.toBeNull());
  const next = document.querySelector<HTMLButtonElement>('[data-k="seal-next"]')!;
  expect(next.disabled).toBe(true);
  expect(document.body.textContent).toContain(MESSAGES.en['seal.saved_checkbox']);
  next.click();
  expect(h.nav).toEqual([]);
  // the handover route is closed as well while the box is unticked
  expect(show('handover', h.app).querySelector('.dms-handover')).toBeNull();
  show('seal', h.app);
  document.querySelector<HTMLInputElement>('[data-k="saved"]')!.click();
  const next2 = document.querySelector<HTMLButtonElement>('[data-k="seal-next"]')!;
  expect(next2.disabled).toBe(false);
  next2.click();
  expect(h.nav).toEqual(['#/write/handover']);
  // downloads: each vault, the zip, the calendar file
  for (const b of document.querySelectorAll<HTMLButtonElement>('.dms-seals button')) b.click();
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('.dms-seal-step .dms-actions button')];
  buttons.find((b) => b.textContent === MESSAGES.en['seal.download_zip'])!.click();
  buttons.find((b) => b.textContent === MESSAGES.en['seal.calendar'])!.click();
  const T8 = h.s.created!.T.slice(2, 10);
  expect(h.saved).toEqual([`vault-patrick-for-anna-${T8}.html`, `vault-patrick-for-ben-${T8}.html`, `vaults-${T8}.zip`, `deadline-${T8}.ics`]);
  expect(parseVault(h.s.vaults![1]!.html).application!.payload).toMatchObject({ language: 'de', recipient: { index: 2, name: 'Ben' } });
});

test('ui_owner_code_shown_once', async () => {
  const h = harness();
  await armed(h);
  show('seal', h.app);
  await vi.waitFor(() => expect(document.querySelector('.dms-owner-code__value')).not.toBeNull());
  const code = document.querySelector('.dms-owner-code__value')!.textContent!;
  expect(code).toMatch(/^dms1-testnet-[0-9a-f]{8}-[A-Za-z0-9_-]{43}$/);
  expect(document.body.textContent).toContain(MESSAGES.en['owner_code.title']);
  // repaints of the same screen keep it
  h.s.changed();
  expect(document.querySelector('.dms-owner-code__value')!.textContent).toBe(code);
  // leave the screen and come back: only in localStorage, rendered again only on "show"
  h.s.saved = true;
  show('handover', h.app);
  expect(document.body.textContent).not.toContain(code);
  show('seal', h.app);
  expect(document.querySelector('.dms-owner-code__value')).toBeNull();
  expect(document.body.textContent).not.toContain(code);
  expect(h.s.created!.ownerCode).toBeNull();
  expect(localStorage.getItem(OWNER_CODE_KEY('testnet', h.s.created!.T))).toBe(code);
  document.querySelector<HTMLButtonElement>('.dms-owner-code__show')!.click();
  expect(document.querySelector('.dms-owner-code__value')!.textContent).toBe(code);
});

test('ui_owner_archive_strength', async () => {
  const h = harness();
  await armed(h);
  show('seal', h.app);
  await vi.waitFor(() => expect(document.querySelector('[data-k="archive-pass"]')).not.toBeNull());
  expect(document.body.textContent).toContain(MESSAGES.en['archive.warning']);
  const pass = document.querySelector<HTMLInputElement>('[data-k="archive-pass"]')!;
  const create = [...document.querySelectorAll<HTMLButtonElement>('.dms-archive button')].find((b) => b.textContent === MESSAGES.en['archive.create'])!;
  expect(create.disabled).toBe(true);
  pass.value = 'abc';
  pass.dispatchEvent(new Event('input'));
  expect(create.disabled).toBe(true);
  pass.value = 'correct horse battery staple 1979!';
  pass.dispatchEvent(new Event('input'));
  expect(create.disabled).toBe(false);
  expect(h.s.archiveName()).toBe(`owner-archive-${h.s.created!.T.slice(2, 10)}.dmsa`);
  expect(h.s.archiveContents()).toMatchObject({ network: 'testnet', T: h.s.created!.T, sender_label: 'Patrick', rhythm: 'P3M' });
});

// ---- hand over ----------------------------------------------------------------------------------------------------

test('ui_handover_put_record_and_drop', async () => {
  const h = harness();
  await armed(h);
  await h.s.seal();
  h.s.saved = true;
  let el = show('handover', h.app);
  expect(el.querySelectorAll('.dms-handover')).toHaveLength(2);
  const place = el.querySelector<HTMLSelectElement>('[data-k="r1:place"]')!;
  place.value = 'nextcloud';
  place.dispatchEvent(new Event('change'));
  el = document.body.firstElementChild as HTMLElement;
  expect([...el.querySelectorAll('[data-recipient="1"] .dms-guide__steps li')].map((li) => li.textContent)).toEqual(guideSteps('nextcloud', 'en'));
  expect(el.querySelector('[data-recipient="1"] a[href="#/guide/nextcloud"]')).not.toBeNull();
  // https only
  const link = el.querySelector<HTMLInputElement>('[data-k="r1:link"]')!;
  link.value = 'http://example.org/v';
  link.dispatchEvent(new Event('input'));
  expect(h.s.linkError(h.s.recipients[0]!)).not.toBeNull();
  link.value = 'https://cloud.example.org/s/abc';
  link.dispatchEvent(new Event('input'));
  expect(h.s.linkError(h.s.recipients[0]!)).toBeNull();
  expect(el.textContent).toContain(t('handover.link_label', { name: 'Anna' }));
  [...el.querySelectorAll<HTMLButtonElement>('.dms-write__actions button')].pop()!.click();
  await vi.waitFor(() => expect(h.s.handedOver).toBe(true));
  const record = h.messenger.records[0] as { T: string; recipients: { index: number; email: string | null; link: unknown }[] };
  expect(record.T).toBe(h.s.created!.T);
  expect(record.recipients[0]).toMatchObject({ index: 1, email: 'anna@example.org' });
  expect(record.recipients[0]!.link).toMatchObject({ nonce: expect.stringMatching(/^0x/) });
  expect(record.recipients[1]!.link).toBeNull();
  const json = JSON.stringify(record);
  expect(json).not.toContain('cloud.example.org');
  expect(json).not.toContain('A letter.');
  // K and the letters are dropped from memory (no archive was kept open)
  expect(h.s.created!.K).toBeNull();
  expect(h.s.shared.text).toBe('');
  expect(h.s.vaults).toHaveLength(2);
  expect(h.log.events.at(-1)).toBe('put');
});

test('ui_handover_guides_three_languages', () => {
  expect(PLACES).toHaveLength(10);
  for (const p of PLACES) {
    const counts = (['en', 'fr', 'de'] as const).map((l) => {
      const steps = guideSteps(p, l);
      for (const s of steps) expect(s.trim(), `${l} ${p}`).not.toBe('');
      expect(MESSAGES[l][`guide.${p}.name`], `${l} ${p} name`).toBeTruthy();
      return steps.length;
    });
    expect(counts[0], p).toBeGreaterThanOrEqual(MIN_GUIDE_STEPS);
    expect(counts[0], p).toBeLessThanOrEqual(MAX_GUIDE_STEPS);
    expect(counts, p).toEqual([counts[0], counts[0], counts[0]]);
  }
  // #/guide lists the ten places; #/guide/<place> shows the steps in the UI language
  for (const l of ['en', 'fr', 'de'] as const) {
    setLanguage(l);
    expect(guideScreen(null).querySelectorAll('.dms-guide__places a')).toHaveLength(10);
    const one = guideScreen('dropbox');
    expect(one.querySelector('h1')!.textContent).toBe(MESSAGES[l]['guide.dropbox.name']);
    expect([...one.querySelectorAll('.dms-guide__steps li')].map((li) => li.textContent)).toEqual(guideSteps('dropbox', l));
  }
  expect(guideScreen('nowhere').querySelector('h1')!.textContent).toBe(MESSAGES.de['shell.not_found']);
});

test('ui_write_steps_render_three_languages', async () => {
  for (const l of ['en', 'fr', 'de'] as const) {
    setLanguage(l);
    const h = harness();
    await h.s.loadRunners();
    for (const step of ['letters', 'recipients', 'rhythm', 'guardians', 'price', 'create', 'seal', 'handover']) {
      const el = show(step, h.app);
      expect(el.querySelector('.dms-stepper'), step).not.toBeNull();
      expect(el.querySelector('h1')?.textContent, `${l} ${step}`).toBeTruthy();
    }
  }
});
