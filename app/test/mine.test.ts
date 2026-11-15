// @vitest-environment jsdom
// Phase 3 of aiworker/03-dms-ui.md: My switches, the phone check-in, Away until, Open, the fire drill and privacy,
// against a fake chain driver and a fake messenger.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateConfig, type Config, type Network } from '../src/core/config';
import { awayBounds, awayDeadline } from '../src/core/away';
import type { SwitchSummary } from '../src/core/chain';
import { drillOpensAt } from '../src/core/drill';
import { formatDate, LANGUAGES, MESSAGES, setLanguage, t } from '../src/core/i18n';
import { newOwnerCode } from '../src/core/messenger';
import { addRhythm, parseRhythmIso, rhythmIso } from '../src/core/rhythm';
import { OWNER_CODE_KEY, loadSwitches, upsertSwitch } from '../src/core/switches';
import { parseCheckinLink, checkinScreen } from '../src/ui/mine/checkin';
import { mineScreen } from '../src/ui/mine/screen';
import { MineService, type OwnerDriver, type OwnerMessenger } from '../src/ui/mine/service';
import type { MineApp } from '../src/ui/mine/view';
import { loadNetworks, type NetworkState } from '../src/ui/network';
import { parseHash } from '../src/ui/router';
import { drillReport } from '../src/ui/screens/drill';
import { openScreen, practiceScreen, VAULT_SANDBOX } from '../src/ui/screens/open';
import { privacyScreen, PRIVACY_SECTIONS } from '../src/ui/screens/privacy';
import { screenFor } from '../src/ui/shell';
import { writeScreen } from '../src/ui/write/flow';
import { WriteSession } from '../src/ui/write/session';
import type { WriteApp } from '../src/ui/write/view';
import { descriptor } from './helpers';

const here = dirname(fileURLToPath(import.meta.url));
const testnetRaw = JSON.parse(readFileSync(join(here, '../public/config/testnet.json'), 'utf8'));
const mainnetRaw = JSON.parse(readFileSync(join(here, '../public/config/mainnet.json'), 'utf8'));
const testnet = (): Config => validateConfig(testnetRaw, 'testnet');

const T = '0x' + '5a'.repeat(32);
const OWNER = '0x' + '99'.repeat(32);
const CHAIN_NOW = 1_770_000_000;

interface Log { events: string[]; renews: number[] }

function fakeOwner(log: Log, o: { owner?: string; wallet?: string | null; state?: SwitchSummary['state']; deadline?: number } = {}): OwnerDriver {
  return {
    summary: async () => ({ state: o.state ?? 'armed', deadline: o.deadline ?? CHAIN_NOW + 20 * 86_400, chainTime: CHAIN_NOW,
      secondsLeft: (o.deadline ?? CHAIN_NOW + 20 * 86_400) - CHAIN_NOW, headroom: { threshold: 2, mandatory: null, overall: 2, mandatoryBranch: null },
      ownerLockHash: o.owner ?? OWNER, armed: 3, nodeCount: 3 }),
    history: async () => [{ kind: 'create', txHash: '0x01', blockNumber: 1, timestamp: CHAIN_NOW - 70 * 86_400, deadline: CHAIN_NOW + 20 * 86_400 }],
    walletLockHash: async () => (o.wallet === undefined ? OWNER : o.wallet),
    renew: async (_c, _T, deadline) => { log.events.push('renew'); log.renews.push(deadline); return '0xab'; },
    cancel: async () => { log.events.push('cancel'); return '0xcd'; },
    reclaim: async () => { log.events.push('reclaim'); return '0xef'; },
  };
}

function fakeMessenger(log: Log): OwnerMessenger {
  return {
    get: async () => { log.events.push('get'); return { record: { recipients: [{ index: 1, name: 'Anna', language: 'fr', email: 'a@example.org', link: null }] },
      confirmations: [{ role: 'recipient', index: 1, confirmation: 'confirmed' }], events: [{ at: CHAIN_NOW - 86_400, kind: 'reminder_sent' }] }; },
    patch: async () => { log.events.push('patch'); return {}; },
    remove: async () => { log.events.push('remove'); return {}; },
  };
}

