// Browser entry: fonts and styles, theme and language before the first paint, networks, wallet, shell.
import '@fontsource-variable/fraunces/wght.css';
import './ui/tokens.css';
import './ui/base.css';
import './ui/components.css';
import { detectLanguage, setLanguage, t } from './core/i18n';
import type { FetchFn } from './core/config';
import { loadNetworks } from './ui/network';
import { startShell } from './ui/shell';
import { applyTheme, loadTheme } from './ui/theme';
import { cccDriver, Wallet } from './ui/wallet';

const store = (): Storage | null => { try { return window.localStorage; } catch { return null; } };

async function boot(): Promise<void> {
  applyTheme(loadTheme(store()));
  setLanguage(detectLanguage(window.location.hash.includes('?') ? window.location.hash : window.location.search, store(), navigator.languages));
  const root = document.getElementById('app');
  if (!root) return;
  const fetchFn: FetchFn = (url) => fetch(url, { credentials: 'same-origin' });
  const network = await loadNetworks(fetchFn);
  const icon = new URL('favicon.svg', document.baseURI).href;
  const wallet = new Wallet(cccDriver(t('app.name'), icon), () => network.current);
  startShell({ root, network, wallet });
  void wallet.restore();
}

void boot();
