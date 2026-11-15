// Browser entry: fonts and styles, theme and language before the first paint, networks, CRT files, wallet, shell.
import '@fontsource-variable/fraunces/wght.css';
import './ui/tokens.css';
import './ui/base.css';
import './ui/components.css';
import './ui/write.css';
import './ui/mine.css';
import { detectLanguage, setLanguage, t } from './core/i18n';
import { type Config, type CrtFiles, type FetchFn, type Network, loadCrtFiles } from './core/config';
import { MessengerClient } from './core/messenger';
import { loadNetworks } from './ui/network';
import { startShell } from './ui/shell';
import { applyTheme, loadTheme } from './ui/theme';
import { cccDriver, Wallet } from './ui/wallet';
import type { SwitchDriver } from './ui/write/session';
import type { OwnerDriver } from './ui/mine/service';
import { setOpenerScript } from './core/vault';
import openerScript from 'virtual:dms-opener';

// Every vault built in this page carries the DMS opener (SPEC.md §4.3).
setOpenerScript(openerScript);

const store = (): Storage | null => { try { return window.localStorage; } catch { return null; } };

/** The chain driver is loaded on first use (its own chunk, with CCC). */
function lazyDriver(make: () => Promise<SwitchDriver>): SwitchDriver {
  let p: Promise<SwitchDriver> | null = null;
  const get = (): Promise<SwitchDriver> => (p ??= make());
  return {
    runners: async (c) => (await get()).runners(c),
    organiserLock: async (c) => (await get()).organiserLock(c),
    prepareCreate: async (i) => (await get()).prepareCreate(i),
    waitForCommits: async (c, T, n, f) => (await get()).waitForCommits(c, T, n, f),
    describe: async (c, plan, T) => (await get()).describe(c, plan, T),
    arm: async (c, T, d, params) => (await get()).arm(c, T, d, params),
    wrap: async (c, K, d) => (await get()).wrap(c, K, d),
  };
}

/** The owner's chain side, loaded on first use (its own chunk, with CCC). */
function lazyOwner(make: () => Promise<OwnerDriver>): OwnerDriver {
  let p: Promise<OwnerDriver> | null = null;
  const get = (): Promise<OwnerDriver> => (p ??= make());
  return {
    summary: async (c, T, d) => (await get()).summary(c, T, d),
    history: async (c, T) => (await get()).history(c, T),
    walletLockHash: async (c) => (await get()).walletLockHash(c),
    renew: async (c, T, d) => (await get()).renew(c, T, d),
    cancel: async (c, T) => (await get()).cancel(c, T),
    reclaim: async (c, T, r) => (await get()).reclaim(c, T, r),
  };
}

async function boot(): Promise<void> {
  applyTheme(loadTheme(store()));
  setLanguage(detectLanguage(window.location.hash.includes('?') ? window.location.hash : window.location.search, store(), navigator.languages));
  const root = document.getElementById('app');
  if (!root) return;
  const fetchFn: FetchFn = (url) => fetch(url, { credentials: 'same-origin' });
  const network = await loadNetworks(fetchFn);
  const crtFiles: Partial<Record<Network, CrtFiles>> = {};
  const crtOf = async (config: Config): Promise<CrtFiles> => (crtFiles[config.network] ??= await loadCrtFiles(config, fetchFn));
  const current = network.configs[network.current];
  if (current) await crtOf(current).catch(() => undefined);
  const rpcUrl = (n: Network): string | undefined => {
    const urls = (crtFiles[n]?.deployment as { rpc_urls?: unknown } | undefined)?.rpc_urls;
    return Array.isArray(urls) && typeof urls[0] === 'string' ? urls[0] : undefined;
  };
  const icon = new URL('favicon.svg', document.baseURI).href;
  const wallet = new Wallet(cccDriver(t('app.name'), icon, rpcUrl), () => network.current);
  const driver = lazyDriver(async () => (await import('./ui/write/chain-driver')).chainDriver({ signer: () => wallet.signer, crt: crtOf }));
  const messenger = (config: Config): MessengerClient | null => (config.notifier_url ? new MessengerClient(config.notifier_url) : null);
  const owner = lazyOwner(async () => (await import('./ui/mine/chain-owner')).chainOwner({ signer: () => wallet.signer, crt: crtOf }));
  const practice = async () => (await import('virtual:dms-practice')).default;
  startShell({ root, network, wallet, driver, messenger, ownerMessenger: messenger, owner, practice, crt: () => crtFiles[network.current] ?? null });
  void wallet.restore();
}

void boot();