function harness(o: Parameters<typeof fakeOwner>[1] & { network?: Network; connected?: boolean; saved?: boolean } = {}) {
  const log: Log = { events: [], renews: [] };
  const cfg = testnet();
  const service = new MineService({ config: (n) => (n === 'testnet' ? cfg : null), driver: fakeOwner(log, o), messenger: () => fakeMessenger(log),
    storage: localStorage, now: () => CHAIN_NOW + 30 });
  let connected = o.connected ?? true;
  const app: MineApp = {
    service, network: () => 'testnet', io: { save: () => {}, print: () => {}, copy: async () => true },
    walletConnected: () => connected, connectWallet: async () => { connected = true; },
    drillAvailable: () => true, dialogParent: () => document.body,
  };
  if (o.saved !== false) {
    upsertSwitch(localStorage, { network: 'testnet', T, sender_label: 'Patrick', rhythm: 'P3M', messenger: true, created_at: CHAIN_NOW - 70 * 86_400,
      deadline: CHAIN_NOW + 20 * 86_400, recipients: [{ index: 1, name: 'Anna', language: 'fr' }] });
    localStorage.setItem(OWNER_CODE_KEY('testnet', T), newOwnerCode('testnet', T, (n) => new Uint8Array(n).fill(7)).code);
  }
  return { log, service, app };
}

const settle = async (): Promise<void> => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };

beforeEach(() => { document.body.replaceChildren(); localStorage.clear(); setLanguage('en'); });
afterEach(() => { setLanguage('en'); });

// ---- My switches -----------------------------------------------------------------------------------------------

test('ui_mine_card_ring_health_timeline_recipients', async () => {
  const { app } = harness();
  const el = mineScreen(app);
  document.body.append(el);
  await settle();
  const card = el.querySelector('article.dms-card')!;
  expect(card).not.toBeNull();
  expect(card.querySelector('.dms-ring')!.getAttribute('aria-label')).toContain(t('mine.ring_caption'));
  expect(card.querySelector('[data-health]')!.textContent).toContain(t('mine.headroom_sentence', { count: 2 }));
  const kinds = [...card.querySelectorAll('.dms-timeline [data-kind]')].map((e) => e.getAttribute('data-kind'));
  expect(kinds).toEqual(['create', 'event', 'deadline']);
  expect(card.querySelector('[data-recipient="1"]')!.getAttribute('data-state')).toBe('confirmed');
  for (const a of ['checkin', 'away', 'settings', 'change', 'cancel', 'download']) expect(card.querySelector(`[data-action="${a}"]`), a).not.toBeNull();
  // the drill entry on testnet
  expect(el.querySelector('[data-drill="entry"] a')!.getAttribute('href')).toBe('#/drill');
});

test('ui_cancel_two_clicks', async () => {
  const { app, log } = harness();
  const el = mineScreen(app);
  document.body.append(el);
  await settle();
  const checkin = el.querySelector<HTMLButtonElement>('[data-action="checkin"]')!;
  const cancel = el.querySelector<HTMLButtonElement>('[data-action="cancel"]')!;
  // not smaller than Check in: the same size classes, and a real button
  for (const c of [...checkin.classList].filter((c) => !c.startsWith('dms-button--'))) expect(cancel.classList.contains(c), c).toBe(true);
  // click 1: the dialog with the consequence
  cancel.click();
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.querySelector('[data-consequence]')!.textContent).toBe(MESSAGES.en['cancel.consequence']);
  expect(log.events).not.toContain('cancel');
  // click 2: one signature, then the messenger deletes the data
  dialog.querySelector<HTMLButtonElement>('[data-action="cancel-confirm"]')!.click();
  await settle();
  expect(log.events.filter((e) => e === 'cancel')).toHaveLength(1);
  expect(log.events.indexOf('remove')).toBeGreaterThan(log.events.indexOf('cancel'));
  expect(el.textContent).toContain(MESSAGES.en['cancel.done']);
});

