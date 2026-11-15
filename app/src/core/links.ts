// Encrypted vault links (SPEC.md §4.2): AES-256-GCM with K_link(r), aad = "DMS-v2/link" ‖ I ‖ u8(r),
// plaintext the UTF-8 URL. The messenger holds only this until release.
import { aesGcmDecrypt, aesGcmEncrypt, NONCE_BYTES } from './aead';
import { type BytesLike, type Rng, bytesToHex, concat, defaultRng, fromUtf8, hexToBytes, utf8 } from './bytes';
import { check32, linkKey, LINK_INFO, recipientByte } from './keys';

export const MAX_LINK_LENGTH = 2048;

export interface SealedLink { nonce: string; ciphertext: string }

export class LinkError extends Error {
  constructor(message: string) { super(message); this.name = 'LinkError'; }
}

/** Accepts only absolute `https:` URLs of at most 2048 characters; returns the URL unchanged. */
export function checkLink(url: string): string {
  if (typeof url !== 'string' || url.length === 0) throw new LinkError('link is empty');
  if (url.length > MAX_LINK_LENGTH) throw new LinkError(`link is longer than ${MAX_LINK_LENGTH} characters`);
  if (/\s/.test(url) || [...url].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f)) throw new LinkError('link contains whitespace or control characters');
  let u: URL;
  try { u = new URL(url); } catch { throw new LinkError('link is not a URL'); }
  if (u.protocol !== 'https:' || !/^https:\/\//i.test(url)) throw new LinkError('link must start with https://');
  if (!u.hostname) throw new LinkError('link has no host');
  return url;
}

export function linkAad(I: BytesLike, r: number): Uint8Array {
  return concat(utf8(LINK_INFO), check32(I, 'I'), recipientByte(r));
}

export async function encryptLink(K: BytesLike, I: BytesLike, r: number, url: string, rng: Rng = defaultRng): Promise<SealedLink> {
  checkLink(url);
  const nonce = rng(NONCE_BYTES);
  if (nonce.length !== NONCE_BYTES) throw new LinkError('rng returned a nonce of the wrong length');
  const ct = await aesGcmEncrypt(linkKey(K, I, r), nonce, linkAad(I, r), utf8(url));
  return { nonce: bytesToHex(nonce), ciphertext: bytesToHex(ct) };
}

/** Throws `DecryptError` on a wrong key or recipient, `LinkError` when the plaintext is not an acceptable link. */
export async function decryptLink(K: BytesLike, I: BytesLike, r: number, sealed: SealedLink): Promise<string> {
  let nonce: Uint8Array, ct: Uint8Array;
  try { nonce = hexToBytes(sealed.nonce); ct = hexToBytes(sealed.ciphertext); } catch { throw new LinkError('sealed link is not hex'); }
  const pt = await aesGcmDecrypt(linkKey(K, I, r), nonce, linkAad(I, r), ct);
  let url: string;
  try { url = fromUtf8(pt); } catch { throw new LinkError('link is not UTF-8'); }
  return checkLink(url);
}
