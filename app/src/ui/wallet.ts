// Wallet connection through CCC, JoyID connector first (SPEC.md §1). The CCC modules are loaded on demand (their
// own chunk), so the shell, the tests and the opener never pull them in. `Wallet` holds the state the header shows.
import type { Network } from '../core/config';

export interface WalletSession {
  address: string;
  /** shannons */
  balance(): Promise<bigint>;
  disconnect(): Promise<void>;
  /** the CCC signer, for the screens that sign (phase 2 and later) */
  signer: unknown;
}

export interface WalletDriver {
  /** opens the wallet's connect flow */
  connect(network: Network): Promise<WalletSession>;
  /** a session the wallet still remembers (no popup), or null */
  restore(network: Network): Promise<WalletSession | null>;
}

export interface WalletState {
  status: 'disconnected' | 'connecting' | 'connected';
  address: string | null;
  balance: bigint | null;
  error: string | null;
}

/** CCC + JoyID. `rpcUrl`: the CKB RPC of the CRT deployment (CCC's public default when absent). */
export function cccDriver(appName: string, appIcon: string, rpcUrl?: (network: Network) => string | undefined): WalletDriver {
  const open = async (network: Network, interactive: boolean): Promise<WalletSession | null> => {
    const [{ ccc }, { JoyId }] = await Promise.all([import('@ckb-ccc/core'), import('@ckb-ccc/joy-id')]);
    const url = rpcUrl?.(network);
    const client = network === 'mainnet' ? new ccc.ClientPublicMainnet(url ? { url } : undefined) : new ccc.ClientPublicTestnet(url ? { url } : undefined);
    const signer = new JoyId.CkbSigner(client, appName, appIcon);
    if (!(await signer.isConnected())) {
      if (!interactive) return null;
      await signer.connect();
    }
    const address = await signer.getRecommendedAddress();
    return {
      address,
      signer,
      balance: () => signer.getBalance(),
      disconnect: () => signer.disconnect(),
    };
  };
  return {
    connect: async (network) => (await open(network, true))!,
    restore: (network) => open(network, false),
  };
}

export class Wallet {
  state: WalletState = { status: 'disconnected', address: null, balance: null, error: null };
  private session: WalletSession | null = null;
  private listeners = new Set<(s: WalletState) => void>();

  constructor(private readonly driver: WalletDriver, private network: () => Network) {}

  subscribe(fn: (s: WalletState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(next: Partial<WalletState>): void {
    this.state = { ...this.state, ...next };
    for (const fn of this.listeners) fn(this.state);
  }

  get signer(): unknown {
    return this.session?.signer ?? null;
  }

  async connect(): Promise<void> {
    this.set({ status: 'connecting', error: null });
    try {
      this.session = await this.driver.connect(this.network());
      this.set({ status: 'connected', address: this.session.address });
      await this.refreshBalance();
    } catch (e) {
      this.session = null;
      this.set({ status: 'disconnected', address: null, balance: null, error: (e as Error).message || String(e) });
    }
  }

  async restore(): Promise<void> {
    try {
      const session = await this.driver.restore(this.network());
      if (!session) return;
      this.session = session;
      this.set({ status: 'connected', address: session.address, error: null });
      await this.refreshBalance();
    } catch { /* not remembered: stay disconnected */ }
  }

  async refreshBalance(): Promise<void> {
    if (!this.session) return;
    try { this.set({ balance: await this.session.balance() }); } catch { this.set({ balance: null }); }
  }

  async disconnect(): Promise<void> {
    const s = this.session;
    this.session = null;
    this.set({ status: 'disconnected', address: null, balance: null, error: null });
    try { await s?.disconnect(); } catch { /* already gone */ }
  }
}

/** `ckt1qz…abcd`: the first 8 and last 6 characters. */
export const shortAddress = (a: string): string => (a.length > 18 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a);
