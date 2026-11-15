// Guardian choice (SPEC.md §3.1.5): candidates are only runners that run CRT (`selectRunners` with `requireCrt:
// true`), `n` within `n_min`..`n_max` and the number of candidates, defaults clamped; the access tree with an
// optional mandatory branch (CRT §7.3); the concentration summary.
import { type AccessTree, type Runner, type SelectOptions, SelectionError, selectRunners } from '@crt/client';
import type { Config } from './config';

export interface PoolOptions {
  requireDepositedValid: boolean;
  mandatory?: string[];
  heartbeatBlocks?: number;
  heartbeatTipShannons?: bigint;
}

const selectOptions = (n: number, o: PoolOptions): SelectOptions => ({
  n, requireCrt: true, requireDepositedValid: o.requireDepositedValid, mandatory: o.mandatory ?? [],
  ...(o.heartbeatBlocks !== undefined ? { heartbeatBlocks: o.heartbeatBlocks } : {}),
  ...(o.heartbeatTipShannons !== undefined ? { heartbeatTipShannons: o.heartbeatTipShannons } : {}),
});

/** The runners that may be chosen: the largest set `selectRunners` (CRT runners only) can return. */
export function candidatePool(runners: Runner[], o: PoolOptions): Runner[] {
  for (let n = runners.length; n >= 1; n--) {
    try { return selectRunners(runners, selectOptions(n, o)); } catch (e) { if (!(e instanceof SelectionError)) throw e; }
  }
  return [];
}

/** The `n` guardians for the switch (mandatory first). Throws `SelectionError` when there are not enough. */
export const chooseGuardians = (runners: Runner[], n: number, o: PoolOptions): Runner[] => selectRunners(runners, selectOptions(n, o));

export interface GuardianBounds {
  /** number of candidates */
  available: number;
  nMin: number;
  /** min(n_max, candidates) */
  nMax: number;
  defaultN: number;
  defaultT: number;
  /** false when there are fewer candidates than `n_min` */
  enough: boolean;
}

export function guardianBounds(config: Pick<Config, 'n_min' | 'n_max' | 'default_n' | 'default_t'>, available: number): GuardianBounds {
  const nMax = Math.min(config.n_max, available);
  const enough = available >= config.n_min;
  const defaultN = enough ? Math.min(Math.max(config.default_n, config.n_min), nMax) : 0;
  const defaultT = enough ? Math.min(Math.max(1, config.default_t), defaultN) : 0;
  return { available, nMin: config.n_min, nMax, defaultN, defaultT, enough };
}

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * Access tree over `n` nodes where the first `m` are mandatory: without mandatory nodes `t`-of-`n`; with them
 * `xor(m-of-m over the mandatory, t-of-(n − m) over the others)`; when all are mandatory, `m`-of-`m`.
 */
export function accessTree(n: number, t: number, m = 0): AccessTree {
  const leaves = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => ({ node: from + i }));
  if (m <= 0) return { kind: 'threshold', t, n, leaves: leaves(0, n) };
  if (m >= n) return { kind: 'threshold', t: n, n, leaves: leaves(0, n) };
  return { kind: 'xor', branches: [
    { kind: 'threshold', t: m, n: m, leaves: leaves(0, m) },
    { kind: 'threshold', t, n: n - m, leaves: leaves(m, n) },
  ] };
}

/** Range of the threshold `t` for `n` guardians of which `m` are mandatory. */
export const thresholdRange = (n: number, m = 0): { min: number; max: number } => (m >= n ? { min: n, max: n } : { min: 1, max: Math.max(1, n - m) });

export interface Concentration { operators: number; networks: number; countries: number; share: number }

/** Distinct operators (payout lock), networks (ASN), countries; the share of the largest country/ASN group, in %. */
export function concentration(chosen: Runner[]): Concentration {
  if (chosen.length === 0) return { operators: 0, networks: 0, countries: 0, share: 0 };
  const distinct = (f: (r: Runner, i: number) => string): number => new Set(chosen.map(f)).size;
  // unknown parts never collide (each counts as its own country / network)
  const part = (r: Runner, i: number, j: 0 | 1, known: string | undefined) => {
    const v = known ?? r.diversityKey?.split('/')[j];
    return v && v !== '?' ? v : `?${i}`;
  };
  const country = (r: Runner, i: number) => part(r, i, 0, r.monitor?.country);
  const asn = (r: Runner, i: number) => part(r, i, 1, r.monitor?.asn);
  const groups = new Map<string, number>();
  chosen.forEach((r, i) => { const k = r.diversityKey ?? `?${i}`; groups.set(k, (groups.get(k) ?? 0) + 1); });
  return {
    operators: distinct((r) => r.payoutLockHash.toLowerCase()),
    networks: distinct(asn),
    countries: distinct(country),
    share: Math.round((100 * Math.max(...groups.values())) / chosen.length),
  };
}

/** Display name of a runner: its label from the CRT list, else the start of its lock hash. */
export const runnerName = (r: Runner): string => r.label ?? `${r.R.slice(0, 10)}…`;
