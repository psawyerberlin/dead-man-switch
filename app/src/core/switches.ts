// The local list of the owner's switches (SPEC.md §3.2), keyed by network and T, in this browser's localStorage.
// It holds only what is public or harmless (no K, no letter, no link, no email); the owner code has its own key.
import type { Descriptor } from '@crt/client';
import type { Language } from './bundle';
import type { Network } from './config';

export const SWITCHES_KEY = 'dms.switches';
export const OWNER_CODE_KEY = (network: Network, T: string): string => `dms.owner_code.${network}.${T.toLowerCase()}`;

export interface StorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

export interface SavedRecipient { index: number; name: string; language: Language }

export interface SavedSwitch {
  network: Network;
  T: string;
  I?: string;
  created_at?: number;
  /** the deadline last known to this browser (the chain is the authority) */
  deadline?: number;
  sender_label?: string;
  /** ISO 8601 rhythm (`P3M`, `P10D`, `PT30M` for a drill) */
  rhythm?: string;
  drill?: boolean;
  /** the switch is registered at the messenger */
  messenger?: boolean;
  descriptor_hash?: string;
  /** the guardians' check interval and tip per check, for the estimate before a check-in */
  heartbeat_blocks?: number;
  heartbeat_tip_ckb?: number;
  descriptor?: Descriptor;
  recipients?: SavedRecipient[];
}

const HEX32 = /^0x[0-9a-f]{64}$/;

export const isSwitchId = (T: string): boolean => HEX32.test(T.trim().toLowerCase());

/** Normalises a T typed by the owner (`0x` optional, any case); throws on anything else. */
export function normaliseSwitchId(T: string): string {
  const t = T.trim().toLowerCase();
  const v = t.startsWith('0x') ? t : `0x${t}`;
  if (!HEX32.test(v)) throw new Error('T must be 32 bytes of hex');
  return v;
}

export function loadSwitches(storage: StorageLike | null | undefined): SavedSwitch[] {
  let raw: unknown = [];
  try { raw = JSON.parse(storage?.getItem(SWITCHES_KEY) ?? '[]'); } catch { raw = []; }
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is SavedSwitch => !!x && typeof x === 'object' && (x.network === 'testnet' || x.network === 'mainnet')
    && typeof x.T === 'string' && HEX32.test(x.T));
}

const same = (a: Pick<SavedSwitch, 'network' | 'T'>, b: Pick<SavedSwitch, 'network' | 'T'>): boolean =>
  a.network === b.network && a.T.toLowerCase() === b.T.toLowerCase();

export function findSwitch(storage: StorageLike | null | undefined, network: Network, T: string): SavedSwitch | null {
  return loadSwitches(storage).find((s) => same(s, { network, T })) ?? null;
}

/** Adds or updates (merging the fields) one switch; returns the stored entry. */
export function upsertSwitch(storage: StorageLike | null | undefined, entry: SavedSwitch): SavedSwitch {
  const T = normaliseSwitchId(entry.T);
  const list = loadSwitches(storage);
  const old = list.find((s) => same(s, { network: entry.network, T }));
  const merged: SavedSwitch = { ...(old ?? {}), ...entry, T };
  const next = [...list.filter((s) => !same(s, merged)), merged];
  try { storage?.setItem(SWITCHES_KEY, JSON.stringify(next)); } catch { /* storage full or blocked */ }
  return merged;
}

/** Removes a switch from this browser's list (not from the chain) and forgets its owner code. */
export function forgetSwitch(storage: StorageLike | null | undefined, network: Network, T: string): void {
  const next = loadSwitches(storage).filter((s) => !same(s, { network, T }));
  try {
    storage?.setItem(SWITCHES_KEY, JSON.stringify(next));
    storage?.removeItem(OWNER_CODE_KEY(network, T));
  } catch { /* blocked */ }
}

export function ownerCodeOf(storage: StorageLike | null | undefined, network: Network, T: string): string | null {
  try { return storage?.getItem(OWNER_CODE_KEY(network, T)) ?? null; } catch { return null; }
}
