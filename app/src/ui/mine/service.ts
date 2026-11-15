// My switches (SPEC.md §3.2) without the DOM: the local list, what the chain and the messenger say about each switch,
// and the owner's actions (check in, away until, cancel, reclaim, messenger settings). The chain side is behind
// `OwnerDriver` (real: `chain-owner.ts`; tests: a fake), the messenger behind `OwnerMessenger`.
import type { Descriptor, DescriptorLike, Envelope } from '@crt/client';
import { type ArchiveContents, openArchive } from '../../core/archive';
import { encryptBundle } from '../../core/bundle';
import { type Rng, defaultRng, hexToBytes } from '../../core/bytes';
import { buildVault, vaultFileName } from '../../core/vault';
import type { Language } from '../../core/bundle';
import type { HistoryEntry, SwitchSummary } from '../../core/chain';
import type { Config, Network } from '../../core/config';
import { type RecordPatch, MessengerError, parseOwnerCode } from '../../core/messenger';
import { type Quote, quote } from '../../core/price';
import { type Rhythm, addRhythm, parseRhythmIso } from '../../core/rhythm';
import {
  type SavedSwitch, type StorageLike, OWNER_CODE_KEY, findSwitch, forgetSwitch, loadSwitches, normaliseSwitchId, ownerCodeOf, upsertSwitch,
} from '../../core/switches';

export interface OwnerDriver {
  /** state, deadline and headroom of switch T in chain median time (`switchSummary`) */
  summary(config: Config, T: string, descriptor?: DescriptorLike): Promise<SwitchSummary>;
  /** Create and every check-in (`checkinHistory`) */
  history(config: Config, T: string): Promise<HistoryEntry[]>;
  /** lock hash of the connected wallet, or null without one */
  walletLockHash(config: Config): Promise<string | null>;
  /** CRT `buildRenew` with the new deadline (unix seconds), signed and sent; resolves with the tx hash once committed */
  renew(config: Config, T: string, deadline: number): Promise<string>;
  /** CRT `buildCancel` (Node Cells reclaimed in the same transaction), signed and sent */
  cancel(config: Config, T: string): Promise<string>;
  /** CRT `buildReclaim` (Node Cells and one expired job per call), signed and sent */
  reclaim(config: Config, T: string, runners: string[]): Promise<string>;
}

/** What the messenger answers to `GET /switch/:network/:T` (notifier `summary`). */
export interface MessengerView {
  state?: string;
  record?: { sender_label?: string; rhythm?: string; drill?: boolean; descriptor?: DescriptorLike & { identity?: string };
    owner?: { email?: string | null; language?: Language; reminders?: boolean };
    recipients?: Array<{ index: number; name: string; language: Language; email?: string | null; tell_now?: boolean; link?: unknown }> };
  confirmations?: Array<{ role: 'owner' | 'recipient'; index: number; language?: string; confirmation: 'none' | 'asked' | 'confirmed' | 'stopped' }>;
  events?: Array<{ at: number; kind: string; detail?: string }>;
}

export interface OwnerMessenger {
  get(network: Network, T: string, A: Uint8Array): Promise<unknown>;
  patch(network: Network, T: string, A: Uint8Array, patch: RecordPatch): Promise<unknown>;
  remove(network: Network, T: string, A: Uint8Array): Promise<unknown>;
}

export interface OwnerDeps {
  config: (network: Network) => Config | null;
  driver: OwnerDriver | null;
  messenger: ((config: Config) => OwnerMessenger | null) | null;
  storage: StorageLike | null;
  /** the vendored CRT deployment (block seconds for the estimates) */
  blockSeconds?: (network: Network) => number | undefined;
  /** wall clock, unix seconds */
  now?: () => number;
  /** `wrapKeyAnchored` (rebuilding the vaults from an owner archive needs fresh envelopes) */
  wrap?: ((config: Config, K: Uint8Array, descriptor: Descriptor) => Promise<Envelope[]>) | null;
  rng?: Rng;
}

export interface RebuiltVault { index: number; name: string; fileName: string; html: string }

export type Busy = 'refresh' | 'checkin' | 'cancel' | 'reclaim' | 'settings' | null;

