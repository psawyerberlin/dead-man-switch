// The real `SwitchDriver`: CRT's client against the CKB RPC of the vendored deployment, signing with the connected
// CCC wallet. Loaded on demand (its own chunk, with CCC), so the shell and the tests never pull it in. Nothing here
// runs in the test suite; the Write flow is tested against a fake driver.
import { ccc } from '@ckb-ccc/core';
import {
  type CrtListEntry, type Deployment, type Descriptor, type DescriptorPlan, type Envelope, type Runner, type SwitchParams, RpcClient, buildArm, buildCreate,
  buildVerifiedDescriptor, descriptorHash, fetchRunners, parseDeployment, readSwitch, wrapKeyAnchored,
} from '@crt/client';
import type { Config, CrtFiles, LockLike } from '../../core/config';
import type { CreateInput, PreparedCreate, SwitchDriver } from './session';

export interface ChainDriverDeps {
  /** the CCC signer of the connected wallet, or null */
  signer: () => unknown;
  /** vendored CRT deployment and runner list of the network */
  crt: (config: Config) => Promise<CrtFiles>;
  /** poll interval while waiting for the guardians, ms */
  pollMs?: number;
  /** give up waiting for the guardians after this many ms */
  waitTimeoutMs?: number;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function chainDriver(deps: ChainDriverDeps): SwitchDriver {
  const cache = new Map<string, { deployment: Deployment; crtList: CrtListEntry[]; rpc: RpcClient }>();
  const ctxOf = async (config: Config) => {
    const hit = cache.get(config.network);
    if (hit) return hit;
    const files = await deps.crt(config);
    const deployment = parseDeployment(files.deployment);
    const v = { deployment, crtList: files.runners as CrtListEntry[], rpc: new RpcClient(deployment.rpc_urls) };
    cache.set(config.network, v);
    return v;
  };
  const signerOf = (): ccc.Signer => {
    const s = deps.signer();
    if (!s) throw new Error('no wallet connected');
    return s as ccc.Signer;
  };
  const client = (config: Config, url: string): ccc.Client =>
    (config.network === 'mainnet' ? new ccc.ClientPublicMainnet({ url }) : new ccc.ClientPublicTestnet({ url }));
  const sendAndWait = async (signer: ccc.Signer, tx: ccc.Transaction): Promise<string> => {
    const hash = await signer.sendTransaction(tx);
    await signer.client.waitTransaction(hash, 0, 30 * 60_000);
    return hash;
  };

  return {
    async runners(config: Config): Promise<Runner[]> {
      const { deployment, crtList, rpc } = await ctxOf(config);
      return fetchRunners({ rpc, deployment, crtList });
    },

    async organiserLock(config: Config): Promise<LockLike> {
      const { deployment } = await ctxOf(config);
      const s = deps.signer() as ccc.Signer | null;
      const addr = await ccc.Address.fromString(config.organiser_address, s?.client ?? client(config, deployment.rpc_urls[0]!));
      return { occupiedSize: addr.script.occupiedSize };
    },

    async prepareCreate(input: CreateInput): Promise<PreparedCreate> {
      const { deployment } = await ctxOf(input.config);
      const signer = signerOf();
      const organiser = await ccc.Address.fromString(input.config.organiser_address, signer.client);
      const r = await buildCreate({
        signer, deployment, deadline: input.deadline, params: input.params, organiserLock: organiser.script,
        runners: input.runners.map((x) => ({ R: x.R, servicePubkey: x.servicePubkey })),
        validation: input.validation,
      });
      return { T: r.T, I: r.I, ownerLockHash: r.ownerLockHash, send: () => sendAndWait(signer, r.tx) };
    },

    async waitForCommits(config: Config, T: string, n: number, onProgress: (done: number) => void): Promise<void> {
      const { deployment, rpc } = await ctxOf(config);
      const started = Date.now();
      const limit = deps.waitTimeoutMs ?? 6 * 3600_000;
      for (;;) {
        const s = await readSwitch(T, { rpc, deployment });
        const done = s.nodeCells.filter((c) => c.data.state >= 1).length;
        onProgress(Math.min(done, n));
        if (s.state === 'committed' || s.state === 'armed') return;
        if (s.state === 'cancelled' || s.state === 'inconsistent' || s.state === 'released') throw new Error(`switch is ${s.state}`);
        if (Date.now() - started > limit) throw new Error('the guardians did not answer in time');
        await sleep(deps.pollMs ?? 15_000);
      }
    },

    async describe(config: Config, plan: DescriptorPlan, T: string): Promise<Descriptor> {
      const { deployment, rpc } = await ctxOf(config);
      return buildVerifiedDescriptor(plan, T, { rpc, deployment });
    },

    async arm(config: Config, T: string, descriptor: Descriptor, params: SwitchParams): Promise<void> {
      const { deployment } = await ctxOf(config);
      const signer = signerOf();
      const tx = await buildArm(T, descriptorHash(descriptor), { signer, deployment, params });
      await sendAndWait(signer, tx);
    },

    async wrap(config: Config, K: Uint8Array, descriptor: Descriptor): Promise<Envelope[]> {
      const { deployment, rpc } = await ctxOf(config);
      return wrapKeyAnchored(K, descriptor, { rpc, deployment });
    },
  };
}
