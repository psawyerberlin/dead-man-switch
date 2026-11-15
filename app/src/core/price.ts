// Quote before Create (CRT §11.1): a thin wrapper over @crt/client's `estimateCost` plus the organiser fee of the
// configuration. The messenger costs nothing.
import { type CostLine, estimateCost, SWITCH_PARAM_RANGES } from '@crt/client';
import type { Config } from './config';

export interface QuoteInput {
  n: number;
  t: number;
  termSeconds: number;
  heartbeatBlocks: number;
  /** CKB per check and guardian (config `default_heartbeat_tip_ckb`) */
  heartbeatTip: number;
}

export interface QuoteLine extends CostLine { key: string }

export interface Quote {
  spentNow: number;
  spentOverTerm: number;
  monthly: number;
  parked: number;
  parkedTransient: number;
  lines: QuoteLine[];
  /** seconds until a silent guardian is noticed */
  detectionDelay: number;
  runs: number;
  blockSeconds: number;
  assumptions: string[];
}

/** i18n key of each CRT cost line. */
export const LINE_KEYS: Record<string, string> = {
  keygen_tips: 'price.line.tips',
  heartbeat_tips: 'price.line.tips',
  organiser_fee: 'price.line.organiser',
  network_fees: 'price.line.fees',
  alive_cell: 'price.line.cells',
  node_cells: 'price.line.cells',
  heartbeat_job_cells: 'price.line.cells',
  keygen_job_cells: 'price.line.cells',
};

const shannons = (ckb: number): bigint => BigInt(Math.round(ckb * 1e8));

export function quote(config: Pick<Config, 'organiser_fee_ckb'>, crtDeployment: { block_seconds?: number } | null | undefined, input: QuoteInput): Quote {
  if (!Number.isInteger(input.t) || input.t < 1 || input.t > input.n) throw new RangeError('t must satisfy 1 <= t <= n');
  const blockSeconds = typeof crtDeployment?.block_seconds === 'number' && crtDeployment.block_seconds > 0 ? crtDeployment.block_seconds : undefined;
  const R = SWITCH_PARAM_RANGES;
  const c = estimateCost({
    deployment: blockSeconds !== undefined ? { blockSeconds } : {},
    n: input.n,
    termSeconds: input.termSeconds,
    heartbeatBlocks: input.heartbeatBlocks,
    heartbeatTipShannons: shannons(input.heartbeatTip),
    keygenTipShannons: R.keygenTip.default,
    maxFeeShannons: R.maxFee.default,
    organiserFeeShannons: shannons(config.organiser_fee_ckb),
  });
  return {
    spentNow: c.spentNow,
    spentOverTerm: c.spentOverTerm,
    monthly: c.monthly,
    parked: c.parked,
    parkedTransient: c.parkedTransient,
    lines: c.lines.map((l) => ({ ...l, key: LINE_KEYS[l.id] ?? 'price.line.fees' })),
    detectionDelay: c.detectionDelaySeconds,
    runs: c.runs,
    blockSeconds: blockSeconds ?? 10.8,
    assumptions: c.assumptions,
  };
}
