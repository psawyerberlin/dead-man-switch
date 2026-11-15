// The application shell: skip link, header, the routed screen in <main>, footer. Every route of the app is
// listed here (`#/write`, `#/mine`, `#/checkin`, `#/open`, `#/open/demo`, `#/drill`, `#/drill/report`, `#/guide`,
// `#/privacy`, `#/about`); Write (`#/write/<step>`) and the guides are real screens, the routes of phase 3 still placeholders.
import { setLanguage, t, getLanguage, type Language } from '../core/i18n';
import { h, mount } from './dom';
import { header, rememberLanguage } from './header';
import type { NetworkState } from './network';
import { parseHash, startRouter, type Route } from './router';
import { browserIO, type WriteIO } from './files';
import { guideScreen } from './screens/guide';
import { homeScreen } from './screens/home';
import { notFoundScreen, placeholderScreen } from './screens/placeholder';
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
}

export interface AppServices {
  write: WriteApp;
}

/** The services of the screens: one Write session per page load (state in memory only, SPEC.md §3.1). */
export function appServices(network: NetworkState, deps: Partial<Pick<ShellDeps, 'driver' | 'messenger' | 'crt' | 'io' | 'wallet'>> = {}): AppServices {
  const config = (): Config | null => network.configs[network.current] ?? null;
  const session = new WriteSession({ config, crt: deps.crt, driver: deps.driver ?? null, messenger: deps.messenger ?? null,
    walletConnected: () => deps.wallet?.state.status === 'connected' });
  return {
    write: {
      session,
      io: deps.io ?? browserIO(),
      walletConnected: () => deps.wallet?.state.status === 'connected',
      connectWallet: deps.wallet ? () => deps.wallet!.connect() : undefined,
    },
  };
}

/** The screen for a route (pure: builds DOM, no side effects). */
export function screenFor(route: Route, network: NetworkState, app: AppServices = appServices(network)): HTMLElement {
  switch (route.id) {
    case 'home': return homeScreen(network.current);
    case 'write': return writeScreen(route.param, app.write);
    case 'mine': return placeholderScreen('mine.title');
    case 'checkin': return placeholderScreen('checkin.title');
    case 'open': return placeholderScreen('open.title');
    case 'open-demo': return placeholderScreen('open.practice_link');
    case 'drill': return placeholderScreen('drill.title', { drill: true });
    case 'drill-report': return placeholderScreen('drill.report_title', { drill: true });
    case 'guide': return guideScreen(route.param);
    case 'privacy': return placeholderScreen('privacy.title');
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