export interface CardState {
  summary: SwitchSummary | null;
  history: HistoryEntry[] | null;
  messenger: MessengerView | null;
  error: string | null;
  messengerError: string | null;
  busy: Busy;
  /** i18n key and params of the last outcome (`checkin.done`, `cancel.done`, …) */
  done: { key: string; params?: Record<string, string | number> } | null;
  /** the deadline the last check-in set, for the ring's refill */
  refilled: boolean;
}

export type TimelineKind = 'create' | 'checkin' | 'deadline' | 'event';
export interface TimelineEntry { kind: TimelineKind; at: number; key: string; detail?: string }

export type RecipientState = 'confirmed' | 'waiting' | 'not_asked' | 'stopped';

/** The parties' confirmation states (`confirmed ✓ / not asked / waiting`). */
export function recipientState(c: { confirmation: string } | undefined): RecipientState {
  if (!c) return 'not_asked';
  if (c.confirmation === 'confirmed') return 'confirmed';
  if (c.confirmation === 'asked') return 'waiting';
  if (c.confirmation === 'stopped') return 'stopped';
  return 'not_asked';
}

/** i18n key of a messenger event (anything unknown is `timeline.event.other`). */
export const EVENT_KEYS: Record<string, string> = {
  reminder_sent: 'timeline.event.reminder', alarm_sent: 'timeline.event.alarm', release_sent: 'timeline.event.release',
  report_sent: 'timeline.event.report', cancelled_sent: 'timeline.event.cancelled', owner_asked: 'timeline.event.asked',
  recipient_asked: 'timeline.event.asked', confirmed: 'timeline.event.confirmed', stopped: 'timeline.event.stopped',
  release_skipped: 'timeline.event.skipped', mail_failed: 'timeline.event.mail_failed', record_replaced: 'timeline.event.changed',
  record_changed: 'timeline.event.changed',
};

const message = (e: unknown): string => (e as Error)?.message || String(e);

export class MineService {
  readonly now: () => number;
  readonly cards = new Map<string, CardState>();
  private listeners = new Set<() => void>();

  constructor(readonly deps: OwnerDeps) {
    this.now = deps.now ?? (() => Math.floor(Date.now() / 1000));
  }

