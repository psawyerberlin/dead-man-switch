// The application shell: skip link, header, the routed screen in <main>, footer. Every route of the app is
// listed here (`#/write`, `#/mine`, `#/checkin`, `#/open`, `#/open/demo`, `#/drill`, `#/drill/report`, `#/guide`,
// `#/privacy`, `#/about`), with `#/write/<step>`, `#/drill/<step>` and `#/guide/<place>`.
import { setLanguage, t, getLanguage, type Language } from '../core/i18n';
import { h, mount } from './dom';
import { header, rememberLanguage } from './header';
import type { NetworkState } from './network';
import { parseHash, startRouter, type Route } from './router';
import { browserIO, type WriteIO } from './files';
import { guideScreen } from './screens/guide';
import { homeScreen } from './screens/home';
import { notFoundScreen, placeholderScreen } from './screens/placeholder';
import { drillIntro, drillReport, drillUnavailable } from './screens/drill';
import { type OpenApp, openScreen, practiceScreen } from './screens/open';
import { privacyScreen } from './screens/privacy';
import { checkinScreen } from './mine/checkin';
import { mineScreen } from './mine/screen';
import { MineService, type OwnerDriver, type OwnerMessenger } from './mine/service';
import type { MineApp } from './mine/view';
import { drillBounds } from '../core/drill';
import type { Wallet } from './wallet';
import { writeScreen } from './write/flow';
import { type MessengerLike, type SwitchDriver, WriteSession } from './write/session';
import type { WriteApp } from './write/view';
import type { Config, CrtFiles } from '../core/config';

export interface ShellDeps {
  root: HTMLElement;
  network: NetworkState;
  wallet: Wallet;
  win?: Window;
  /** chain side of the Write flow (null: Write can be filled in but not created) */
  driver?: SwitchDriver | null;
  messenger?: ((config: Config) => MessengerLike | null) | null;
  /** the vendored CRT files of the current network, once loaded */
  crt?: () => CrtFiles | null;
  io?: WriteIO;
  /** chain side of My switches, the phone check-in and the status on `#/open` */
  owner?: OwnerDriver | null;
  /** the messenger as the owner uses it after Create (GET, PATCH, DELETE) */
  ownerMessenger?: ((config: Config) => OwnerMessenger | null) | null;
  /** the practice vaults by language (`virtual:dms-practice`) */
  practice?: (() => Promise<Record<Language, string>>) | null;
  storage?: Storage | null;
}

export interface AppServices {
  write: WriteApp;
  /** the fire drill's own Write session */
  drill: WriteApp;
  mine: MineApp;
  open: OpenApp;
}

/** A fire drill is offered on this network (testnet with a drill configuration; never mainnet). */
export function drillAvailable(network: NetworkState): boolean {
  const cfg = network.configs[network.current];
  if (!cfg) return false;
  try { drillBounds(cfg); return true; } catch { return false; }
}

/** The services of the screens: one Write session (and one drill session) per page load (state in memory only, SPEC.md §3.1). */
export function appServices(network: NetworkState, deps: Partial<Omit<ShellDeps, 'root' | 'network' | 'win'>> = {}): AppServices {
  const config = (): Config | null => network.configs[network.current] ?? null;
  const walletConnected = (): boolean => deps.wallet?.state.status === 'connected';
  const connectWallet = deps.wallet ? () => deps.wallet!.connect() : undefined;
  const io = deps.io ?? browserIO();
  const storage = deps.storage === undefined ? safeStorage() : deps.storage;
  const writeApp = (drill: boolean): WriteApp => ({
    session: new WriteSession({ config, crt: deps.crt, driver: deps.driver ?? null, messenger: deps.messenger ?? null, walletConnected, drill,
      ...(storage !== undefined ? { storage } : {}) }),
    io, walletConnected, connectWallet,
  });
  const write = writeApp(false);
  const drill = writeApp(true);
  const blockSeconds = (): number | undefined => {
    const b = (deps.crt?.()?.deployment as { block_seconds?: unknown } | undefined)?.block_seconds;
    return typeof b === 'number' ? b : undefined;
  };
  const driver = deps.driver ?? null;
  const service = new MineService({
    config: (n) => network.configs[n] ?? null, driver: deps.owner ?? null, messenger: deps.ownerMessenger ?? null, storage, blockSeconds,
    wrap: driver ? (c, K, d) => driver.wrap(c, K, d) : null,
  });
  deps.wallet?.subscribe(() => service.changed());
  const owner = deps.owner ?? null;
  return {
    write, drill,
    mine: { service, network: () => network.current, io, walletConnected, connectWallet, sessions: () => [write.session, drill.session],
      drillAvailable: () => drillAvailable(network) },
    open: {
      network: () => network.current,
      status: owner ? (n, T) => { const c = network.configs[n]; return c ? owner.summary(c, T) : Promise.reject(new Error('no configuration')); } : null,
      practice: deps.practice ?? null,
    },
  };
}

