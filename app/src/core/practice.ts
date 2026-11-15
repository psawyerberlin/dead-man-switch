// The practice vault of `#/open/demo` (SPEC.md §3.3.4): a real vault (CRT kit + the DMS opener) around a fixed
// sample letter, one per language, with its key embedded in the page and no chain. Deterministic: the same opener
// gives the same bytes. Built at build time (`vite.config.ts` `dmsPracticePlugin` → `virtual:dms-practice`).
import type { Descriptor, Envelope } from '@crt/client';
import { type Language, type Letter, BUNDLE_VERSION, LANGUAGES, encryptBundle } from './bundle';
import { type Rng } from './bytes';
import { translate } from './i18n';
import { buildVault } from './vault';
import practiceDescriptor from './practice-descriptor.json';

/** The practice key: public on purpose, it opens nothing but the practice letter. */
export const PRACTICE_KEY = '0x' + '70'.repeat(32);
export const PRACTICE_CREATED_AT = 1_763_000_000;
export const PRACTICE_DEADLINE = 1_900_000_000;

const fixedRng = (seed: number): Rng => {
  let s = seed >>> 0 || 1;
  return (n) => Uint8Array.from({ length: n }, () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s & 0xff; });
};

const descriptor = (): Descriptor => structuredClone(practiceDescriptor) as unknown as Descriptor;
const envelopes = (d: Descriptor): Envelope[] =>
  d.nodes.map((n, i) => ({ position: i, node: i, runner_lock_hash: n.runner_lock_hash, envelope: '0x02' + '00'.repeat(32 + 12 + 16 + 32) }));

/** The prelude that marks the page as practice and embeds the key (read by the opener's `practiceKey`). */
export const practicePrelude = (): string => `window.DMS_PRACTICE=true;window.DMS_PRACTICE_KEY=${JSON.stringify(PRACTICE_KEY)};`;

/** The practice vault in `language`, carrying `opener` (the built opener bundle). */
export async function practiceVault(language: Language, opener: string): Promise<string> {
  const d = descriptor();
  const recipient = { index: 1, name: translate(language, 'practice.recipient') };
  const letter: Letter = {
    version: BUNDLE_VERSION, language, created_at: PRACTICE_CREATED_AT, sender_label: translate(language, 'practice.sender'), recipient, drill: false,
    text_markdown: `# ${translate(language, 'practice.letter_title')}\n\n${translate(language, 'practice.letter_body')}`,
    note_markdown: translate(language, 'practice.note'), files: [],
  };
  const sealed = await encryptBundle(PRACTICE_KEY, d.identity, 1, letter, fixedRng(0x5eed + LANGUAGES.indexOf(language)));
  return buildVault({
    descriptor: d, envelopes: envelopes(d), deadline: PRACTICE_DEADLINE, recipient, sealed, script: practicePrelude() + opener,
    meta: { network: 'testnet', language, sender_label: letter.sender_label, drill: false, created_at: PRACTICE_CREATED_AT, app_url: 'https://dead-man-switch.chainsolution.net' },
  });
}

/** The three practice vaults. */
export async function practiceVaults(opener: string): Promise<Record<Language, string>> {
  const out = {} as Record<Language, string>;
  for (const l of LANGUAGES) out[l] = await practiceVault(l, opener);
  return out;
}
