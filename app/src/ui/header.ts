// The header: name, main navigation, language switch (en / fr / de, remembered), theme toggle, network badge
// (testnet; mainnet greyed with the SPEC.md §3.8 text) and the wallet (connect / disconnect, balance, faucet).
import { formatCkb, getLanguage, LANGUAGE_STORAGE_KEY, LANGUAGES, MESSAGES, t, type Language } from '../core/i18n';
import { button } from './components/button';
import { icon } from './components/icons';
import { h, mount, nextId } from './dom';
import type { NetworkState } from './network';
import { themeToggle } from './theme';
import { shortAddress, type Wallet } from './wallet';

export interface HeaderDeps {
  network: NetworkState;
  wallet: Wallet;
  /** re-renders the page in the new language */
  onLanguage(lang: Language): void;
}

export function rememberLanguage(lang: Language): void {
  try { globalThis.localStorage?.setItem(LANGUAGE_STORAGE_KEY, lang); } catch { /* not remembered */ }
}

export function languageSwitch(onLanguage: (l: Language) => void): HTMLElement {
  const current = getLanguage();
  const buttons = LANGUAGES.map((l) => {
    const b = h('button', { type: 'button', class: 'dms-lang__option', lang: l, 'aria-pressed': String(l === current),
      'aria-label': MESSAGES[l]['app.language_name'] }, l.toUpperCase());
    b.addEventListener('click', () => { if (l !== getLanguage()) onLanguage(l); });
    return b;
  });
  return h('div', { class: 'dms-lang', role: 'group', 'aria-label': t('app.language') }, ...buttons);
}

export function networkBadge(state: NetworkState): HTMLElement {
  const noteId = nextId('net');
  const testnet = h('span', { class: `dms-badge dms-badge--testnet${state.current === 'testnet' ? ' is-current' : ''}` },
    h('span', { class: 'dms-badge__dot', 'aria-hidden': 'true' }), t('app.network.testnet'));
  const mainnet = state.mainnetEnabled
    ? h('span', { class: `dms-badge dms-badge--mainnet${state.current === 'mainnet' ? ' is-current' : ''}` }, t('app.network.mainnet'))
    : h('span', { class: 'dms-badge dms-badge--mainnet is-disabled', 'aria-disabled': 'true', 'aria-describedby': noteId, title: t('app.network.mainnet_disabled') },
      t('app.network.mainnet'));
  return h('div', { class: 'dms-network', role: 'group', 'aria-label': t('app.network.label') }, testnet, mainnet,
    state.mainnetEnabled ? null : h('span', { id: noteId, class: 'dms-visually-hidden' }, t('app.network.mainnet_disabled')));
}

export function walletArea(wallet: Wallet, network: NetworkState): HTMLElement {
  const root = h('div', { class: 'dms-wallet', 'aria-live': 'polite' });
  let seen = false;
  const render = (): void => {
    // the header is rebuilt on a language change: an old, detached area stops listening
    if (root.isConnected) seen = true;
    else if (seen) { unsubscribe(); return; }
    const st = wallet.state;
    const faucet = network.current === 'testnet' ? network.configs.testnet?.faucet_url ?? null : null;
    const faucetLink = faucet ? h('a', { href: faucet, class: 'dms-wallet__faucet', rel: 'noopener noreferrer', target: '_blank' }, t('wallet.faucet')) : null;
    if (st.status === 'connected' && st.address) {
      mount(root,
        h('span', { class: 'dms-wallet__who' }, h('span', { class: 'dms-visually-hidden' }, `${t('wallet.connected')}: `),
          h('code', { class: 'dms-mono', title: st.address }, shortAddress(st.address))),
        h('span', { class: 'dms-wallet__balance' }, st.balance === null ? t('wallet.balance_unknown')
          : t('wallet.balance', { amount: formatCkb(st.balance, getLanguage(), { unit: false }) })),
        faucetLink,
        button(t('wallet.disconnect'), { kind: 'quiet', onClick: () => void wallet.disconnect() }));
    } else {
      const connect = button(st.status === 'connecting' ? t('wallet.connecting') : t('wallet.connect'),
        { kind: 'secondary', disabled: st.status === 'connecting', onClick: () => void wallet.connect() });
      mount(root, connect, faucetLink, st.error ? h('span', { class: 'dms-wallet__error', role: 'alert' }, t('wallet.error', { message: st.error })) : null);
    }
  };
  const unsubscribe = wallet.subscribe(render);
  render();
  return root;
}

export function header(deps: HeaderDeps): HTMLElement {
  const nav = h('nav', { class: 'dms-nav', 'aria-label': t('nav.label') },
    h('a', { href: '#/write' }, t('nav.write')),
    h('a', { href: '#/mine' }, t('nav.mine')),
    h('a', { href: '#/open' }, t('nav.open')),
    h('a', { href: '#/guide' }, t('nav.guide')),
    h('a', { href: '#/about' }, t('nav.about')));
  return h('header', { class: 'dms-header' },
    h('div', { class: 'dms-header__top' },
      h('a', { href: '#/', class: 'dms-brand' }, h('span', { class: 'dms-brand__mark', 'aria-hidden': 'true' }, icon('seal', 28)),
        h('span', { class: 'dms-brand__name' }, t('app.name'))),
      h('div', { class: 'dms-header__tools' }, languageSwitch(deps.onLanguage), themeToggle(), networkBadge(deps.network))),
    h('div', { class: 'dms-header__bar' }, nav, walletArea(deps.wallet, deps.network)));
}

