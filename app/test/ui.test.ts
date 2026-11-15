// @vitest-environment jsdom
// Phase 1 of aiworker/03-dms-ui.md: tokens, components, illustrations, router, theme, header and home.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatCkb, MESSAGES, setLanguage } from '../src/core/i18n';
import type { Config } from '../src/core/config';
import { AA_LARGE, AA_TEXT, COLOUR_PAIRS, contrast, parseTokens, TOKEN_NAMES, trapFocus } from '../src/ui/a11y';
import { button, linkButton } from '../src/ui/components/button';
import { constellation, starPositions } from '../src/ui/components/constellation';
import { confirmDialog, openDialog } from '../src/ui/components/dialog';
import { field, input } from '../src/ui/components/field';
import { ribbon } from '../src/ui/components/ribbon';
import { ring, ringState } from '../src/ui/components/ring';
import { monogram, press, PRESS_CLASS, seal, waxPath } from '../src/ui/components/seal';
import { sheet } from '../src/ui/components/sheet';
import { STEPS, stepOf, stepper } from '../src/ui/components/stepper';
import { toast } from '../src/ui/components/toast';
import { ILLUSTRATIONS } from '../src/ui/illustrations';
import { loadNetworks, selectNetwork, type NetworkState } from '../src/ui/network';
import { parseHash, ROUTES } from '../src/ui/router';
import { screenFor, startShell } from '../src/ui/shell';
import { applyTheme, loadTheme, saveTheme, THEME_STORAGE_KEY, themeToggle } from '../src/ui/theme';
import { shortAddress, Wallet, type WalletDriver } from '../src/ui/wallet';

const here = dirname(fileURLToPath(import.meta.url));
const rd = (rel: string): string => readFileSync(join(here, rel), 'utf8');
const css = rd('../src/ui/tokens.css');
const testnetConfig = JSON.parse(rd('../public/config/testnet.json'));
const mainnetConfig = JSON.parse(rd('../public/config/mainnet.json'));

const fakeFetch = (files: Record<string, unknown>) => async (url: string) => {
  const body = files[url];
  return { ok: body !== undefined, status: body === undefined ? 404 : 200, json: async () => body };
};
const networks = (mainnetEnabled = false): Promise<NetworkState> => loadNetworks(fakeFetch({
  '/app/config/testnet.json': testnetConfig,
  '/app/config/mainnet.json': { ...mainnetConfig, enabled: mainnetEnabled },
}));

const fakeDriver = (address = 'ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsq0abcdef'): WalletDriver & { disconnected: number } => {
  const d = {
    disconnected: 0,
    connect: async () => ({ address, signer: {}, balance: async () => 1_234_567_000_000n, disconnect: async () => { d.disconnected++; } }),
    restore: async () => null,
  };
  return d;
};

beforeEach(() => {
  document.body.replaceChildren();
  document.documentElement.removeAttribute('data-theme');
  localStorage.clear();
  setLanguage('en');
});
afterEach(() => { vi.useRealTimers(); setLanguage('en'); });

// ---- tokens and contrast ---------------------------------------------------------------------------------------

test('ui_contrast_tokens', () => {
  expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
  expect(contrast('#FFFFFF', '#FFFFFF')).toBe(1);
  expect(contrast('#777', '#fff')).toBeCloseTo(4.48, 2);
  const tokens = parseTokens(css);
  // the exact values of SPEC.md §8
  expect(tokens.light).toEqual({ paper: '#F7F3EA', sheet: '#FFFDF8', ink: '#1C2333', 'ink-soft': '#4A5468', line: '#E2D9C6', seal: '#9E2B25',
    'seal-ink': '#FFFFFF', gold: '#8A6A2C', ok: '#2F6B4F', warn: '#8F5A0B', danger: '#9E2B25' });
  expect(tokens.dark).toEqual({ paper: '#14171F', sheet: '#1C2030', ink: '#ECE6D8', 'ink-soft': '#B4AE9F', line: '#2C3246', seal: '#E0675E',
    'seal-ink': '#14171F', gold: '#D2B26B', ok: '#7FC6A1', warn: '#E8B25A', danger: '#F08A80' });
  // the prefers-color-scheme block repeats the dark values
  const media = /@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
  for (const n of TOKEN_NAMES) expect(media, n).toContain(`--${n}: ${tokens.dark[n]};`);
  const failures: string[] = [];
  for (const theme of ['light', 'dark'] as const) {
    for (const p of COLOUR_PAIRS) {
      const ratio = contrast(tokens[theme][p.fg], tokens[theme][p.bg]);
      if (ratio < (p.large ? AA_LARGE : AA_TEXT)) failures.push(`${theme}: --${p.fg} on --${p.bg} = ${ratio.toFixed(2)} (${p.use})`);
    }
  }
  expect(failures).toEqual([]);
  // every pair the component styles use appears in COLOUR_PAIRS (colour on a background in the same rule)
  const styles = rd('../src/ui/components.css') + rd('../src/ui/base.css');
  const listed = new Set(COLOUR_PAIRS.map((p) => `${p.fg}/${p.bg}`));
  for (const rule of styles.matchAll(/\{([^}]*)\}/g)) {
    const fg = /(?:^|[;\s])color:\s*var\(--([a-z-]+)\)/.exec(rule[1]!)?.[1];
    const bg = /background:\s*var\(--([a-z-]+)\)/.exec(rule[1]!)?.[1];
    if (fg && bg) expect(listed.has(`${fg}/${bg}`), `${fg} on ${bg} in "${rule[1]!.trim().slice(0, 60)}"`).toBe(true);
  }
});