  onChange(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  changed(): void { for (const fn of [...this.listeners]) fn(); }

  // ---- the list ----
  list(network?: Network): SavedSwitch[] {
    const all = loadSwitches(this.deps.storage);
    return network ? all.filter((s) => s.network === network) : all;
  }
  get(network: Network, T: string): SavedSwitch | null { return findSwitch(this.deps.storage, network, T); }
  static key(s: Pick<SavedSwitch, 'network' | 'T'>): string { return `${s.network}:${s.T.toLowerCase()}`; }
  card(s: Pick<SavedSwitch, 'network' | 'T'>): CardState {
    const k = MineService.key(s);
    let c = this.cards.get(k);
    if (!c) { c = { summary: null, history: null, messenger: null, error: null, messengerError: null, busy: null, done: null, refilled: false }; this.cards.set(k, c); }
    return c;
  }
  private patchCard(s: Pick<SavedSwitch, 'network' | 'T'>, next: Partial<CardState>): void {
    Object.assign(this.card(s), next);
    this.changed();
  }

  /** "Add by T": a switch created elsewhere (another browser) is added to this list. */
  addById(network: Network, T: string): SavedSwitch {
    const entry = upsertSwitch(this.deps.storage, { network, T: normaliseSwitchId(T) });
    this.changed();
    return entry;
  }

  /**
   * "Restore from owner code": the code names the network and the first 8 hex of T; with the full T it is stored in
   * this browser, and the messenger's record (sender, rhythm, recipients, descriptor) fills in the list entry.
   */
  async restoreFromCode(code: string, T: string): Promise<SavedSwitch> {
    const parsed = parseOwnerCode(code);
    const t = normaliseSwitchId(T);
    if (t.slice(2, 10) !== parsed.T8) throw new MessengerError('the owner code belongs to another switch');
    this.deps.storage?.setItem(OWNER_CODE_KEY(parsed.network, t), code.trim());
    let entry = upsertSwitch(this.deps.storage, { network: parsed.network, T: t, messenger: true });
    const cfg = this.deps.config(parsed.network);
    const m = cfg ? this.deps.messenger?.(cfg) ?? null : null;
    if (m) {
      const view = (await m.get(parsed.network, t, parsed.A)) as MessengerView;
      const r = view.record;
      if (r) {
        entry = upsertSwitch(this.deps.storage, {
          network: parsed.network, T: t, messenger: true, ...(r.sender_label ? { sender_label: r.sender_label } : {}), ...(r.rhythm ? { rhythm: r.rhythm } : {}),
          drill: r.drill === true, ...(r.descriptor ? { descriptor: r.descriptor as unknown as NonNullable<SavedSwitch['descriptor']> } : {}),
          ...(r.descriptor?.identity ? { I: r.descriptor.identity } : {}),
          ...(r.recipients ? { recipients: r.recipients.map((x) => ({ index: x.index, name: x.name, language: x.language })) } : {}),
        });
      }
      this.patchCard(entry, { messenger: view, messengerError: null });
    }
    this.changed();
    return entry;
  }

  /** Updates a listed switch (a switch opened from a link and not in the list stays out of it). */
  private touch(s: Pick<SavedSwitch, 'network' | 'T'>, fields: Partial<SavedSwitch>): void {
    if (this.get(s.network, s.T)) upsertSwitch(this.deps.storage, { ...fields, network: s.network, T: s.T });
  }

  forget(s: SavedSwitch): void {
    forgetSwitch(this.deps.storage, s.network, s.T);
    this.cards.delete(MineService.key(s));
    this.changed();
  }

  ownerCode(s: Pick<SavedSwitch, 'network' | 'T'>): string | null { return ownerCodeOf(this.deps.storage, s.network, s.T); }
  private ownerSecret(s: Pick<SavedSwitch, 'network' | 'T'>): Uint8Array | null {
    const code = this.ownerCode(s);
    if (!code) return null;
    try { return parseOwnerCode(code).A; } catch { return null; }
  }
  private messengerFor(s: SavedSwitch): OwnerMessenger | null {
    const cfg = this.deps.config(s.network);
    return cfg && s.messenger !== false ? this.deps.messenger?.(cfg) ?? null : null;
  }

  rhythmOf(s: SavedSwitch): Rhythm | null {
    try { return s.rhythm ? parseRhythmIso(s.rhythm) : null; } catch { return null; }
  }

  // ---- reading ----
  /** Reads the chain (summary, check-in history) and, with the owner code, the messenger's view. */
  async refresh(s: SavedSwitch): Promise<void> {
    const cfg = this.deps.config(s.network);
    const driver = this.deps.driver;
    this.patchCard(s, { busy: this.card(s).busy ?? 'refresh' });
    const jobs: Promise<void>[] = [];
    if (cfg && driver) {
      jobs.push(driver.summary(cfg, s.T, s.descriptor as unknown as DescriptorLike | undefined).then((summary) => {
        const c = this.card(s);
        c.summary = summary;
        c.error = null;
        if (summary.deadline !== null && summary.deadline !== s.deadline) this.touch(s, { deadline: summary.deadline });
      }, (e: unknown) => { this.card(s).error = message(e); }));
      jobs.push(driver.history(cfg, s.T).then((h) => { this.card(s).history = h; }, () => { this.card(s).history = null; }));
    } else {
      this.card(s).error = 'no chain connection';
    }
    const A = this.ownerSecret(s);
    const m = A ? this.messengerFor(s) : null;
    if (m && A) {
      jobs.push(m.get(s.network, s.T, A).then((v) => { this.card(s).messenger = v as MessengerView; this.card(s).messengerError = null; },
        (e: unknown) => { this.card(s).messengerError = message(e); }));
    }
    await Promise.all(jobs);
    if (this.card(s).busy === 'refresh') this.card(s).busy = null;
    this.changed();
  }

  /** The timeline: created, each check-in (chain), the next deadline, and the messenger's events. Oldest first. */
  timeline(s: SavedSwitch): TimelineEntry[] {
    const c = this.card(s);
    const out: TimelineEntry[] = [];
    if (c.history?.length) {
      for (const e of c.history) out.push({ kind: e.kind, at: e.timestamp || 0, key: e.kind === 'create' ? 'timeline.created' : 'timeline.checkin' });
    } else if (s.created_at) {
      out.push({ kind: 'create', at: s.created_at, key: 'timeline.created' });
    }
    for (const e of c.messenger?.events ?? []) out.push({ kind: 'event', at: e.at, key: EVENT_KEYS[e.kind] ?? 'timeline.event.other', detail: e.kind });
    out.sort((a, b) => a.at - b.at);
    const deadline = this.deadline(s);
    if (deadline !== null && (c.summary?.state ?? 'armed') === 'armed') out.push({ kind: 'deadline', at: deadline, key: 'timeline.deadline' });
    return out;
  }

  deadline(s: SavedSwitch): number | null { return this.card(s).summary?.deadline ?? s.deadline ?? null; }
  /** Chain median time when known, else the wall clock. */
  chainNow(s: SavedSwitch): number { return this.card(s).summary?.chainTime ?? this.now(); }

  /** The deadline a check-in sets now: chain time + rhythm. */
  nextDeadline(s: SavedSwitch): number | null {
    const r = this.rhythmOf(s);
    return r ? addRhythm(this.chainNow(s), r) : null;
  }

  /** Days of the current term a check-in now overlaps (the old heartbeat jobs still run until then). */
  overlapDays(s: SavedSwitch): number {
    const d = this.deadline(s);
    if (d === null) return 0;
    return Math.max(0, Math.floor((d - this.chainNow(s)) / 86_400));
  }

  /** The estimate before a check-in to `deadline`: the guardians' checks over the new term (CRT §11.1). */
  checkinQuote(s: SavedSwitch, deadline: number): Quote | null {
    const cfg = this.deps.config(s.network);
    if (!cfg) return null;
    const n = Math.max(1, s.descriptor?.nodes?.length ?? cfg.default_n);
    try {
      return quote({ organiser_fee_ckb: 0 }, { block_seconds: this.deps.blockSeconds?.(s.network) },
        { n, t: 1, termSeconds: Math.max(60, deadline - this.chainNow(s)), heartbeatBlocks: s.heartbeat_blocks ?? cfg.default_heartbeat_blocks,
          heartbeatTip: s.heartbeat_tip_ckb ?? cfg.default_heartbeat_tip_ckb });
    } catch { return null; }
  }

  // ---- the owner archive (SPEC.md §3.5): kept in memory for this page only ----
  private archives = new Map<string, ArchiveContents>();
  archiveOf(s: Pick<SavedSwitch, 'network' | 'T'>): ArchiveContents | null { return this.archives.get(MineService.key(s)) ?? null; }
  /** Opens an owner archive for `s` (scrypt + AES-GCM); throws on a wrong passphrase or another switch's archive. */
  async openArchive(s: SavedSwitch, file: string, passphrase: string): Promise<ArchiveContents> {
    const contents = await openArchive(file, passphrase);
    if (contents.T.toLowerCase() !== s.T.toLowerCase() || contents.network !== s.network) throw new Error('this archive belongs to another switch');
    this.archives.set(MineService.key(s), contents);
    this.changed();
    return contents;
  }
  /** Builds the vaults again from the open archive: same letters and K, fresh envelopes from the chain. */
  async rebuildVaults(s: SavedSwitch): Promise<RebuiltVault[]> {
    const a = this.archiveOf(s);
    const cfg = this.deps.config(s.network);
    if (!a || !cfg) throw new Error('open the owner archive first');
    const descriptor = s.descriptor;
    if (!descriptor || !this.deps.wrap) throw new Error('the switch record is missing from this browser');
    const K = hexToBytes(a.K);
    const envelopes = await this.deps.wrap(cfg, K, descriptor);
    const deadline = this.deadline(s) ?? 0;
    const out: RebuiltVault[] = [];
    for (const letter of a.letters) {
      const sealed = await encryptBundle(K, a.I, letter.recipient.index, letter, this.deps.rng ?? defaultRng, { maxBytes: cfg.max_vault_bytes });
      const html = buildVault({ descriptor, envelopes, deadline, recipient: letter.recipient, sealed,
        meta: { network: s.network, language: letter.language, sender_label: letter.sender_label, drill: letter.drill, created_at: letter.created_at, app_url: cfg.app_url } });
      out.push({ index: letter.recipient.index, name: letter.recipient.name, fileName: vaultFileName(letter.sender_label, letter.recipient.name, s.T, letter.drill), html });
    }
    K.fill(0);
    return out;
  }

  // ---- the owner's actions ----
  /** Whether the connected wallet is the owner of `s` (lock hash = the owner lock hash of the Node Cells). */
  async isOwner(s: SavedSwitch): Promise<boolean | null> {
    const cfg = this.deps.config(s.network);
    const driver = this.deps.driver;
    if (!cfg || !driver) return null;
    const owner = this.card(s).summary?.ownerLockHash ?? (await driver.summary(cfg, s.T, s.descriptor as unknown as DescriptorLike | undefined)).ownerLockHash;
    const mine = await driver.walletLockHash(cfg);
    if (!owner || !mine) return null;
    return owner.toLowerCase() === mine.toLowerCase();
  }

  /**
   * Check in: one signature (CRT renew). `deadline` defaults to chain time + rhythm; "away until" passes its own.
   * Allowed during the grace, refused once a guardian has released or the switch is cancelled.
   */
  async checkin(s: SavedSwitch, deadline?: number): Promise<boolean> {
    const cfg = this.deps.config(s.network);
    const driver = this.deps.driver;
    const c = this.card(s);
    if (c.busy && c.busy !== 'refresh') return false;
    try {
      if (!cfg || !driver) throw new Error('no chain connection');
      const target = deadline ?? this.nextDeadline(s);
      if (target === null) throw new Error('the rhythm of this switch is unknown');
      const state = c.summary?.state;
      if (state === 'released' || state === 'cancelled') throw new Error(`switch is ${state}`);
      this.patchCard(s, { busy: 'checkin', error: null, done: null });
      await driver.renew(cfg, s.T, target);
      this.touch(s, { deadline: target });
      if (c.summary) c.summary = { ...c.summary, deadline: target, secondsLeft: target - c.summary.chainTime };
      this.patchCard(s, { busy: null, done: { key: 'checkin.done', params: { deadline: target } }, refilled: true });
      return true;
    } catch (e) {
      this.patchCard(s, { busy: null, error: message(e) });
      return false;
    }
  }

  /** Cancel: one signature (CRT cancel), then the messenger deletes the switch's data (`DELETE`). */
  async cancel(s: SavedSwitch): Promise<boolean> {
    const cfg = this.deps.config(s.network);
    const driver = this.deps.driver;
    if (this.card(s).busy && this.card(s).busy !== 'refresh') return false;
    try {
      if (!cfg || !driver) throw new Error('no chain connection');
      this.patchCard(s, { busy: 'cancel', error: null, done: null });
      await driver.cancel(cfg, s.T);
      const c = this.card(s);
      if (c.summary) c.summary = { ...c.summary, state: 'cancelled' };
      const A = this.ownerSecret(s);
      const m = A ? this.messengerFor(s) : null;
      if (m && A) {
        try { await m.remove(s.network, s.T, A); c.messenger = null; } catch (e) { c.messengerError = message(e); }
      }
      this.patchCard(s, { busy: null, done: { key: 'cancel.done' } });
      return true;
    } catch (e) {
      this.patchCard(s, { busy: null, error: message(e) });
      return false;
    }
  }

  /** Reclaim: after release or cancel, the parked CKB back (one expired job per transaction). */
  async reclaim(s: SavedSwitch): Promise<boolean> {
    const cfg = this.deps.config(s.network);
    const driver = this.deps.driver;
    try {
      if (!cfg || !driver) throw new Error('no chain connection');
      this.patchCard(s, { busy: 'reclaim', error: null, done: null });
      await driver.reclaim(cfg, s.T, (s.descriptor?.nodes ?? []).map((n) => n.runner_lock_hash));
      this.patchCard(s, { busy: null, done: { key: 'reclaim.done' } });
      return true;
    } catch (e) {
      this.patchCard(s, { busy: null, error: message(e) });
      return false;
    }
  }

  /** Messenger settings: change the owner's email, reminders, the recipients' emails and "tell them now". */
  async saveSettings(s: SavedSwitch, patch: RecordPatch): Promise<boolean> {
    const A = this.ownerSecret(s);
    const m = A ? this.messengerFor(s) : null;
    try {
      if (!m || !A) throw new Error('the owner code is missing from this browser');
      this.patchCard(s, { busy: 'settings', messengerError: null, done: null });
      await m.patch(s.network, s.T, A, patch);
      const view = (await m.get(s.network, s.T, A)) as MessengerView;
      this.patchCard(s, { busy: null, messenger: view, done: { key: 'settings.saved' } });
      return true;
    } catch (e) {
      this.patchCard(s, { busy: null, messengerError: message(e) });
      return false;
    }
  }
}