function safeStorage(): Storage | null {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

/** The screen for a route (pure: builds DOM, no side effects). */
export function screenFor(route: Route, network: NetworkState, app: AppServices = appServices(network)): HTMLElement {
  switch (route.id) {
    case 'home': return homeScreen(network.current);
    case 'write': return writeScreen(route.param, app.write);
    case 'mine': return mineScreen(app.mine);
    case 'checkin': return checkinScreen(route.query, app.mine);
    case 'open': return openScreen(route.query, app.open);
    case 'open-demo': return practiceScreen(app.open);
    case 'drill': {
      if (!drillAvailable(network)) return drillUnavailable();
      return route.param ? writeScreen(route.param, app.drill, { drill: true }) : drillIntro(true);
    }
    case 'drill-report': return drillReport(route.query, app.mine, drillAvailable(network));
    case 'guide': return guideScreen(route.param);
    case 'privacy': return privacyScreen(network.configs[network.current]?.operator_contact ?? null);
    case 'about': {
      const site = `/${getLanguage()}/`;
      return placeholderScreen('about.title', { extra: [h('p', {}, h('a', { href: site }, t('about.site')))] });
    }
    default: return notFoundScreen();
  }
}

function footer(): HTMLElement {
  return h('footer', { class: 'dms-footer' },
    h('p', { class: 'dms-footer__note' }, t('shell.footer_note')),
    h('nav', { class: 'dms-footer__nav', 'aria-label': t('nav.label') },
      h('a', { href: '#/privacy' }, t('nav.privacy')),
      h('a', { href: '#/about' }, t('nav.about')),
      h('a', { href: '#/open/demo' }, t('open.practice_link'))));
}

/** Mounts the shell into `root` and starts the router. Returns the function that stops it. */
export function startShell(deps: ShellDeps): () => void {
  const win = deps.win ?? window;
  const doc = win.document;
  const main = h('main', { id: 'main', class: 'dms-main', tabindex: -1 });
  let route: Route = parseHash(win.location.hash);
  let first = true;
  const app = appServices(deps.network, deps);

  const renderScreen = (): void => {
    mount(main, screenFor(route, deps.network, app));
    const h1 = main.querySelector('h1');
    doc.title = h1?.textContent ? `${h1.textContent} · ${t('app.name')}` : t('app.name');
    if (!first) main.focus({ preventScroll: false });
    first = false;
  };
  const renderAll = (): void => {
    doc.documentElement.lang = getLanguage();
    mount(deps.root,
      h('a', { href: '#main', class: 'dms-skip', onclick: ((ev: Event) => { ev.preventDefault(); main.focus(); }) as EventListener }, t('shell.skip')),
      header({ network: deps.network, wallet: deps.wallet, onLanguage }),
      main,
      footer());
    renderScreen();
  };
  function onLanguage(lang: Language): void {
    setLanguage(lang);
    rememberLanguage(lang);
    renderAll();
  }
  renderAll();
  return startRouter((r) => { if (r.path !== route.path || r.query.toString() !== route.query.toString()) { route = r; renderScreen(); } }, win);
}
