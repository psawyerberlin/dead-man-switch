// The real `OwnerDriver`: reads with CRT's indexer helpers (`switchSummary`, `checkinHistory`) against the RPC of the
// vendored deployment, and signs CRT's owner transactions (renew, cancel, reclaim) with the connected CCC wallet.
// Loaded on demand (its own chunk, with CCC); the screens are tested against a fake driver.
import { ccc } from '@ckb-ccc/core';
import { type Deployment, type DescriptorLike, RpcClient, parseDeployment, txBuilders } from '@crt/client';
import { checkinHistory, switchSummary } from '../../core/chain';
import type { Config, CrtFiles } from '../../core/config';
import type { OwnerDriver } from './service';

export interface ChainOwnerDeps {
  signer: () => unknown;
  crt: (config: Config) => Promise<CrtFiles>;
}

export function chainOwner(deps: ChainOwnerDeps): OwnerDriver {
  const cache = new Map<string, { deployment: Deployment; rpc: RpcClient }>();
  const ctxOf = async (config: Config) => {
    const hit = cache.get(config.network);
    if (hit) return hit;
    const deployment = parseDeployment((await deps.crt(config)).deployment);
    const v = { deployment, rpc: new RpcClient(deployment.rpc_urls) };
    cache.set(config.network, v);
    return v;
  };
  const signerOf = (): ccc.Signer => {
    const s = deps.signer();
    if (!s) throw new Error('no wallet connected');
    return s as ccc.Signer;
  };
  const send = async (signer: ccc.Signer, tx: ccc.Transaction): Promise<string> => {
    const hash = await signer.sendTransaction(tx);
    await signer.client.waitTransaction(hash, 0, 30 * 60_000);
    return hash;
  };
  const builders = async (config: Config) => {
    const { deployment } = await ctxOf(config);
    const signer = signerOf();
    return { signer, b: txBuilders({ signer, deployment }) };
  };

  return {
    async summary(config: Config, T: string, descriptor?: DescriptorLike) {
      return switchSummary(T, await ctxOf(config), descriptor ? { descriptor } : {});
    },
    async history(config: Config, T: string) {
      return checkinHistory(T, await ctxOf(config));
    },
    async walletLockHash() {
      const s = deps.signer() as ccc.Signer | null;
      if (!s) return null;
      return (await s.getRecommendedAddressObj()).script.hash().toLowerCase();
    },
    async renew(config: Config, T: string, deadline: number) {
      const { signer, b } = await builders(config);
      return send(signer, await b.buildRenew(T, BigInt(deadline)));
    },
    async cancel(config: Config, T: string) {
      const { signer, b } = await builders(config);
      return send(signer, await b.buildCancel(T, { reclaimNodeCells: true }));
    },
    async reclaim(config: Config, T: string, runners: string[]) {
      const { signer, b } = await builders(config);
      return send(signer, await b.buildReclaim(T, runners));
    },
    async wake(config: Config, T: string) {
      const { signer, b } = await builders(config);
      return send(signer, await b.buildTopUp(T));
    },
  };
}
