// The real Chain over @crt/client: `readSwitch` for the state of a switch, `recoverOnline` for K after release.
import { RpcClient, bytesToHex, graceSeconds, identity, loadDeployment, readSwitch, recoverOnline, type Deployment } from '@crt/client';
import type { Chain, SwitchState, SwitchStateName } from './interfaces.ts';

/** `drill`: CRT's rehearsal deployment on the same network (`<network>-drill.json`, short grace), when present. */
interface Net { rpc: RpcClient; urls: string[]; deployment: Deployment; drill?: Deployment }

const hexNum = (h: string | undefined): number => (h ? Number(BigInt(h)) : 0);

export class CrtChain implements Chain {
  private constructor(private readonly nets: Map<string, Net>) {}

  /** `rpc` maps each network to its RPC URL; deployments are read from `<dir>/<network>.json`. */
  static async create(rpc: Record<string, string | undefined>, deploymentsDir: string): Promise<CrtChain> {
    const nets = new Map<string, Net>();
    for (const [network, url] of Object.entries(rpc)) {
      if (!url) continue;
      const deployment = await loadDeployment(network, deploymentsDir);
      let drill: Deployment | undefined;
      try { drill = await loadDeployment(`${network}-drill`, deploymentsDir); } catch { drill = undefined; }
      nets.set(network, { rpc: new RpcClient(url), urls: [url], deployment, ...(drill ? { drill } : {}) });
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
    const [first, info] = await Promise.all([
      readSwitch(T, { rpc: n.rpc, deployment: n.deployment }),
      n.rpc.call<{ median_time?: string }>('get_blockchain_info'),
    ]);
    // A fire drill's Node Cells sit under the rehearsal deployment's lock: the normal read then finds none of them.
    let st = first, dep = n.deployment;
    if (first.nodeCells.length === 0 && n.drill) {
      const second = await readSwitch(T, { rpc: n.rpc, deployment: n.drill });
      if (second.nodeCells.length > 0) { st = second; dep = n.drill; }
    }
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
      grace: graceSeconds(dep),
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