test('ui_cancel_keep_does_nothing', async () => {
  const { app, log } = harness();
  const el = mineScreen(app);
  document.body.append(el);
  await settle();
  el.querySelector<HTMLButtonElement>('[data-action="cancel"]')!.click();
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] .dms-dialog__actions button')];
  buttons.find((b) => b.textContent === MESSAGES.en['cancel.keep'])!.click();
  await settle();
  expect(log.events).not.toContain('cancel');
});

test('ui_mine_checkin_renews_chain_time_plus_rhythm', async () => {
  const { app, log } = harness();
  const el = mineScreen(app);
  document.body.append(el);
  await settle();
  el.querySelector<HTMLButtonElement>('[data-action="checkin"]')!.click();
  await settle();
  expect(log.renews).toEqual([addRhythm(CHAIN_NOW, { kind: 'months', months: 3 })]);
  expect(loadSwitches(localStorage)[0]!.deadline).toBe(log.renews[0]);
});

test('ui_mine_add_by_T_and_restore_from_owner_code', async () => {
  const { app, service } = harness({ saved: false });
  const el = mineScreen(app);
  document.body.append(el);
  expect(el.textContent).toContain(MESSAGES.en['mine.empty']);
  const tInput = el.querySelector<HTMLInputElement>('[data-k="add-T"]')!;
  tInput.value = 'zz';
  el.querySelector<HTMLButtonElement>('[data-action="add"]')!.click();
  expect(el.textContent).toContain(MESSAGES.en['mine.id_invalid']);
  const T2 = '0x' + '6b'.repeat(32);
  const code = newOwnerCode('testnet', T2, (n) => new Uint8Array(n).fill(3)).code;
  await service.restoreFromCode(code, T2.slice(2).toUpperCase());
  expect(localStorage.getItem(OWNER_CODE_KEY('testnet', T2))).toBe(code);
  expect(loadSwitches(localStorage).map((s) => s.T)).toEqual([T2]);
  await expect(service.restoreFromCode(code, T)).rejects.toThrow(/another switch/);
});

// ---- phone check-in --------------------------------------------------------------------------------------------

test('ui_checkin_deeplink', async () => {
  const route = parseHash(`#/checkin?network=testnet&T=${T}&rhythm=P3M`);
  expect(route.id).toBe('checkin');
  expect(parseCheckinLink(route.query)).toEqual({ network: 'testnet', T, rhythm: { kind: 'months', months: 3 } });
  expect(parseCheckinLink(new URLSearchParams(`network=moon&T=${T}&rhythm=P3M`))).toBeNull();
  expect(parseCheckinLink(new URLSearchParams(`network=testnet&T=0x12&rhythm=P3M`))).toBeNull();
  expect(parseCheckinLink(new URLSearchParams(`network=testnet&T=${T}&rhythm=3`))).toBeNull();
  expect(parseCheckinLink(new URLSearchParams(`network=testnet&T=${T}&rhythm=PT30M`))!.rhythm).toEqual({ kind: 'minutes', minutes: 30 });

  // the owner: the new deadline is chain time + rhythm; one button, one renew
  {
    const { app, log } = harness({ saved: false });
    const el = checkinScreen(route.query, app);
    document.body.append(el);
    await settle();
    const expected = addRhythm(CHAIN_NOW, { kind: 'months', months: 3 });
    expect(Number(el.querySelector('[data-new-deadline]')!.getAttribute('data-new-deadline'))).toBe(expected);
    const btn = el.querySelector<HTMLButtonElement>('[data-action="checkin"]')!;
    expect(btn.textContent).toBe(t('checkin.button', { deadline: formatDate(expected) }));
    expect(btn.disabled).toBe(false);
    btn.click();
    await settle();
    expect(log.renews).toEqual([expected]);
    expect(el.textContent).toContain(t('checkin.done', { deadline: formatDate(expected) }));
    el.remove();
  }
  // another wallet: refused with checkin.not_owner
  {
    document.body.replaceChildren();
    const { app, log } = harness({ saved: false, wallet: '0x' + '11'.repeat(32) });
    const el = checkinScreen(route.query, app);
    document.body.append(el);
    await settle();
    expect(el.querySelector('[data-owner="no"]')!.textContent).toBe(MESSAGES.en['checkin.not_owner']);
    const btn = el.querySelector<HTMLButtonElement>('[data-action="checkin"]')!;
    expect(btn.disabled).toBe(true);
    btn.click();
    await settle();
    expect(log.renews).toEqual([]);
  }
  // no wallet yet: the button connects first
  {
    document.body.replaceChildren();
    const { app } = harness({ saved: false, connected: false });
    const el = checkinScreen(route.query, app);
    document.body.append(el);
    await settle();
    expect(el.querySelector('[data-action="checkin"]')!.textContent).toBe(MESSAGES.en['checkin.connect']);
  }
  // a broken link explains
  expect(checkinScreen(new URLSearchParams('T=1'), harness({ saved: false }).app).textContent).toContain(MESSAGES.en['checkin.bad_link']);
});