test('ui_fonts_self_hosted', () => {
  const pkg = JSON.parse(rd('../package.json'));
  expect(Object.keys(pkg.devDependencies)).toContain('@fontsource-variable/fraunces');
  expect(Object.keys(pkg.dependencies)).not.toContain('@fontsource-variable/fraunces');
  const main = rd('../src/main.ts');
  expect(main).toContain("import '@fontsource-variable/fraunces/wght.css'");
  const font = rd('../node_modules/@fontsource-variable/fraunces/wght.css');
  expect(font).toContain('font-display: swap');
  expect(font).toMatch(/\.woff2/);
  expect(css).toMatch(/--font-serif: 'Fraunces Variable'/);
  expect(css).toMatch(/--font-mono: ui-monospace/);
  expect(css).toMatch(/--fs-body: 17px/);
});

// ---- components ------------------------------------------------------------------------------------------------

test('ui_button_kinds', () => {
  let clicks = 0;
  const b = button('Go', { kind: 'primary', onClick: () => clicks++ });
  expect(b.className).toContain('dms-button--primary');
  expect(b.type).toBe('button');
  b.click();
  expect(clicks).toBe(1);
  expect(button('x').className).toContain('dms-button--secondary');
  expect(button('x', { kind: 'quiet', disabled: true }).disabled).toBe(true);
  const a = linkButton('Open', '#/open', { kind: 'quiet' });
  expect(a.getAttribute('href')).toBe('#/open');
  expect(a.className).toContain('dms-button--quiet');
  // 44 px touch targets for every button kind
  const styles = rd('../src/ui/components.css');
  expect(/\.dms-button \{[^}]*min-height: var\(--touch\)/.test(styles)).toBe(true);
  expect(css).toMatch(/--touch: 44px/);
  expect(sheet({ title: 'T', level: 1 }, 'body').querySelector('h1')?.textContent).toBe('T');
});

test('ui_field_label_hint_error', () => {
  const f = field({ label: 'Name', hint: 'As they know you', control: input({ name: 'n' }) });
  document.body.append(f.el);
  const control = f.el.querySelector('input')!;
  const label = f.el.querySelector('label')!;
  expect(label.htmlFor).toBe(control.id);
  expect(control.getAttribute('aria-describedby')).toBe(`${control.id}-hint`);
  f.setError('Required');
  expect(control.getAttribute('aria-invalid')).toBe('true');
  expect(control.getAttribute('aria-describedby')).toBe(`${control.id}-hint ${control.id}-error`);
  expect(f.el.querySelector<HTMLElement>('.dms-field__error')!.hidden).toBe(false);
  f.setError(null);
  expect(control.hasAttribute('aria-invalid')).toBe(false);
  expect(f.el.querySelector<HTMLElement>('.dms-field__error')!.hidden).toBe(true);
});

