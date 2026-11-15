// Fire drill (SPEC.md §3.4): testnet only, deadline 30 min – 48 h; letters open at deadline + 24 h grace,
// plus at most one guardian check.
import { DEFAULT_BLOCK_SECONDS, GRACE_SECONDS } from '@crt/client';
import type { Config } from './config';

export class DrillError extends Error {
  constructor(message: string, readonly code: 'unavailable' | 'range' = 'range') { super(message); this.name = 'DrillError'; }
}

export interface DrillBounds { minSeconds: number; maxSeconds: number; presets: number[]; heartbeatBlocks: number }

export function drillBounds(config: Pick<Config, 'network' | 'drill'>): DrillBounds {
  if (config.network === 'mainnet' || !config.drill) throw new DrillError('there is no fire drill on this network', 'unavailable');
  const d = config.drill;
  return {
    minSeconds: d.min_minutes * 60,
    maxSeconds: d.max_hours * 3600,
    presets: d.presets_minutes.map((m) => m * 60),
    heartbeatBlocks: d.heartbeat_blocks,
  };
}

/** Throws `DrillError` on mainnet or outside the range; returns the term. */
export function validateDrillTerm(config: Pick<Config, 'network' | 'drill'>, seconds: number): number {
  const b = drillBounds(config);
  if (!Number.isFinite(seconds) || seconds < b.minSeconds || seconds > b.maxSeconds) {
    throw new DrillError(`a fire drill lasts between ${b.minSeconds / 60} minutes and ${b.maxSeconds / 3600} hours`);
  }
  return seconds;
}

/** Earliest: deadline + 24 h grace; latest: plus one guardian check interval. Unix seconds. */
export function drillOpensAt(deadline: number | bigint, heartbeatBlocks: number, blockSeconds: number = DEFAULT_BLOCK_SECONDS): { earliest: number; latest: number } {
  const earliest = Number(deadline) + GRACE_SECONDS;
  return { earliest, latest: earliest + Math.round(heartbeatBlocks * blockSeconds) };
}