// ---- away until ------------------------------------------------------------------------------------------------

test('ui_away_until', async () => {
  const now = CHAIN_NOW + 30;
  const b = awayBounds(now);
  const today = new Date(now * 1000);
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const pad = (n: number) => String(n).padStart(2, '0');
  expect(b.min).toBe(`${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`);
  expect(b.max.slice(0, 4)).toBe(String(today.getFullYear() + 5));
  expect(() => awayDeadline(`${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`, now)).toThrow(/tomorrow/);
  expect(() => awayDeadline(`${today.getFullYear() + 6}-01-01`, now)).toThrow(/five years/);
  expect(() => awayDeadline('2027-02-30', now)).toThrow();

  const { app, log } = harness();
  const el = mineScreen(app);
  document.body.append(el);
  await settle();
  el.querySelector<HTMLButtonElement>('[data-action="away"]')!.click();
  const dialog = document.querySelector('[role="dialog"]')!;
  const date = dialog.querySelector<HTMLInputElement>('input[type="date"]')!;
  expect(date.min).toBe(b.min);
  expect(date.max).toBe(b.max);
  const chosen = '2026-08-14';
  date.value = chosen;
  date.dispatchEvent(new Event('input'));
  const go = dialog.querySelector<HTMLButtonElement>('[data-action="away-confirm"]')!;
  expect(go.disabled).toBe(false);
  go.click();
  await settle();
  // the Renew deadline is the chosen date at 12:00 local time, in unix seconds
  expect(log.renews).toEqual([Math.floor(new Date(2026, 7, 14, 12, 0, 0).getTime() / 1000)]);
});

// ---- fire drill ------------------------------------------------------------------------------------------------

function drillApp(config: Config): WriteApp {
  const session = new WriteSession({ config: () => config, driver: null, messenger: null, drill: true, now: () => CHAIN_NOW, storage: null });
  return { session, io: { save: () => {}, print: () => {}, copy: async () => true }, navigate: () => {} };
}

