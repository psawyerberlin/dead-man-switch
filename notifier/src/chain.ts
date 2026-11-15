// The real Chain over @crt/client: `readSwitch` for the state of a switch, `recoverOnline` for K after release.
import { RpcClient, bytesToHex, identity, loadDeployment, readSwitch, recoverOnline, type Deployment } from '@crt/client';
import type { Chain, SwitchState, SwitchStateName } from './interfaces.ts';

interface Net { rpc: RpcClient; urls: string[]; deployment: Deployment }

const hexNum = (h: string | undefined): number => (h ? Number(BigInt(h)) : 0);

export class CrtChain implements Chain {
  private constructor(private readonly nets: Map<string, Net>) {}

  /** `rpc` maps each network to its RPC URL; deployments are read from `<dir>/<network>.json`. */
  static async create(rpc: Record<string, string | undefined>, deploymentsDir: string): Promise<CrtChain> {
    const nets = new Map<string, Net>();
    for (const [network, url] of Object.entries(rpc)) {
      if (!url) continue;
      const deployment = await loadDeployment(network, deploymentsDir);
      nets.set(network, { rpc: new RpcClient(url), urls: [url], deployment });
    }
    return new CrtChain(nets);
  }

  private net(network: string): Net {
    const n = this.nets.get(network);
    if (!n) throw new Error(`network ${network} is not configured`);
    return n;
  }

  async switchState(network: string, T: string): Promise<SwitchState> {
    const n = this.net(network);
    const [st, info] = await Promise.all([
      readSwitch(T, { rpc: n.rpc, deployment: n.deployment }),
      n.rpc.call<{ median_time?: string }>('get_blockchain_info'),
    ]);
    if (st.state === 'inconsistent') throw new Error('the Node Cells of this switch disagree');
    return {
      state: st.state as SwitchStateName,
      ...(st.deadline !== null ? { deadline: Number(st.deadline) } : {}),
      medianTime: Math.floor(hexNum(info.median_time) / 1000),
      releases: st.nodeCells.filter((c) => c.data.state === 2).length,
      // The threshold lives in the descriptor, which this read does not have; the watcher takes it from the record.
      t: 0,
      I: bytesToHex(identity(n.deployment.network_id, T)).toLowerCase(),
      ...(st.descriptorHash !== null ? { descriptorHash: st.descriptorHash } : {}),
    };
  }

  async recoverK(network: string, descriptor: unknown, envelopes: unknown): Promise<Uint8Array> {
    return recoverOnline(descriptor as never, envelopes as never, this.net(network).urls);
  }

  async tip(network: string): Promise<{ number: number; timestamp: number }> {
    const h = await this.net(network).rpc.getTipHeader();
    return { number: hexNum(h.number), timestamp: Math.floor(hexNum(h.timestamp) / 1000) };
  }
}