test('ui_stepper_seven_steps', () => {
  expect(STEPS.map((s) => s.id)).toEqual(['letters', 'recipients', 'rhythm', 'guardians', 'price', 'seal', 'handover']);
  expect(new Set(STEPS.map((s) => s.icon)).size).toBe(7);
  const el = stepper({ current: 'rhythm', hrefFor: (id) => `#/write/${id}` });
  const items = [...el.querySelectorAll('li')];
  expect(items).toHaveLength(7);
  expect(items.map((li) => li.className.match(/is-(\w+)/)![1])).toEqual(['done', 'done', 'current', 'upcoming', 'upcoming', 'upcoming', 'upcoming']);
  expect(items[2]!.getAttribute('aria-current')).toBe('step');
  expect(items[0]!.querySelector('a')!.getAttribute('href')).toBe('#/write/letters');
  expect(items[3]!.querySelector('a')).toBeNull();
  expect(el.querySelector('[aria-live]')!.textContent).toBe('Step 3 of 7: Rhythm');
  for (const li of items) expect(li.querySelector('svg')!.getAttribute('stroke')).toBe('currentColor');
  expect(stepOf('create')).toBe('seal');
  expect(stepOf('nonsense')).toBe('letters');
  setLanguage('de');
  expect(stepper({ current: 'seal' }).querySelector('[aria-live]')!.textContent).toBe('Schritt 6 von 7: Siegel');
});

test('ui_ring_text_inside', () => {
  const r = ring({ fraction: 0.5, value: '45 days', caption: 'until the deadline' });
  const arc = r.el.querySelector('.dms-ring__arc')!;
  const c = Number(arc.getAttribute('stroke-dasharray'));
  expect(Number(arc.getAttribute('stroke-dashoffset'))).toBeCloseTo(c / 2, 1);
  expect(r.el.querySelector('.dms-ring__value')!.textContent).toBe('45 days');
  expect(r.el.getAttribute('aria-label')).toBe('45 days — until the deadline');
  expect(r.el.getAttribute('data-state')).toBe('ok');
  r.update({ fraction: 0.05, value: '2 days' });
  expect(r.el.getAttribute('data-state')).toBe('warn');
  r.update({ fraction: 1 });
  expect(Number(arc.getAttribute('stroke-dashoffset'))).toBe(0);
  expect(ringState(0)).toBe('grace');
  expect(ringState(-1)).toBe('grace');
});

