// Everything that touches the outside world sits behind these interfaces, so the tests run offline
// (aiworker/02-dms-notifier.md, introduction). The real chain lives over @crt/client, the real mailer over nodemailer.

export type SwitchStateName = 'pending' | 'committed' | 'armed' | 'released' | 'cancelled' | 'absent';

export interface SwitchState {
  state: SwitchStateName;
  deadline?: number;
  medianTime: number;
  releases: number;
  t: number;
  I?: string;
  /** Descriptor hash committed in the Node Cells (CRT `verifyNodes`), `0x` hex. */
  descriptorHash?: string;
  /** Grace of the CRT deployment the switch was found under, seconds (24 h; a testnet fire drill: 600). */
  grace?: number;
}

/** Unix seconds. */
export interface Clock { now(): number }

export interface Chain {
  switchState(network: string, T: string): Promise<SwitchState>;
  /** CRT `recoverOnline`. */
  recoverK(network: string, descriptor: unknown, envelopes: unknown): Promise<Uint8Array>;
  /** Optional: the tip block number and its timestamp (unix seconds), for `/health`. */
  tip?(network: string): Promise<{ number: number; timestamp: number }>;
}

export interface MailMessage { to: string; subject: string; text: string; html: string; headers: Record<string, string> }
export interface Mailer { send(msg: MailMessage): Promise<void> }

export const systemClock: Clock = { now: () => Math.floor(Date.now() / 1000) };
