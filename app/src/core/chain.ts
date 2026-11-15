// Thin helpers over @crt/client for "My switches": state and deadline in chain median time, guardian headroom,
// owner lock hash, and the check-in (renew) history from the indexer's `get_transactions`.
import { type DescriptorLike, type Headroom, type ReadSwitchOptions, type SwitchContext, type SwitchState,
  decodeNodeCellData, readSwitch } from '@crt/client';

export interface SwitchSummary {
  state: SwitchState;
  /** unix seconds, null when the Node Cells disagree or do not exist */
  deadline: number | null;
  /** chain median time (unix seconds) of the tip */
  chainTime: number;
  /** deadline − chain time (negative once passed), null without a deadline */
  secondsLeft: number | null;
  /** guardian headroom (when a descriptor was given) */
  headroom: Headroom | null;
  ownerLockHash: string | null;
  armed: number;
  nodeCount: number;
}

/** Median time of the tip in unix seconds (`get_blockchain_info.median_time`, milliseconds). */
export async function chainMedianTime(ctx: SwitchContext): Promise<number> {
  const info = await ctx.rpc.call<{ median_time: string }>('get_blockchain_info', []);
  return Math.floor(Number(BigInt(info.median_time)) / 1000);
}

export async function switchSummary(T: string, ctx: SwitchContext, opts: { descriptor?: DescriptorLike } & ReadSwitchOptions = {}): Promise<SwitchSummary> {
  const [status, chainTime] = await Promise.all([readSwitch(T, ctx, opts), chainMedianTime(ctx)]);
  const owners = new Set(status.nodeCells.map((n) => n.data.ownerLockHash.toLowerCase()));
  const deadline = status.deadline === null ? null : Number(status.deadline);
  return {
    state: status.state,
    deadline,
    chainTime,
    secondsLeft: deadline === null ? null : deadline - chainTime,
    headroom: status.headroom,
    ownerLockHash: owners.size === 1 ? [...owners][0]! : null,
    armed: status.armed,
    nodeCount: status.nodeCells.length,
  };
}

// ---- check-in history --------------------------------------------------------------------------------------------

export type HistoryKind = 'create' | 'checkin';
export interface HistoryEntry {
  kind: HistoryKind;
  txHash: string;
  blockNumber: number;
  /** block timestamp, unix seconds */
  timestamp: number;
  /** the deadline this transaction set, unix seconds */
  deadline: number;
}

interface TxObject { tx_hash: string; block_number: string; tx_index: string }
interface TxPage { objects: TxObject[]; last_cursor: string }
interface RpcTx {
  transaction: { outputs: Array<{ lock: { code_hash: string; hash_type: string; args: string } }>; outputs_data: string[] };
  tx_status: { status: string; block_hash: string | null };
}

/** Every transaction that touched a Node Cell of `T` (indexer `get_transactions`, grouped, ascending). */
async function nodeCellTransactions(T: string, ctx: SwitchContext, pageSize = 100, maxPages = 100): Promise<TxObject[]> {
  const key = {
    script: { code_hash: ctx.deployment.node_lock.code_hash, hash_type: 'data2', args: T.toLowerCase() },
    script_type: 'lock', script_search_mode: 'prefix', group_by_transaction: true,
  };
  const out: TxObject[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < maxPages; i++) {
    const params: unknown[] = [key, 'asc', '0x' + pageSize.toString(16)];
    if (cursor) params.push(cursor);
    const page = await ctx.rpc.call<TxPage>('get_transactions', params);
    out.push(...page.objects);
    if (page.objects.length < pageSize || !page.last_cursor || page.last_cursor === '0x') break;
    cursor = page.last_cursor;
  }
  return out;
}

/**
 * Create and every check-in (CRT renew: the Node Cells get a later deadline) of switch `T`, oldest first. Arm,
 * guardian commits, releases and rewraps keep the deadline and are not listed.
 */
export async function checkinHistory(T: string, ctx: SwitchContext): Promise<HistoryEntry[]> {
  const t = T.toLowerCase();
  const nodeLock = ctx.deployment.node_lock.code_hash.toLowerCase();
  const txs = await nodeCellTransactions(t, ctx);
  const seen = new Set<string>();
  const entries: HistoryEntry[] = [];
  let last: number | null = null;
  const sorted = [...txs].sort((a, b) => Number(BigInt(a.block_number) - BigInt(b.block_number)) || Number(BigInt(a.tx_index) - BigInt(b.tx_index)));
  for (const o of sorted) {
    if (seen.has(o.tx_hash)) continue;
    seen.add(o.tx_hash);
    const tx = await ctx.rpc.call<RpcTx | null>('get_transaction', [o.tx_hash]);
    if (!tx || tx.tx_status.status !== 'committed') continue;
    const deadlines: number[] = [];
    tx.transaction.outputs.forEach((out, i) => {
      const l = out.lock;
      if (l.code_hash.toLowerCase() !== nodeLock || l.hash_type !== 'data2' || !l.args.toLowerCase().startsWith(t)) return;
      try { deadlines.push(Number(decodeNodeCellData(tx.transaction.outputs_data[i] ?? '0x').deadline)); } catch { /* not a node cell */ }
    });
    if (deadlines.length === 0) continue;
    const deadline = Math.max(...deadlines);
    if (last !== null && deadline <= last) continue;
    let timestamp = 0;
    if (tx.tx_status.block_hash) {
      const h = await ctx.rpc.getHeader(tx.tx_status.block_hash);
      if (h?.timestamp) timestamp = Math.floor(Number(BigInt(h.timestamp)) / 1000);
    }
    entries.push({ kind: last === null ? 'create' : 'checkin', txHash: o.tx_hash, blockNumber: Number(BigInt(o.block_number)), timestamp, deadline });
    last = deadline;
  }
  return entries;
}