test('ui_seal_press', () => {
  expect(monogram('Anna Maria Weber')).toBe('AW');
  expect(monogram('élise')).toBe('É');
  expect(monogram('  ')).toBe('·');
  expect(waxPath(1)).not.toBe(waxPath(2));
  const el = seal({ name: 'Patrick Sawyer' });
  expect(el.querySelector('.dms-seal__monogram')!.textContent).toBe('PS');
  expect(el.getAttribute('aria-label')).toBe('Wax seal with the initials PS');
  vi.useFakeTimers();
  const motion = { matchMedia: () => ({ matches: false }) };
  const reduced = { matchMedia: (q: string) => ({ matches: q.includes('reduce') }) };
  expect(press(el, reduced)).toBe(false);
  expect(el.classList.contains(PRESS_CLASS)).toBe(false);
  expect(press(el, motion)).toBe(true);
  expect(el.classList.contains(PRESS_CLASS)).toBe(true);
  vi.advanceTimersByTime(700);
  expect(el.classList.contains(PRESS_CLASS)).toBe(false);
  const styles = rd('../src/ui/components.css');
  expect(styles).toMatch(/\.dms-seal--pressing \{ animation: dms-seal-press var\(--t-seal\)/);
  expect(css).toMatch(/--t-seal: 600ms/);
  expect(styles).toMatch(/prefers-reduced-motion: reduce\) \{ \.dms-seal--pressing \{ animation: none/);
});

test('ui_constellation_missing_fades', () => {
  const el = constellation([{ label: 'A', present: true }, { label: 'B', present: false }, { label: 'C', present: true, mandatory: true }]);
  expect(el.querySelectorAll('.dms-constellation__star')).toHaveLength(3);
  expect(el.querySelectorAll('.dms-constellation__line')).toHaveLength(3);
  expect(el.querySelectorAll('.is-missing')).toHaveLength(2); // the star and its line
  expect(el.querySelector('.is-missing title')!.textContent).toBe('B (missing)');
  expect(el.querySelector('.is-mandatory title')!.textContent).toBe('C (mandatory)');
  expect(el.getAttribute('aria-label')).toBe('3 guardians around the letter, 1 missing');
  const [top] = starPositions(4);
  expect(top![0]).toBeCloseTo(100);
  expect(top![1]).toBeCloseTo(26);
});

test('ui_ribbon_text', () => {
  expect(ribbon().textContent).toBe('Fire drill — testnet');
  setLanguage('fr');
  expect(ribbon().textContent).toBe('Exercice — testnet');
  expect(ribbon().getAttribute('role')).toBe('note');
});

test('ui_dialog_focus_trapped', async () => {
  const opener = button('open');
  document.body.append(opener);
  opener.focus();
  let closed = 0;
  const ok = button('OK');
  const no = button('No');
  const d = openDialog({ title: 'Sure?', body: ['text'], actions: [no, ok], onClose: () => closed++ });
  expect(d.el.getAttribute('role')).toBe('dialog');
  expect(d.el.getAttribute('aria-modal')).toBe('true');
  expect(document.getElementById(d.el.getAttribute('aria-labelledby')!)!.textContent).toBe('Sure?');
  expect(document.activeElement).toBe(no);
  // Tab from the last wraps to the first (the close button), Shift+Tab from the first wraps to the last
  ok.focus();
  ok.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
  expect(document.activeElement).toBe(d.el.querySelector('.dms-dialog__close'));
  (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
  expect(document.activeElement).toBe(ok);
  d.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(closed).toBe(1);
  expect(document.querySelector('[role=dialog]')).toBeNull();
  expect(document.activeElement).toBe(opener);
  d.close();
  expect(closed).toBe(1);
  // confirmDialog resolves with the button pressed
  const confirm = button('Cancel it', { kind: 'danger' });
  const keep = button('Keep');
  const p = confirmDialog({ title: 'Cancel?', body: [], confirm, keep });
  expect(document.activeElement).toBe(keep);
  confirm.click();
  await expect(p).resolves.toBe(true);
  const keep2 = button('Keep');
  const p2 = confirmDialog({ title: 'Cancel?', body: [], confirm: button('x'), keep: keep2 });
  keep2.click();
  await expect(p2).resolves.toBe(false);
  // trapFocus can be released
  const box = document.createElement('div');
  const release = trapFocus(box);
  release();
});

test('ui_toast_aria_live', () => {
  vi.useFakeTimers();
  const el = toast('Saved', { kind: 'ok' });
  const region = el.parentElement!;
  expect(region.getAttribute('aria-live')).toBe('polite');
  expect(region.getAttribute('role')).toBe('status');
  expect(el.textContent).toContain('Saved');
  toast('Again');
  expect(region.children).toHaveLength(2);
  const err = toast('Failed', { kind: 'error' });
  expect(err.parentElement!.getAttribute('aria-live')).toBe('assertive');
  vi.advanceTimersByTime(6500);
  expect(region.children).toHaveLength(0);
  expect(err.isConnected).toBe(true); // errors stay until closed
  err.querySelector('button')!.click();
  expect(err.isConnected).toBe(false);
});

test('ui_illustrations_line_drawings', () => {
  expect(Object.keys(ILLUSTRATIONS).sort()).toEqual(['calendar', 'envelope', 'keys', 'letter', 'people']);
  for (const [name, draw] of Object.entries(ILLUSTRATIONS)) {
    const el = draw();
    expect(el.getAttribute('stroke'), name).toBe('currentColor');
    expect(el.getAttribute('fill'), name).toBe('none');
    expect(el.getAttribute('aria-hidden'), name).toBe('true');
    expect(el.querySelectorAll('path, circle').length, name).toBeGreaterThan(2);
    expect(el.outerHTML, name).not.toMatch(/#[0-9a-f]{3,6}|<image|href=/i);
  }
});

// ---- shell -----------------------------------------------------------------------------------------------------

test('ui_router_routes', () => {
  for (const [hash, id] of Object.entries(ROUTES)) expect(parseHash(hash).id, hash).toBe(id);
  expect(Object.keys(ROUTES).sort()).toEqual(['#/', '#/about', '#/checkin', '#/drill', '#/drill/report', '#/guide', '#/mine', '#/open', '#/open/demo', '#/privacy', '#/write']);
  expect(parseHash('').id).toBe('home');
  expect(parseHash('#').id).toBe('home');
  expect(parseHash('#/write/rhythm')).toMatchObject({ id: 'write', param: 'rhythm' });
  expect(parseHash('#/guide/cloud_drive')).toMatchObject({ id: 'guide', param: 'cloud_drive' });
  const r = parseHash('#/checkin?network=testnet&T=0xabc&rhythm=3');
  expect(r.id).toBe('checkin');
  expect(r.query.get('T')).toBe('0xabc');
  expect(r.query.get('rhythm')).toBe('3');
  expect(parseHash('#/drill/report?T=0x1').id).toBe('drill-report');
  expect(parseHash('#/mine/').id).toBe('mine');
  expect(parseHash('#/nowhere').id).toBe('not-found');
  expect(parseHash('#/write/../x').id).toBe('not-found');
});

test('ui_theme_toggle_remembered', () => {
  expect(loadTheme(localStorage)).toBe('system');
  const ctl = themeToggle();
  document.body.append(ctl);
  const sel = ctl.querySelector('select')!;
  expect([...sel.options].map((o) => o.value)).toEqual(['system', 'light', 'dark']);
  expect(ctl.querySelector('label')!.htmlFor).toBe(sel.id);
  sel.value = 'dark';
  sel.dispatchEvent(new Event('change'));
  expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  expect(loadTheme(localStorage)).toBe('dark');
  sel.value = 'system';
  sel.dispatchEvent(new Event('change'));
  expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  saveTheme('light', localStorage);
  applyTheme(loadTheme(localStorage));
  expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  expect(loadTheme({ getItem: () => 'purple' })).toBe('system');
  expect(loadTheme({ getItem: () => { throw new Error('blocked'); } })).toBe('system');
  // the pre-paint script loaded by index.html uses the same key
  expect(rd('../index.html')).toContain('src="./theme-init.js"');
  expect(rd('../public/theme-init.js')).toContain(`localStorage.getItem('${THEME_STORAGE_KEY}')`);
});

test('ui_networks_mainnet_disabled_badge', async () => {
  const off = await networks(false);
  expect(off.current).toBe('testnet');
  expect(off.mainnetEnabled).toBe(false);
  expect(selectNetwork(off, 'mainnet')).toBe(false);
  expect(off.current).toBe('testnet');
  const on = await networks(true);
  expect(on.mainnetEnabled).toBe(true);
  expect(selectNetwork(on, 'mainnet')).toBe(true);
  const broken = await loadNetworks(fakeFetch({ '/app/config/testnet.json': testnetConfig }));
  expect(broken.mainnetEnabled).toBe(false);
  expect(broken.errors.mainnet).toMatch(/404/);
});

async function mountShell(opts: { mainnet?: boolean; hash?: string } = {}) {
  window.location.hash = opts.hash ?? '#/';
  const network = await networks(opts.mainnet);
  const driver = fakeDriver();
  const wallet = new Wallet(driver, () => network.current);
  const root = document.createElement('div');
  document.body.append(root);
  const stop = startShell({ root, network, wallet });
  return { root, network, wallet, driver, stop };
}

test('ui_shell_header_and_home', async () => {
  const { root, stop } = await mountShell();
  // header: language switch, theme toggle, network badge with mainnet greyed and the §3.8 text
  const langs = [...root.querySelectorAll<HTMLButtonElement>('.dms-lang__option')];
  expect(langs.map((b) => b.textContent)).toEqual(['EN', 'FR', 'DE']);
  expect(langs[0]!.getAttribute('aria-pressed')).toBe('true');
  expect(root.querySelector('.dms-header select')).not.toBeNull();
  const mainnet = root.querySelector('.dms-badge--mainnet')!;
  expect(mainnet.classList.contains('is-disabled')).toBe(true);
  expect(mainnet.getAttribute('aria-disabled')).toBe('true');
  expect(document.getElementById(mainnet.getAttribute('aria-describedby')!)!.textContent).toBe(MESSAGES.en['app.network.mainnet_disabled']);
  expect(root.querySelector('.dms-badge--testnet.is-current')!.textContent).toContain('Testnet');
  // home: one sentence, three entries, the practice vault for recipients
  const main = root.querySelector('main')!;
  expect(main.querySelector('h1')!.textContent).toBe(MESSAGES.en['app.tagline']);
  expect([...main.querySelectorAll('.dms-entry__link')].map((a) => a.getAttribute('href'))).toEqual(['#/write', '#/mine', '#/drill']);
  expect(main.querySelectorAll('.dms-entry__link.is-primary')).toHaveLength(1);
  expect(main.querySelector('a[href="#/open/demo"]')).not.toBeNull();
  expect(root.querySelector('footer a[href="#/privacy"]')).not.toBeNull();
  expect(document.title).toContain(MESSAGES.en['app.name']);
  stop();
});

test('ui_shell_language_remembered', async () => {
  const { root, stop } = await mountShell();
  root.querySelectorAll<HTMLButtonElement>('.dms-lang__option')[2]!.click();
  expect(document.documentElement.lang).toBe('de');
  expect(localStorage.getItem('dms.language')).toBe('de');
  expect(root.querySelector('main h1')!.textContent).toBe(MESSAGES.de['app.tagline']);
  expect(root.querySelector('.dms-nav a[href="#/write"]')!.textContent).toBe('Brief schreiben');
  expect(root.querySelectorAll<HTMLButtonElement>('.dms-lang__option')[2]!.getAttribute('aria-pressed')).toBe('true');
  root.querySelectorAll<HTMLButtonElement>('.dms-lang__option')[1]!.click();
  expect(document.documentElement.lang).toBe('fr');
  expect(root.querySelector('.dms-nav a[href="#/mine"]')!.textContent).toBe('Mes dispositifs');
  stop();
});

test('ui_shell_routes_render', async () => {
  const { root, stop } = await mountShell();
  const network = await networks(false);
  for (const hash of Object.keys(ROUTES)) {
    const el = screenFor(parseHash(hash), network);
    expect(el.querySelector('h1')?.textContent, hash).toBeTruthy();
  }
  expect(screenFor(parseHash('#/drill'), network).querySelector('.dms-ribbon')).not.toBeNull();
  expect(screenFor(parseHash('#/drill/report'), network).querySelector('.dms-ribbon')).not.toBeNull();
  expect(screenFor(parseHash('#/write/rhythm'), network).querySelector('[aria-current=step]')!.getAttribute('data-step')).toBe('rhythm');
  expect(screenFor(parseHash('#/nope'), network).querySelector('h1')!.textContent).toBe(MESSAGES.en['shell.not_found']);
  // the router swaps the screen on hashchange
  window.location.hash = '#/mine';
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  expect(root.querySelector('main h1')!.textContent).toBe(MESSAGES.en['mine.title']);
  expect(document.activeElement).toBe(root.querySelector('main'));
  stop();
});

test('ui_wallet_connect_balance_faucet', async () => {
  const { root, wallet, driver, stop } = await mountShell();
  const area = root.querySelector('.dms-wallet')!;
  expect(area.querySelector('button')!.textContent).toBe('Connect a wallet');
  expect(area.querySelector<HTMLAnchorElement>('a.dms-wallet__faucet')!.href).toBe(testnetConfig.faucet_url);
  area.querySelector('button')!.click();
  await vi.waitFor(() => expect(wallet.state.balance).toBe(1_234_567_000_000n));
  expect(area.querySelector('code')!.textContent).toBe(shortAddress(wallet.state.address!));
  expect(area.querySelector('.dms-wallet__balance')!.textContent).toBe(`Balance: ${formatCkb(1_234_567_000_000n, 'en', { unit: false })} CKB`);
  // the language switch rebuilds the header; the wallet stays connected
  root.querySelectorAll<HTMLButtonElement>('.dms-lang__option')[1]!.click();
  expect(root.querySelector('.dms-wallet__balance')!.textContent).toBe(`Solde : ${formatCkb(1_234_567_000_000n, 'fr', { unit: false })} CKB`);
  root.querySelector<HTMLButtonElement>('.dms-wallet button')!.click();
  await vi.waitFor(() => expect(wallet.state.status).toBe('disconnected'));
  expect(driver.disconnected).toBe(1);
  expect(root.querySelector('.dms-wallet button')!.textContent).toBe('Connecter un portefeuille');
  stop();
});

test('ui_wallet_error_shown', async () => {
  const network = await networks(false);
  const wallet = new Wallet({ connect: async () => { throw new Error('popup closed'); }, restore: async () => null }, () => network.current);
  await wallet.connect();
  expect(wallet.state).toMatchObject({ status: 'disconnected', error: 'popup closed' });
  expect(shortAddress('ckt1qzda0cr08m85hc8jlnfp3zer7xulejyw')).toBe('ckt1qzda…ulejyw');
});

test('ui_mainnet_enabled_badge_selectable', async () => {
  const { root, stop } = await mountShell({ mainnet: true });
  const mainnet = root.querySelector('.dms-badge--mainnet')!;
  expect(mainnet.classList.contains('is-disabled')).toBe(false);
  stop();
  const cfg: Config | undefined = (await networks(true)).configs.mainnet;
  expect(cfg?.enabled).toBe(true);
});
