// The application shell: skip link, header, the routed screen in <main>, footer. Every route of the app is
// listed here (`#/write`, `#/mine`, `#/checkin`, `#/open`, `#/open/demo`, `#/drill`, `#/drill/report`, `#/guide`,
// `#/privacy`, `#/about`); the screens of phases 2 and 3 replace the placeholders.
import { setLanguage, t, getLanguage, type Language } from '../core/i18n';
import { h, mount } from './dom';
import { header, rememberLanguage } from './header';
import type { NetworkState } from './network';
import { parseHash, startRouter, type Route } from './router';
import { homeScreen } from './screens/home';
import { notFoundScreen, placeholderScreen } from './screens/placeholder';
import { stepOf, stepper } from './components/stepper';
import type { Wallet } from './wallet';

export interface ShellDeps {
  root: HTMLElement;
  network: NetworkState;
  wallet: Wallet;
  win?: Window;
}

/** The screen for a route (pure: builds DOM, no side effects). */
export function screenFor(route: Route, network: NetworkState): HTMLElement {
  switch (route.id) {
    case 'home': return homeScreen(network.current);
    case 'write': {
      const s = placeholderScreen('nav.write');
      s.prepend(stepper({ current: stepOf(route.param ?? 'letters') }));
      return s;
    }
    case 'mine': return placeholderScreen('mine.title');
    case 'checkin': return placeholderScreen('checkin.title');
    case 'open': return placeholderScreen('open.title');
    case 'open-demo': return placeholderScreen('open.practice_link');
    case 'drill': return placeholderScreen('drill.title', { drill: true });
    case 'drill-report': return placeholderScreen('drill.report_title', { drill: true });
    case 'guide': return placeholderScreen('guide.title');
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

  const renderScreen = (): void => {
    mount(main, screenFor(route, deps.network));
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
