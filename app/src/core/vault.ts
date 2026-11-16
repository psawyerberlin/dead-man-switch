// Vault = CRT recovery kit + DMS application payload, one per recipient (SPEC.md §4.3).
import { type Descriptor, type Envelope, type KitApplication, KIT_VERSION, generateKit } from '@crt/client';
import { zipSync } from 'fflate';
import type { Language, SealedBundle } from './bundle';
import { bytesToHex, toBase64 } from './bytes';
import type { Network } from './config';
import { recipientByte } from './keys';

export const APPLICATION_NAME = 'dead-man-switch';
export const APPLICATION_VERSION = '2';
export const VAULT_CIPHER = 'AES-256-GCM';

/**
 * The opener (phase 3) replaces this through `setOpenerScript` / the `script` input. Until then a vault carries
 * a minimal hook so the kit's own recovery still works and the payload stays intact.
 */
let openerScript = 'window.crtApplication = window.crtApplication || { onKey: function () {} };';

/** Sets the script inlined into every vault built without an explicit `script` (the built opener bundle). */
export function setOpenerScript(script: string): void {
  if (/<\/script/i.test(script)) throw new VaultError('the opener must not contain "</script"');
  openerScript = script;
}
export const getOpenerScript = (): string => openerScript;

export interface VaultPayload {
  network: Network;
  language: Language;
  sender_label: string;
  recipient: { index: number; name: string };
  drill: boolean;
  created_at: number;
  cipher: typeof VAULT_CIPHER;
  nonce: string;
  ciphertext_b64: string;
  size: number;
  app_url: string;
  /** grace of the switch's CRT deployment in seconds; absent in older vaults = 86 400 (a fire drill: 600) */
  grace_seconds?: number;
}

export interface VaultMeta {
  network: Network;
  language: Language;
  sender_label: string;
  drill: boolean;
  created_at: number;
  app_url: string;
  /** grace of the deployment (default 86 400) */
  grace_seconds?: number;
}

export interface BuildVaultInput {
  descriptor: Descriptor;
  envelopes: Envelope[];
  /** deadline at sealing time (unix seconds), printed on the certificate */
  deadline: number | bigint;
  recipient: { index: number; name: string };
  /** this recipient's encrypted bundle (`encryptBundle`) */
  sealed: SealedBundle;
  meta: VaultMeta;
  /** overrides the opener script (tests, practice vault) */
  script?: string;
  rpcUrls?: string[];
}

export class VaultError extends Error {
  constructor(message: string) { super(message); this.name = 'VaultError'; }
}

export function vaultPayload(input: Pick<BuildVaultInput, 'recipient' | 'sealed' | 'meta'>): VaultPayload {
  const { recipient, sealed, meta } = input;
  recipientByte(recipient.index);
  if (sealed.nonce.length !== 12) throw new VaultError('nonce must be 12 bytes');
  return {
    network: meta.network, language: meta.language, sender_label: meta.sender_label,
    recipient: { index: recipient.index, name: recipient.name }, drill: meta.drill, created_at: meta.created_at,
    cipher: VAULT_CIPHER, nonce: bytesToHex(sealed.nonce), ciphertext_b64: toBase64(sealed.ciphertext),
    size: sealed.ciphertext.length, app_url: meta.app_url,
    // only a non-default grace is written, so normal vaults stay byte-identical to earlier builds
    ...(meta.grace_seconds !== undefined && meta.grace_seconds !== 86_400 ? { grace_seconds: meta.grace_seconds } : {}),
  };
}

/** One self-contained HTML file for one recipient; deterministic for the same inputs (CRT §8.2). */
export function buildVault(input: BuildVaultInput): string {
  const application: KitApplication = {
    name: APPLICATION_NAME,
    version: APPLICATION_VERSION,
    payload: vaultPayload(input),
    script: input.script ?? openerScript,
  };
  return generateKit({
    descriptor: input.descriptor,
    envelopes: input.envelopes,
    application,
    kitVersion: KIT_VERSION,
    deadline: input.deadline,
    ...(input.rpcUrls ? { rpcUrls: input.rpcUrls } : {}),
  });
}

const FOLD: Record<string, string> = { ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', đ: 'd', ð: 'd', þ: 'th', ł: 'l', ı: 'i' };

/** ASCII-folds to `[a-z0-9-]`: diacritics removed, everything else becomes `-`, no leading/trailing/double `-`. */
export function asciiSlug(s: string, fallback: string, maxLength = 40): string {
  const folded = s.toLowerCase().replace(/[ßæœøđðþłı]/g, (c) => FOLD[c] ?? c).normalize('NFKD').replace(/[̀-ͯ]/g, '');
  const slug = folded.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, maxLength).replace(/-+$/, '');
  return slug || fallback;
}

/** `vault-<sender>-for-<recipient>-<T first 8 hex>.html`, prefixed `drill-` for a drill. */
export function vaultFileName(senderLabel: string, recipientName: string, T: string, drill: boolean): string {
  const t = T.replace(/^0x/i, '').toLowerCase();
  if (!/^[0-9a-f]{8,}$/.test(t)) throw new VaultError('T must be hex');
  const name = `vault-${asciiSlug(senderLabel, 'sender')}-for-${asciiSlug(recipientName, 'recipient')}-${t.slice(0, 8)}.html`;
  return drill ? `drill-${name}` : name;
}

export interface ParsedVault {
  descriptor: Descriptor;
  envelopes: Envelope[];
  application: { name: string; version: string; payload: VaultPayload } | null;
}

function jsonBlock(html: string, id: string): unknown {
  const re = new RegExp(`<script type="application/json" id="${id}">([\\s\\S]*?)</script>`);
  const m = re.exec(html);
  if (!m) throw new VaultError(`not a vault: no ${id} block`);
  try { return JSON.parse(m[1]!); } catch { throw new VaultError(`not a vault: ${id} is not JSON`); }
}

/** Reads the kit's JSON blocks; the DMS fields come from `application.payload`. */
export function parseVault(html: string): ParsedVault {
  const descriptor = jsonBlock(html, 'crt-descriptor') as Descriptor;
  const envelopes = jsonBlock(html, 'crt-envelopes') as Envelope[];
  const app = jsonBlock(html, 'crt-application-data') as ParsedVault['application'];
  if (!descriptor || typeof descriptor !== 'object' || !Array.isArray(envelopes)) throw new VaultError('not a vault: malformed blocks');
  if (app !== null && (typeof app !== 'object' || app.name !== APPLICATION_NAME)) throw new VaultError('not a dead-man-switch vault');
  return { descriptor, envelopes, application: app };
}

export interface VaultFile { name: string; content: string | Uint8Array }

/** A `.zip` of vaults (fixed timestamps, so the same vaults give the same bytes). */
export function zipVaults(files: VaultFile[]): Uint8Array {
  const enc = new TextEncoder();
  const entries: Record<string, [Uint8Array, { mtime: Date }]> = {};
  for (const f of files) {
    if (!f.name || f.name.includes('/') || f.name in entries) throw new VaultError(`invalid or duplicate file name ${f.name}`);
    entries[f.name] = [typeof f.content === 'string' ? enc.encode(f.content) : f.content, { mtime: new Date(Date.UTC(2020, 0, 1)) }];
  }
  return zipSync(entries, { level: 6 });
}
