import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

export const VECTORS = JSON.parse(readFileSync(new URL('../../spec/vectors/keys.json', import.meta.url), 'utf8')) as {
  K: string; I: string;
  cases: { r: number; K_link: string; link: { plaintext: string; nonce: string; aad: string; ciphertext: string } }[];
};
export const tmp = (): string => mkdtempSync(join(tmpdir(), 'dms-notifier-'));
export const KEY_HEX = '7f'.repeat(32);
export const goodEnv = (): Record<string, string> => ({
  NOTIFIER_DATA_KEY: KEY_HEX, SMTP_HOST: 'smtp.example.org', SMTP_PORT: '465', SMTP_USER: 'box@example.org', SMTP_PASS: 'x',
  MAIL_FROM: 'dead-man-switch <box@example.org>', APP_URL: 'https://example.org', RPC_TESTNET: 'https://rpc.example.org', NETWORKS: 'testnet',
});