test('ui_drill_bounds', () => {
  const app = drillApp(testnet());
  const s = app.session;
  expect(s.drill).toBe(true);
  expect(s.setDrillTerm(29 * 60)).toBe(false);
  expect(s.setDrillTerm(49 * 3600)).toBe(false);
  expect(s.setDrillTerm(30 * 60)).toBe(true);
  expect(s.termSeconds()).toBe(30 * 60);
  expect(s.setDrillTerm(48 * 3600)).toBe(true);
  expect(s.termSeconds()).toBe(48 * 3600);
  expect(rhythmIso(s.rhythm)).toBe('PT2880M');
  expect(parseRhythmIso('PT2880M')).toEqual(s.rhythm);
  // the check interval is fixed to drill.heartbeat_blocks; "tell them now" forced on
  expect(s.heartbeat).toBe(testnetRaw.drill.heartbeat_blocks);
  s.setHeartbeat(56_000);
  expect(s.heartbeat).toBe(testnetRaw.drill.heartbeat_blocks);
  expect(s.recipients[0]!.tellNow).toBe(true);

  // the term screen: presets, custom minutes refused / accepted, both dates, the ribbon
  const el = writeScreen('rhythm', app, { drill: true });
  document.body.append(el);
  expect(el.querySelector('.dms-ribbon')!.textContent).toBe(MESSAGES.en['drill.ribbon']);
  const presets = [...el.querySelectorAll<HTMLInputElement>('input[type="radio"]')].map((r) => r.value);
  expect(presets).toEqual([...testnetRaw.drill.presets_minutes.map((m: number) => String(m * 60)), 'custom']);
  el.querySelector<HTMLInputElement>('input[value="custom"]')!.click();
  const minutes = el.querySelector<HTMLInputElement>('[data-k="drill-minutes"]')!;
  const next = [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === MESSAGES.en['action.next'])!;
  const typeMin = (m: number): void => { minutes.value = String(m); minutes.dispatchEvent(new Event('input')); };
  typeMin(29);
  expect(next.disabled).toBe(true);
  expect(el.querySelector('.dms-field__error')!.textContent).not.toBe('');
  typeMin(49 * 60);
  expect(next.disabled).toBe(true);
  typeMin(30);
  expect(next.disabled).toBe(false);
  expect(s.termSeconds()).toBe(1800);
  typeMin(48 * 60);
  expect(next.disabled).toBe(false);
  const deadline = s.deadlineFrom();
  const opens = drillOpensAt(deadline, testnetRaw.drill.heartbeat_blocks);
  const dates = el.querySelector('[data-drill="dates"]')!.textContent!;
  expect(dates).toContain(formatDate(opens.earliest));
  expect(dates).toContain(formatDate(opens.latest));
  // every drill screen carries the ribbon
  for (const step of ['letters', 'recipients', 'guardians', 'price', 'create']) {
    expect(writeScreen(step, app, { drill: true }).querySelector('.dms-ribbon'), step).not.toBeNull();
  }
});

const fakeFetch = (files: Record<string, unknown>) => async (url: string) => {
  const body = files[url];
  return { ok: body !== undefined, status: body === undefined ? 404 : 200, json: async () => body };
};

test('ui_drill_hidden_on_mainnet', async () => {
  const net: NetworkState = await loadNetworks(fakeFetch({ '/app/config/testnet.json': testnetRaw, '/app/config/mainnet.json': { ...mainnetRaw, enabled: true } }));
  net.current = 'mainnet';
  const home = screenFor(parseHash('#/'), net);
  expect(home.querySelector('a[href="#/drill"]')).toBeNull();
  for (const hash of ['#/drill', '#/drill/letters', '#/drill/rhythm', '#/drill/report?T=' + T]) {
    const el = screenFor(parseHash(hash), net);
    expect(el.querySelector('[data-drill="unavailable"]'), hash).not.toBeNull();
    expect(el.querySelector('.dms-ribbon'), hash).toBeNull();
    expect(el.querySelector('a[href="#/drill/letters"]'), hash).toBeNull();
  }
  expect(screenFor(parseHash('#/mine'), net).querySelector('[data-drill="entry"]')).toBeNull();
  // a drill session refuses to create on mainnet
  const s = new WriteSession({ config: () => net.configs.mainnet!, driver: null, messenger: null, drill: true, storage: null });
  expect(s.drillBounds()).toBeNull();
  expect(s.setDrillTerm(3600)).toBe(false);
  // testnet: the entry is there
  net.current = 'testnet';
  expect(screenFor(parseHash('#/drill'), net).querySelector('a[href="#/drill/letters"]')).not.toBeNull();
  expect(screenFor(parseHash('#/drill/letters'), net).querySelector('.dms-ribbon')).not.toBeNull();
});

test('ui_drill_report_timeline_and_checklist', async () => {
  const { app } = harness();
  upsertSwitch(localStorage, { network: 'testnet', T, drill: true });
  const el = drillReport(new URLSearchParams(`T=${T}`), app, true);
  document.body.append(el);
  await settle();
  expect(el.querySelector('.dms-ribbon')).not.toBeNull();
  expect(el.querySelectorAll('[data-report="timeline"] li').length).toBeGreaterThanOrEqual(2);
  expect(el.querySelectorAll('[data-report="checklist"] input[type="checkbox"]')).toHaveLength(5);
});

// ---- open and practice -----------------------------------------------------------------------------------------

