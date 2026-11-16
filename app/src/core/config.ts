// Per-network application configuration (SPEC.md §4.6). No DOM; works in the browser and in Node.

export type Network = 'testnet' | 'mainnet';
export type FetchFn = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface DrillConfig {
  min_minutes: number;
  max_hours: number;
  presets_minutes: number[];
  heartbeat_blocks: number;
  /** CRT's testnet rehearsal deployment (GRACE 600 s) and its runner list; absent = the normal deployment */
  crt_deployment_url?: string;
  crt_runners_url?: string;
}

export interface Config {
  network: Network;
  enabled: boolean;
  organiser_fee_ckb: number;
  organiser_address: string;
  default_t: number;
  default_n: number;
  n_min: number;
  n_max: number;
  require_deposited_valid: boolean;
  rhythms_months: number[];
  drill: DrillConfig | null;
  heartbeat_presets_blocks: number[];
  default_heartbeat_blocks: number;
  default_heartbeat_tip_ckb: number;
  max_vault_bytes: number;
  max_recipients: number;
  notifier_url: string | null;
  crt_deployment_url: string;
  crt_runners_url: string;
  faucet_url: string | null;
  app_url: string;
  operator_contact: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function fail(key: string, why: string): never {
  throw new ConfigError(`config.${key}: ${why}`);
}
function bool(o: Obj, key: string): boolean {
  const v = o[key];
  if (typeof v !== 'boolean') fail(key, 'must be a boolean');
  return v;
}
function num(o: Obj, key: string, min: number, max: number, integer = true): number {
  const v = o[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(key, 'must be a number');
  if (integer && !Number.isInteger(v)) fail(key, 'must be an integer');
  if (v < min || v > max) fail(key, `must be between ${min} and ${max}`);
  return v;
}
function str(o: Obj, key: string): string {
  const v = o[key];
  if (typeof v !== 'string' || v.length === 0) fail(key, 'must be a non-empty string');
  return v;
}
function urlOrPath(o: Obj, key: string): string {
  const v = str(o, key);
  if (!v.startsWith('/') && !/^https?:\/\//.test(v)) fail(key, 'must be an absolute path or an http(s) URL');
  return v;
}
function intList(o: Obj, key: string, min: number, max: number): number[] {
  const v = o[key];
  if (!Array.isArray(v) || v.length === 0) fail(key, 'must be a non-empty array');
  for (const x of v) if (typeof x !== 'number' || !Number.isInteger(x) || x < min || x > max) fail(key, `entries must be integers between ${min} and ${max}`);
  return v as number[];
}

/** Validates a parsed `config/<network>.json`; throws ConfigError. */
export function validateConfig(raw: unknown, network: Network): Config {
  if (!isObj(raw)) throw new ConfigError('config: not an object');
  if (raw.network !== undefined && raw.network !== network) fail('network', `is "${String(raw.network)}", expected "${network}"`);
  const n_min = num(raw, 'n_min', 1, 16);
  const n_max = num(raw, 'n_max', 1, 16);
  if (n_min > n_max) fail('n_min', 'must not exceed n_max');
  const default_n = num(raw, 'default_n', n_min, n_max);
  const default_t = num(raw, 'default_t', 1, default_n);

  let drill: DrillConfig | null = null;
  if (raw.drill !== null && raw.drill !== undefined) {
    if (network === 'mainnet') fail('drill', 'must be null on mainnet');
    if (!isObj(raw.drill)) fail('drill', 'must be an object or null');
    const d = raw.drill;
    const min_minutes = num(d, 'min_minutes', 30, 48 * 60);
    const max_hours = num(d, 'max_hours', 1, 48);
    if (min_minutes > max_hours * 60) fail('drill.min_minutes', 'exceeds max_hours');
    const presets_minutes = intList(d, 'presets_minutes', min_minutes, max_hours * 60);
    const heartbeat_blocks = num(d, 'heartbeat_blocks', 1, 1_000_000);
    drill = { min_minutes, max_hours, presets_minutes, heartbeat_blocks };
    if (d.crt_deployment_url !== undefined) drill.crt_deployment_url = urlOrPath(d, 'crt_deployment_url');
    if (d.crt_runners_url !== undefined) drill.crt_runners_url = urlOrPath(d, 'crt_runners_url');
  } else if (raw.drill === undefined) {
    fail('drill', 'is required (null disables the fire drill)');
  }

  let notifier_url: string | null = null;
  if (raw.notifier_url !== null) notifier_url = urlOrPath(raw, 'notifier_url');
  let faucet_url: string | null = null;
  if (raw.faucet_url !== undefined && raw.faucet_url !== null) faucet_url = urlOrPath(raw, 'faucet_url');
  else if (network === 'testnet') fail('faucet_url', 'is required on testnet');

  const heartbeat_presets_blocks = intList(raw, 'heartbeat_presets_blocks', 1, 10_000_000);
  const default_heartbeat_blocks = num(raw, 'default_heartbeat_blocks', 1, 10_000_000);
  if (!heartbeat_presets_blocks.includes(default_heartbeat_blocks)) fail('default_heartbeat_blocks', 'must be one of heartbeat_presets_blocks');

  return {
    network,
    enabled: bool(raw, 'enabled'),
    organiser_fee_ckb: num(raw, 'organiser_fee_ckb', 0, 1_000_000, false),
    organiser_address: str(raw, 'organiser_address'),
    default_t,
    default_n,
    n_min,
    n_max,
    require_deposited_valid: bool(raw, 'require_deposited_valid'),
    rhythms_months: intList(raw, 'rhythms_months', 1, 120),
    drill,
    heartbeat_presets_blocks,
    default_heartbeat_blocks,
    default_heartbeat_tip_ckb: num(raw, 'default_heartbeat_tip_ckb', 0, 1_000_000, false),
    max_vault_bytes: num(raw, 'max_vault_bytes', 1024, 1024 ** 3),
    max_recipients: num(raw, 'max_recipients', 1, 10),
    notifier_url,
    crt_deployment_url: urlOrPath(raw, 'crt_deployment_url'),
    crt_runners_url: urlOrPath(raw, 'crt_runners_url'),
    faucet_url,
    app_url: urlOrPath(raw, 'app_url'),
    operator_contact: urlOrPath(raw, 'operator_contact'),
  };
}

async function getJson(fetchFn: FetchFn, url: string, what: string): Promise<unknown> {
  let res;
  try {
    res = await fetchFn(url);
  } catch (e) {
    throw new ConfigError(`${what}: cannot fetch ${url}: ${(e as Error).message}`);
  }
  if (!res.ok) throw new ConfigError(`${what}: ${url} answered ${res.status}`);
  try {
    return await res.json();
  } catch {
    throw new ConfigError(`${what}: ${url} is not valid JSON`);
  }
}

/** Fetches `/app/config/<network>.json` and validates it. */
export async function loadConfig(network: Network, fetchFn: FetchFn): Promise<Config> {
  if (network !== 'testnet' && network !== 'mainnet') throw new ConfigError(`unknown network "${String(network)}"`);
  return validateConfig(await getJson(fetchFn, `/app/config/${network}.json`, 'config'), network);
}

/** The part of a CKB script that matters here: `occupiedSize` as in `@ckb-ccc/core`'s `Script`. */
export interface LockLike {
  occupiedSize: number;
}

const ADDRESS = /^(ckb|ckt)1[02-9ac-hj-np-z]{40,}$/;

/**
 * The organiser output must hold at least its occupied capacity, `8 + lock.occupiedSize` CKB
 * (the rule of CRT's `buildCreate`), and the address must not be a placeholder.
 */
export function organiserFeeCheck(config: Config, lock: LockLike): void {
  const addr = config.organiser_address;
  const prefix = config.network === 'mainnet' ? 'ckb1' : 'ckt1';
  if (!ADDRESS.test(addr) || !addr.startsWith(prefix) || /placeholder|replace|todo|xxx/i.test(addr)) {
    throw new ConfigError('organiser_address is a placeholder or not a valid address for this network');
  }
  const minimum = 8 + lock.occupiedSize;
  if (config.organiser_fee_ckb < minimum) {
    throw new ConfigError(`organiser_fee_ckb ${config.organiser_fee_ckb} is below the occupied capacity of the organiser output (${minimum} CKB)`);
  }
}

export interface RunnerEntry {
  runner_lock_hash: string;
  label?: string;
  since?: string;
  [k: string]: unknown;
}

export interface CrtFiles {
  deployment: Record<string, unknown>;
  runners: RunnerEntry[];
}

/** Loads the vendored CRT deployment and runner list; a bare array or `{runners: [...]}` is accepted, a missing list is `[]`. */
export async function loadCrtFiles(config: Config, fetchFn: FetchFn): Promise<CrtFiles> {
  const deployment = await getJson(fetchFn, config.crt_deployment_url, 'crt deployment');
  if (!isObj(deployment)) throw new ConfigError('crt deployment: not an object');
  let runners: unknown = [];
  try {
    const res = await fetchFn(config.crt_runners_url);
    if (res.ok) runners = await res.json();
    else if (res.status !== 404) throw new ConfigError(`crt runners: ${config.crt_runners_url} answered ${res.status}`);
  } catch (e) {
    if (e instanceof ConfigError) throw e;
    runners = [];
  }
  const list = Array.isArray(runners) ? runners : isObj(runners) && Array.isArray(runners.runners) ? runners.runners : null;
  if (!list) throw new ConfigError('crt runners: neither an array nor {runners: [...]}');
  for (const r of list) if (!isObj(r) || typeof r.runner_lock_hash !== 'string') throw new ConfigError('crt runners: entry without runner_lock_hash');
  return { deployment, runners: list as RunnerEntry[] };
}

/** The config a fire drill runs with: CRT's rehearsal deployment and runner list (short grace) and the drill's check
 *  interval, when the drill section names them; otherwise the config unchanged. */
export function drillView(c: Config): Config {
  const d = c.drill;
  if (!d || !d.crt_deployment_url) return c;
  return { ...c, crt_deployment_url: d.crt_deployment_url, crt_runners_url: d.crt_runners_url ?? c.crt_runners_url,
    default_heartbeat_blocks: d.heartbeat_blocks };
}
