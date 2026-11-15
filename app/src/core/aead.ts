// AES-256-GCM through WebCrypto (browser and Node 22). Ciphertext = encrypted bytes ‖ 16-byte tag.
import { buf } from './bytes';

const subtle = (): SubtleCrypto => {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error('WebCrypto is not available');
  return s;
};

export const NONCE_BYTES = 12;

async function importKey(key: Uint8Array, usage: KeyUsage): Promise<CryptoKey> {
  if (key.length !== 32) throw new RangeError('AES-256-GCM key must be 32 bytes');
  return subtle().importKey('raw', buf(key), { name: 'AES-GCM' }, false, [usage]);
}

export async function aesGcmEncrypt(key: Uint8Array, nonce: Uint8Array, aad: Uint8Array, plaintext: Uint8Array): Promise<Uint8Array> {
  if (nonce.length !== NONCE_BYTES) throw new RangeError('nonce must be 12 bytes');
  const k = await importKey(key, 'encrypt');
  return new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: buf(nonce), additionalData: buf(aad), tagLength: 128 }, k, buf(plaintext)));
}

/** Throws `DecryptError` on a wrong key, aad, nonce or a modified ciphertext. */
export async function aesGcmDecrypt(key: Uint8Array, nonce: Uint8Array, aad: Uint8Array, ciphertext: Uint8Array): Promise<Uint8Array> {
  if (nonce.length !== NONCE_BYTES) throw new DecryptError('nonce must be 12 bytes');
  const k = await importKey(key, 'decrypt');
  try {
    return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: buf(nonce), additionalData: buf(aad), tagLength: 128 }, k, buf(ciphertext)));
  } catch {
    throw new DecryptError('decryption failed (wrong key, wrong switch or wrong recipient, or the data was altered)');
  }
}

export class DecryptError extends Error {
  constructor(message: string) { super(message); this.name = 'DecryptError'; }
}