test('ui_open_runs_vault_in_sandbox', async () => {
  const el = openScreen(new URLSearchParams(), { network: () => 'testnet', status: null, practice: null });
  document.body.append(el);
  const input = el.querySelector<HTMLInputElement>('input[type="file"]')!;
  const bad = new File(['<html>hello</html>'], 'x.html', { type: 'text/html' });
  Object.defineProperty(input, 'files', { value: [bad], configurable: true });
  input.dispatchEvent(new Event('change'));
  await vi.waitFor(() => expect(el.querySelector('[data-open="error"]')).not.toBeNull());
  expect(el.querySelector('iframe')).toBeNull();
  const d = descriptor();
  const block = (id: string, v: unknown) => `<script type="application/json" id="${id}">${JSON.stringify(v)}</script>`;
  const vault = `<html>${block('crt-descriptor', d)}${block('crt-envelopes', [])}${block('crt-application-data', { name: 'dead-man-switch', version: '2', payload: {} })}</html>`;
  Object.defineProperty(input, 'files', { value: [new File([vault], 'v.html', { type: 'text/html' })], configurable: true });
  input.dispatchEvent(new Event('change'));
  await vi.waitFor(() => expect(el.querySelector('iframe') ? 'frame' : el.querySelector('.dms-open__out')!.textContent).toBe('frame'));
  const frame = el.querySelector('iframe')!;
  expect(frame.getAttribute('sandbox')).toBe(VAULT_SANDBOX);
  expect(VAULT_SANDBOX).not.toContain('allow-same-origin');
  expect(frame.srcdoc).toBe(vault);
});

test('ui_open_status_by_T', async () => {
  const el = openScreen(new URLSearchParams(`T=${T}`), { network: () => 'testnet', practice: null,
    status: async () => ({ state: 'released', deadline: 1, chainTime: 2, secondsLeft: -1, headroom: null, ownerLockHash: null, armed: 0, nodeCount: 3 }) });
  await vi.waitFor(() => expect(el.querySelector('[data-status="released"]')).not.toBeNull());
});

test('ui_open_practice_vault', async () => {
  const el = practiceScreen({ network: () => 'testnet', status: null, practice: async () => ({ en: '<p>en</p>', fr: '<p>fr</p>', de: '<p>de</p>' }) });
  expect(el.querySelector('[data-practice]')!.textContent).toBe(MESSAGES.en['open.practice']);
  await vi.waitFor(() => expect(el.querySelector('iframe')).not.toBeNull());
  expect(el.querySelector('iframe')!.srcdoc).toBe('<p>en</p>');
});

// ---- privacy and languages -------------------------------------------------------------------------------------

test('ui_privacy_three_languages', () => {
  for (const lang of LANGUAGES) {
    setLanguage(lang);
    const el = privacyScreen('https://psawyer.de');
    expect(el.querySelector('h1')!.textContent).toBe(MESSAGES[lang]['privacy.title']);
    for (const k of PRIVACY_SECTIONS) {
      const text = el.querySelector(`[data-privacy="${k}"]`)!.textContent!;
      expect(text.length, `${lang} ${k}`).toBeGreaterThan(40);
      expect(text).toBe(MESSAGES[lang][`privacy.${k}.text`]);
    }
    expect(el.querySelector<HTMLAnchorElement>('[data-privacy="contact"] a')!.href).toBe('https://psawyer.de/');
  }
  expect(privacyScreen('javascript:alert(1)').querySelector('[data-privacy="contact"] a')).toBeNull();
});

test('ui_phase3_screens_render_three_languages', async () => {
  for (const lang of LANGUAGES) {
    setLanguage(lang);
    document.body.replaceChildren();
    localStorage.clear();
    const { app } = harness();
    const mine = mineScreen(app);
    document.body.append(mine);
    await settle();
    expect(mine.querySelector('h1')!.textContent).toBe(MESSAGES[lang]['mine.title']);
    expect(mine.querySelector('[data-action="checkin"]')!.textContent).toBe(MESSAGES[lang]['mine.checkin']);
    const ck = checkinScreen(new URLSearchParams(`network=testnet&T=${T}&rhythm=P1M`), app);
    expect(ck.querySelector('h1')!.textContent).toBe(MESSAGES[lang]['checkin.title']);
  }
});
