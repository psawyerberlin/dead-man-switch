// Environment of the messenger (SPEC.md §5.5), validated at start.
import { hexToBytes } from './crypto.ts';

export const NETWORKS = ['testnet', 'mainnet'] as const;
export type Network = (typeof NETWORKS)[number];

export interface Config {
  dataKey: Uint8Array;
  dataDir: string;
  port: number;
  smtp: { host: string; port: number; secure: boolean; requireTLS: boolean; user: string; pass: string };
  mailFrom: string;
  appUrl: string;
  rpc: Partial<Record<Network, string>>;
  networks: Network[];
  trustProxy: boolean;
  /** Directory of the CRT deployment files `<network>.json`. */
  deploymentsDir: string;
}

export class EnvError extends Error {
  constructor(message: string) { super(message); this.name = 'EnvError'; }
}

/** The bare address of `Name <addr>` or `addr`. */
export function mailAddress(from: string): string {
  const m = /<([^<>]+)>\s*$/.exec(from.trim());
  return (m ? m[1]! : from).trim();
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const need = (k: string): string => {
    const v = env[k]?.trim();
    if (!v) throw new EnvError(`${k} is required`);
    return v;
  };
  const keyHex = need('NOTIFIER_DATA_KEY');
  let dataKey: Uint8Array;
  try { dataKey = hexToBytes(keyHex); } catch { throw new EnvError('NOTIFIER_DATA_KEY must be hex'); }
  if (dataKey.length !== 32) throw new EnvError('NOTIFIER_DATA_KEY must be 32 bytes (64 hex characters)');

  const port = Number(need('SMTP_PORT'));
  if (port !== 465 && port !== 587) throw new EnvError('SMTP_PORT must be 465 (implicit TLS) or 587 (STARTTLS)');
  const user = need('SMTP_USER');
  const mailFrom = need('MAIL_FROM');
  if (mailAddress(mailFrom).toLowerCase() !== user.toLowerCase()) throw new EnvError('the address in MAIL_FROM must equal SMTP_USER (the mail host refuses other senders)');

  const appUrl = need('APP_URL').replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s]+$/.test(appUrl)) throw new EnvError('APP_URL must be an http(s) URL');

  const networks = need('NETWORKS').split(',').map((s) => s.trim()).filter(Boolean);
  for (const n of networks) if (!(NETWORKS as readonly string[]).includes(n)) throw new EnvError(`unknown network ${n}`);
  const rpc: Partial<Record<Network, string>> = {};
  for (const n of networks as Network[]) rpc[n] = need(`RPC_${n.toUpperCase()}`);

  const listen = Number(env.PORT ?? 8787);
  if (!Number.isInteger(listen) || listen < 1 || listen > 65535) throw new EnvError('PORT must be a port number');

  return {
    dataKey, dataDir: env.DATA_DIR?.trim() || '/data', port: listen,
    smtp: { host: need('SMTP_HOST'), port, secure: port === 465, requireTLS: port === 587, user, pass: env.SMTP_PASS ?? '' },
    mailFrom, appUrl, rpc, networks: networks as Network[], trustProxy: env.TRUST_PROXY === '1',
    deploymentsDir: env.CRT_DEPLOYMENTS_DIR?.trim() || 'deployments',
  };
}
