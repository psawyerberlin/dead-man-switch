// Which network the app runs on. Testnet always; mainnet only once `config/mainnet.json` validates with
// `enabled: true` (SPEC.md §3.8). The configs are fetched at runtime (`/app/config/<network>.json`).
import { type Config, type FetchFn, type Network, loadConfig } from '../core/config';

export interface NetworkState {
  current: Network;
  configs: Partial<Record<Network, Config>>;
  /** why a network's config could not be used (shown instead of its features) */
  errors: Partial<Record<Network, string>>;
  mainnetEnabled: boolean;
}

export async function loadNetworks(fetchFn: FetchFn): Promise<NetworkState> {
  const state: NetworkState = { current: 'testnet', configs: {}, errors: {}, mainnetEnabled: false };
  await Promise.all((['testnet', 'mainnet'] as const).map(async (n) => {
    try { state.configs[n] = await loadConfig(n, fetchFn); } catch (e) { state.errors[n] = (e as Error).message; }
  }));
  state.mainnetEnabled = state.configs.mainnet?.enabled === true;
  return state;
}

/** Switches only to a network that is enabled; returns whether it switched. */
export function selectNetwork(state: NetworkState, n: Network): boolean {
  if (n === 'mainnet' && !state.mainnetEnabled) return false;
  if (!state.configs[n]) return false;
  state.current = n;
  return true;
}
