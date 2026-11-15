import { readFileSync } from 'node:fs';
import type { Descriptor, Envelope } from '@crt/client';
import type { Letter } from '../src/core/bundle';
import type { Rng } from '../src/core/bytes';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- fixtures are untyped JSON
export const readJson = (rel: string): any => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const vectors = (): any => readJson('../../spec/vectors/keys.json');

/** Deterministic xorshift rng for tests. */
export function seeded(seed: number): Rng {
  let s = seed >>> 0 || 1;
  return (n) => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; out[i] = s & 0xff; }
    return out;
  };
}

/** CRT's descriptor test vector (2-of-3, network 1), copied from `.refs/crt/spec/vectors/descriptor.json`. */
export const descriptor = (): Descriptor => readJson('./fixtures/descriptor.json');
export const envelopes = (d: Descriptor = descriptor()): Envelope[] =>
  d.nodes.map((n, i) => ({ position: i, node: i, runner_lock_hash: n.runner_lock_hash, envelope: '0x02' + 'ab'.repeat(32) + 'cd'.repeat(12 + 16 + 32) }));

export const K = '0x' + '4b'.repeat(32);

export function letter(index: number, name: string, extra: Partial<Letter> = {}): Letter {
  return {
    version: 2, language: 'fr', created_at: 1_763_000_000, sender_label: 'Patrick', recipient: { index, name }, drill: false,
    text_markdown: `# Pour ${name}\n\nLettre secrète numéro ${index}.`, note_markdown: 'Une note.',
    files: [{ name: 'note.txt', mime: 'text/plain', size: 5, data_b64: 'aGVsbG8=' }], ...extra,
  };
}
