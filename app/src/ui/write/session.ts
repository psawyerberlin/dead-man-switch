// The Write flow's state and logic (SPEC.md §3.1, §3.5): letters, recipients, rhythm, guardians, price, create,
// seal and hand over. Everything lives in memory; nothing here touches the DOM. The chain side is behind
// `SwitchDriver` (real: `chain-driver.ts`; tests: a fake) and the messenger behind `MessengerLike`.
import {
  type Descriptor, type DescriptorPlan, type Envelope, type Runner, type SwitchParams, SWITCH_PARAM_RANGES, VerificationError, descriptorHash,
} from '@crt/client';
import { ARCHIVE_MIN_STRENGTH, type ArchiveContents, passphraseStrength, sealArchive } from '../../core/archive';
import { type Language, type Letter, type LetterFile, BUNDLE_VERSION, encodeBundle, encryptBundle, sealedSize } from '../../core/bundle';
import { type Rng, bytesToHex, defaultRng, toBase64, utf8 } from '../../core/bytes';
import { icsForDeadline } from '../../core/calendar';
import { type Config, type CrtFiles, type LockLike, type Network, ConfigError, organiserFeeCheck, drillView } from '../../core/config';
import { type GuardianBounds, accessTree, candidatePool, chooseGuardians, clamp, guardianBounds, thresholdRange } from '../../core/guardians';
import { getLanguage } from '../../core/i18n';
import { checkLink, encryptLink } from '../../core/links';
import { type MessengerRecord, type OwnerCode, buildRecord, newOwnerCode, parseOwnerCode } from '../../core/messenger';
import { type PlaceId } from '../../core/places';
import { type Quote, quote } from '../../core/price';
import { type Rhythm, addRhythm, rhythmIso } from '../../core/rhythm';
import { type TemplateId, templateText } from '../../core/templates';
import { buildVault, vaultFileName, zipVaults } from '../../core/vault';
import { DrillError, drillBounds, validateDrillTerm } from '../../core/drill';
import { OWNER_CODE_KEY, SWITCHES_KEY, upsertSwitch } from '../../core/switches';

// ---- the outside world ---------------------------------------------------------------------------------------------

export interface CreateInput {
  config: Config;
  /** unix seconds */
  deadline: number;
  runners: Runner[];
  params: SwitchParams;
  validation: { t: number; mandatory?: { j: number; m: number }; acknowledgedOneOfOne?: boolean };
}

/** The Create transaction, built (T and I known) but not yet signed. */
export interface PreparedCreate {
  T: string;
  I: string;
  ownerLockHash: string;
  /** asks the wallet for the signature and sends; resolves with the transaction hash once committed */
  send(): Promise<string>;
}

export interface SwitchDriver {
  /** CSR runners decorated with the vendored CRT list (`fetchRunners` with `crtList`) */
  runners(config: Config): Promise<Runner[]>;
  /** lock of the organiser address, for `organiserFeeCheck` */
  organiserLock(config: Config): Promise<LockLike>;
  prepareCreate(input: CreateInput): Promise<PreparedCreate>;
  /** resolves when every Node Cell of T is committed (state 1); reports progress */
  waitForCommits(config: Config, T: string, n: number, onProgress: (done: number) => void): Promise<void>;
  /** hard-fail verification (CRT §8.3) and the descriptor; throws `VerificationError` */
  describe(config: Config, plan: DescriptorPlan, T: string): Promise<Descriptor>;
  /** signs and sends Arm, resolves once committed */
  arm(config: Config, T: string, descriptor: Descriptor, params: SwitchParams): Promise<void>;
  /** `wrapKeyAnchored` */
  wrap(config: Config, K: Uint8Array, descriptor: Descriptor): Promise<Envelope[]>;
}

export interface MessengerLike {
  claim(network: Network, T: string, adminHash: string): Promise<unknown>;
  put(record: MessengerRecord, A: Uint8Array): Promise<unknown>;
}

export type { StorageLike } from '../../core/switches';
import type { StorageLike } from '../../core/switches';

export interface WriteDeps {
  config: () => Config | null;
  /** the vendored CRT deployment (block seconds for the quote) */
  /** CRT files for a config (cached by main.ts): the drill view gets the rehearsal deployment */
  crt?: (config: Config) => CrtFiles | null;
  driver: SwitchDriver | null;
  messenger: ((config: Config) => MessengerLike | null) | null;
  /** whether a wallet is connected */
  walletConnected?: () => boolean;
  rng?: Rng;
  /** wall clock, unix seconds */
  now?: () => number;
  storage?: StorageLike | null;
  /** a fire drill (SPEC.md §3.4): testnet only, term in minutes, fixed check interval, "tell them now" forced on */
  drill?: boolean;
}

// ---- state -----------------------------------------------------------------------------------------------------------

export type LetterMode = 'shared' | 'each' | 'note';

export interface RecipientDraft {
  index: number;
  name: string;
  language: Language;
  email: string;
  tellNow: boolean;
  /** letter of this recipient (mode `each`) */
  text: string;
  /** personal note (mode `note`) */
  note: string;
  /** files of this recipient (mode `each`) */
  files: LetterFile[];
  place: PlaceId | null;
  link: string;
}

export type CreatePhase = 'idle' | 'claim' | 'sign' | 'wait' | 'verify' | 'arm' | 'done' | 'failed';

export interface CreateStatus {
  phase: CreatePhase;
  /** guardians that have committed */
  done: number;
  n: number;
  error: string | null;
  /** rule number of a failed verification */
  rule: number | null;
  /** true once the Create transaction was sent (a retry must not create a second switch) */
  sent: boolean;
}

export interface Created {
  network: Network;
  T: string;
  I: string;
  K: Uint8Array | null;
  descriptor: Descriptor | null;
  envelopes: Envelope[] | null;
  deadline: number;
  createdAt: number;
  chosen: Runner[];
  /** the owner code while it is still on screen; afterwards only in this browser's storage */
  ownerCode: OwnerCode | null;
  /** T was claimed at the messenger */
  claimed: boolean;
}

export interface SealedVault { index: number; name: string; language: Language; fileName: string; html: string }

export { OWNER_CODE_KEY, SWITCHES_KEY };

const shannons = (ckb: number): bigint => BigInt(Math.round(ckb * 1e8));

/** Encrypted size of a letter bundle, computed without base64-encoding the files again. */
export function bundleSize(letter: Letter): number {
  const files = letter.files.map((f) => ({ ...f, data_b64: '' }));
  const b64 = letter.files.reduce((a, f) => a + f.data_b64.length, 0);
  return sealedSize(encodeBundle({ ...letter, files }).length + b64);
}

export const fileFromBytes = (name: string, mime: string, bytes: Uint8Array): LetterFile =>
  ({ name, mime: mime || 'application/octet-stream', size: bytes.length, data_b64: toBase64(bytes) });

export class WriteSession {
  readonly rng: Rng;
  readonly now: () => number;
  readonly storage: StorageLike | null;
  private listeners = new Set<() => void>();

  mode: LetterMode = 'shared';
  senderLabel = '';
  shared: { text: string; files: LetterFile[] } = { text: '', files: [] };
  recipients: RecipientDraft[] = [];
  messenger = { on: true, email: '', reminders: true };
  rhythm: Rhythm = { kind: 'months', months: 3 };
  heartbeatBlocks: number | null = null;
  tipCkb: number | null = null;
  n: number | null = null;
  t: number | null = null;
  /** runner lock hashes of the mandatory guardians */
  mandatory: string[] = [];
  ack = '';
  drill = false;
  /** the drill's term screen shows the custom field (a custom term may equal a preset) */
  drillCustom = false;

  runners: Runner[] | null = null;
  runnersError: string | null = null;
  private runnersLoading: Promise<void> | null = null;
  organiser: { lock: LockLike | null; error: string | null; loading: Promise<void> | null } = { lock: null, error: null, loading: null };

  status: CreateStatus = { phase: 'idle', done: 0, n: 0, error: null, rule: null, sent: false };
  created: Created | null = null;
  vaults: SealedVault[] | null = null;
  sealing: Promise<void> | null = null;
  sealError: string | null = null;
  /** the owner code was rendered once; afterwards only a click on "show" renders it */
  ownerCodeDisplayed = false;
  saved = false;
  /** passphrase of the owner archive while it is kept open in this session */
  archivePassphrase: string | null = null;
  handedOver = false;
  handoverError: string | null = null;
  /** K and the letters were dropped */
  dropped = false;

  constructor(readonly deps: WriteDeps) {
    this.rng = deps.rng ?? defaultRng;
    this.now = deps.now ?? (() => Math.floor(Date.now() / 1000));
    this.storage = deps.storage === undefined ? safeStorage() : deps.storage;
    if (deps.drill) {
      this.drill = true;
      const presets = this.drillBounds()?.presets ?? [];
      this.rhythm = { kind: 'minutes', minutes: Math.round((presets.includes(3600) ? 3600 : presets[0] ?? 3600) / 60) };
    }
    this.recipients.push(this.blankRecipient(1));
  }

  // ---- change notification ----
  onChange(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  changed(): void { for (const fn of [...this.listeners]) fn(); }

  /** In a fire drill: the drill view (CRT's rehearsal deployment, short grace, the drill's check interval). */
  get config(): Config | null { const c = this.deps.config(); return c && this.drill ? drillView(c) : c; }
  /** The grace of the deployment this flow uses (24 h, or the rehearsal's 10 min). */
  graceSeconds(): number {
    const cfg = this.config;
    const g = cfg ? (this.deps.crt?.(cfg)?.deployment as { grace_seconds?: unknown } | undefined)?.grace_seconds : undefined;
    return typeof g === 'number' && g > 0 ? g : 86_400;
  }
  get network(): Network { return this.config?.network ?? 'testnet'; }
  get maxRecipients(): number { return this.config?.max_recipients ?? 10; }
  get maxVaultBytes(): number { return this.config?.max_vault_bytes ?? 26_214_400; }
  get messengerAvailable(): boolean { return !!this.config?.notifier_url && this.deps.messenger !== null; }
  get messengerOn(): boolean { return this.messengerAvailable && this.messenger.on; }

  // ---- recipients ----
  private blankRecipient(index: number): RecipientDraft {
    return { index, name: '', language: getLanguage(), email: '', tellNow: this.drill, text: '', note: '', files: [], place: null, link: '' };
  }
  get canAddRecipient(): boolean { return this.recipients.length < this.maxRecipients; }
  /** Adds a recipient; false (and nothing added) at `max_recipients`. */
  addRecipient(): boolean {
    if (!this.canAddRecipient) return false;
    const used = new Set(this.recipients.map((r) => r.index));
    let index = 1;
    while (used.has(index)) index++;
    this.recipients.push(this.blankRecipient(index));
    this.changed();
    return true;
  }
  removeRecipient(index: number): void {
    if (this.recipients.length <= 1) return;
    this.recipients = this.recipients.filter((r) => r.index !== index);
    this.changed();
  }
  recipientsValid(): boolean {
    return this.recipients.length >= 1 && this.recipients.length <= this.maxRecipients && this.recipients.every((r) => r.name.trim().length > 0 && r.name.length <= 200)
      && this.recipients.every((r) => r.email.trim() === '' || /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/.test(r.email.trim()));
  }

  // ---- letters ----
  letterFor(r: RecipientDraft): Letter {
    const createdAt = this.created?.createdAt ?? this.now();
    return {
      version: BUNDLE_VERSION, language: r.language, created_at: createdAt, sender_label: this.senderLabel.trim(),
      recipient: { index: r.index, name: r.name.trim() }, drill: this.drill,
      text_markdown: this.mode === 'each' ? r.text : this.shared.text,
      note_markdown: this.mode === 'note' ? r.note : '',
      files: this.mode === 'each' ? r.files : this.shared.files,
    };
  }
  vaultSize(r: RecipientDraft): number { return bundleSize(this.letterFor(r)); }
  sizeOk(r: RecipientDraft): boolean { return this.vaultSize(r) <= this.maxVaultBytes; }
  lettersValid(): boolean {
    if (this.senderLabel.trim() === '') return false;
    return this.recipients.every((r) => {
      const l = this.letterFor(r);
      return (l.text_markdown.trim() !== '' || l.files.length > 0) && this.sizeOk(r);
    });
  }
  /** `# title\n\nbody` of a template, appended to `text`. */
  static insertTemplate(text: string, id: TemplateId, language: Language): string {
    const tpl = templateText(id, language);
    const block = `# ${tpl.title}\n\n${tpl.body}`;
    return text.trim() === '' ? block : `${text.replace(/\s+$/, '')}\n\n${block}`;
  }

  // ---- rhythm ----
  deadlineFrom(now = this.now()): number { return addRhythm(now, this.rhythm); }
  termSeconds(now = this.now()): number { return this.deadlineFrom(now) - now; }

  // ---- fire drill ----
  /** The drill's bounds of this network, or null (mainnet, or no drill configured). */
  drillBounds(): ReturnType<typeof drillBounds> | null {
    const cfg = this.config;
    if (!cfg) return null;
    try { return drillBounds(cfg); } catch (e) { if (e instanceof DrillError) return null; throw e; }
  }
  /** The term (seconds) is a whole number of minutes within the drill's bounds (`drillBounds`). */
  drillTermAllowed(seconds: number): boolean {
    const b = this.drillBounds();
    if (!b) return false;
    try { validateDrillTerm(this.config!, seconds); } catch { return false; }
    return seconds % 60 === 0;
  }
  /** Sets the drill term (seconds); false when it is outside the drill's bounds (nothing changes). */
  setDrillTerm(seconds: number): boolean {
    if (!this.drillTermAllowed(seconds)) return false;
    this.rhythm = { kind: 'minutes', minutes: seconds / 60 };
    this.changed();
    return true;
  }

  // ---- guardians ----
  get heartbeat(): number {
    const drill = this.drill ? this.drillBounds() : null;
    if (drill) return drill.heartbeatBlocks;
    return this.heartbeatBlocks ?? this.config?.default_heartbeat_blocks ?? SWITCH_PARAM_RANGES.heartbeatBlocks.default;
  }
  get tip(): number { return this.tipCkb ?? this.config?.default_heartbeat_tip_ckb ?? 0.5; }

  loadRunners(): Promise<void> {
    if (this.runners || this.runnersLoading) return this.runnersLoading ?? Promise.resolve();
    const cfg = this.config;
    if (!cfg || !this.deps.driver) { this.runnersError = 'no chain connection'; return Promise.resolve(); }
    this.runnersLoading = this.deps.driver.runners(cfg).then((list) => {
      this.runners = list;
      this.runnersError = null;
      this.applyDefaults();
    }, (e: unknown) => { this.runnersError = (e as Error).message || String(e); })
      .finally(() => { this.runnersLoading = null; this.changed(); });
    return this.runnersLoading;
  }

  /** Candidates: CRT runners only, filtered as the config says (`requireCrt: true`, `requireDepositedValid`). */
  candidates(): Runner[] {
    if (!this.runners || !this.config) return [];
    return candidatePool(this.runners, {
      requireDepositedValid: this.config.require_deposited_valid, mandatory: this.mandatory,
      heartbeatBlocks: this.heartbeat, heartbeatTipShannons: shannons(this.tip),
    });
  }
  bounds(): GuardianBounds | null {
    if (!this.runners || !this.config) return null;
    return guardianBounds(this.config, this.candidates().length);
  }
  private applyDefaults(): void {
    const b = this.bounds();
    if (!b) return;
    this.n = b.enough ? clamp(this.n ?? b.defaultN, Math.max(b.nMin, this.mandatory.length || 1), b.nMax) : null;
    if (this.n === null) { this.t = null; return; }
    const range = thresholdRange(this.n, this.mandatory.length);
    this.t = clamp(this.t ?? b.defaultT, range.min, range.max);
  }
  setN(n: number): void { this.n = n; this.applyDefaults(); this.changed(); }
  setT(t: number): void { this.t = t; this.applyDefaults(); this.changed(); }
  setHeartbeat(blocks: number): void { this.heartbeatBlocks = blocks; this.applyDefaults(); this.changed(); }
  setTip(ckb: number): void { this.tipCkb = ckb; this.applyDefaults(); this.changed(); }
  addMandatory(R: string): void {
    const r = R.toLowerCase();
    if (this.mandatory.includes(r)) return;
    this.mandatory.push(r);
    this.applyDefaults();
    this.changed();
  }
  removeMandatory(R: string): void { this.mandatory = this.mandatory.filter((m) => m !== R.toLowerCase()); this.applyDefaults(); this.changed(); }
  chosen(): Runner[] {
    if (!this.runners || !this.config || this.n === null) return [];
    try {
      return chooseGuardians(this.runners, this.n, { requireDepositedValid: this.config.require_deposited_valid, mandatory: this.mandatory,
        heartbeatBlocks: this.heartbeat, heartbeatTipShannons: shannons(this.tip) });
    } catch { return []; }
  }
  /** A mandatory 1-of-1 guardian on a real switch needs the typed acknowledgement (SPEC.md §3.8). */
  get needsAck(): boolean { return !this.drill && this.mandatory.length === 1; }
  ackOk(phrase: string): boolean { return !this.needsAck || this.ack.trim().toLocaleLowerCase() === phrase.trim().toLocaleLowerCase(); }
  guardiansValid(phrase: string): boolean {
    return this.n !== null && this.t !== null && this.chosen().length === this.n && this.ackOk(phrase);
  }

  // ---- price ----
  quote(): Quote | null {
    const cfg = this.config;
    if (!cfg) return null;
    const n = this.n ?? Math.max(1, Math.min(cfg.default_n, cfg.n_max));
    const t = clamp(this.t ?? 1, 1, n);
    try {
      return quote(cfg, (this.deps.crt?.(cfg)?.deployment ?? null) as { block_seconds?: number } | null,
        { n, t, termSeconds: this.termSeconds(), heartbeatBlocks: this.heartbeat, heartbeatTip: this.tip });
    } catch { return null; }
  }
  /** The organiser fee check (SPEC.md §3.8); null when the config is valid, the error message otherwise. */
  loadOrganiser(): Promise<void> {
    const cfg = this.config;
    if (this.organiser.lock || this.organiser.loading) return this.organiser.loading ?? Promise.resolve();
    if (!cfg || !this.deps.driver) { this.organiser.error = 'no chain connection'; return Promise.resolve(); }
    this.organiser.loading = this.deps.driver.organiserLock(cfg).then((lock) => { this.organiser.lock = lock; this.organiser.error = null; },
      (e: unknown) => { this.organiser.error = (e as Error).message || String(e); })
      .finally(() => { this.organiser.loading = null; this.changed(); });
    return this.organiser.loading;
  }
  feeError(): string | null {
    const cfg = this.config;
    if (!cfg) return 'no configuration';
    if (!this.organiser.lock) return this.organiser.error;
    try { organiserFeeCheck(cfg, this.organiser.lock); return null; } catch (e) { return e instanceof ConfigError ? e.message : String(e); }
  }

  params(): SwitchParams {
    const R = SWITCH_PARAM_RANGES;
    return { heartbeatBlocks: this.heartbeat, heartbeatTip: shannons(this.tip), keygenTip: R.keygenTip.default, maxFee: R.maxFee.default,
      organiserFee: shannons(this.config?.organiser_fee_ckb ?? 0) };
  }

  // ---- create ----
  private setStatus(next: Partial<CreateStatus>): void { this.status = { ...this.status, ...next }; this.changed(); }

  /**
   * Builds Create (T and I), claims T at the messenger with the hash of a fresh owner code (before the signature),
   * signs and sends, waits for the guardians' commits, verifies hard-fail, builds the descriptor, signs Arm and
   * wraps K. A verification failure stops with the rule number; there is no override.
   */
  async create(ackPhrase: string): Promise<void> {
    const cfg = this.config, driver = this.deps.driver;
    if (this.status.phase !== 'idle' && this.status.phase !== 'failed') return;
    if (this.status.sent) return; // never a second switch from one flow
    try {
      if (!cfg || !driver) throw new Error('no chain connection');
      if (this.drill) validateDrillTerm(cfg, this.termSeconds()); // never a drill on mainnet or outside 30 min – 48 h
      const fee = this.feeError();
      if (fee) throw new ConfigError(fee);
      if (!this.lettersValid() || !this.recipientsValid() || !this.guardiansValid(ackPhrase)) throw new Error('incomplete');
      const chosen = this.chosen();
      const n = chosen.length, t = this.t!, m = this.mandatory.length;
      const now = this.now();
      const deadline = this.deadlineFrom(now);
      const params = this.params();
      this.setStatus({ phase: 'claim', done: 0, n, error: null, rule: null });
      const K = this.rng(32);
      const prepared = await driver.prepareCreate({ config: cfg, deadline, runners: chosen, params,
        validation: { t, ...(m > 0 ? { mandatory: { j: m, m }, acknowledgedOneOfOne: this.ackOk(ackPhrase) } : {}) } });
      let ownerCode: OwnerCode | null = null;
      const messenger = this.messengerOn ? this.deps.messenger?.(cfg) ?? null : null;
      if (messenger) {
        ownerCode = newOwnerCode(cfg.network, prepared.T, this.rng);
        await messenger.claim(cfg.network, prepared.T, ownerCode.adminHash);
        this.storage?.setItem(OWNER_CODE_KEY(cfg.network, prepared.T), ownerCode.code);
      }
      this.created = { network: cfg.network, T: prepared.T.toLowerCase(), I: prepared.I.toLowerCase(), K, descriptor: null, envelopes: null, deadline,
        createdAt: now, chosen, ownerCode, claimed: ownerCode !== null };
      this.setStatus({ phase: 'sign' });
      await prepared.send();
      // saved now, so that a switch whose Arm fails can still be found and cancelled in My switches
      this.remember();
      this.setStatus({ phase: 'wait', sent: true });
      await driver.waitForCommits(cfg, prepared.T, n, (done) => this.setStatus({ done }));
      this.setStatus({ phase: 'verify', done: n });
      const plan: DescriptorPlan = {
        K, access_tree: accessTree(n, t, m), created_at: now,
        nodes: chosen.map((r) => ({ runner_lock_hash: r.R, service_pubkey: r.servicePubkey, ...(r.peerId ? { peer_id: r.peerId } : {}), ...(r.label ? { label: r.label } : {}) })),
      };
      const descriptor = await driver.describe(cfg, plan, prepared.T);
      this.setStatus({ phase: 'arm' });
      await driver.arm(cfg, prepared.T, descriptor, params);
      const envelopes = await driver.wrap(cfg, K, descriptor);
      this.created = { ...this.created, descriptor, envelopes };
      this.remember();
      this.setStatus({ phase: 'done' });
    } catch (e) {
      const rule = e instanceof VerificationError ? e.rule : null;
      this.setStatus({ phase: 'failed', error: (e as Error).message || String(e), rule });
    }
  }

  /** The local list of switches (My switches): network, T and what is public. */
  private remember(): void {
    const c = this.created;
    if (!c || !this.storage) return;
    upsertSwitch(this.storage, { network: c.network, T: c.T, I: c.I, created_at: c.createdAt, deadline: c.deadline, sender_label: this.senderLabel.trim(),
      rhythm: rhythmIso(this.rhythm), drill: this.drill, messenger: c.claimed,
      ...(c.descriptor ? { descriptor_hash: descriptorHash(c.descriptor), descriptor: c.descriptor } : {}),
      heartbeat_blocks: this.heartbeat, heartbeat_tip_ckb: this.tip, recipients: this.recipients.map((r) => ({ index: r.index, name: r.name.trim(), language: r.language })) });
  }

  // ---- seal ----
  /** Encrypts each recipient's bundle and builds one vault per recipient (SPEC.md §4.3). */
  seal(): Promise<void> {
    if (this.vaults) return Promise.resolve();
    if (this.sealing) return this.sealing;
    const c = this.created, cfg = this.config;
    this.sealing = (async () => {
      if (!c || !c.K || !c.descriptor || !c.envelopes || !cfg) throw new Error('the switch is not armed');
      const out: SealedVault[] = [];
      for (const r of this.recipients) {
        const letter = this.letterFor(r);
        const sealed = await encryptBundle(c.K, c.I, r.index, letter, this.rng, { maxBytes: cfg.max_vault_bytes });
        const html = buildVault({ descriptor: c.descriptor, envelopes: c.envelopes, deadline: c.deadline, recipient: letter.recipient, sealed,
          meta: { network: c.network, language: r.language, sender_label: letter.sender_label, drill: this.drill, created_at: c.createdAt, app_url: cfg.app_url, grace_seconds: this.graceSeconds() } });
        out.push({ index: r.index, name: letter.recipient.name, language: r.language, fileName: vaultFileName(letter.sender_label, letter.recipient.name, c.T, this.drill), html });
      }
      this.vaults = out;
      this.sealError = null;
    })().catch((e: unknown) => { this.sealError = (e as Error).message || String(e); }).finally(() => { this.sealing = null; this.changed(); });
    return this.sealing;
  }

  zip(): Uint8Array { return zipVaults((this.vaults ?? []).map((v) => ({ name: v.fileName, content: v.html }))); }
  zipName(): string { return `${this.drill ? 'drill-' : ''}vaults-${(this.created?.T ?? '0x').slice(2, 10)}.zip`; }

  /**
   * The owner code is rendered on one screen only (`ownerCodeShownIn` = that screen instance). Once that screen is
   * left, the code is dropped from memory when this browser's storage holds it; afterwards it is rendered only on a
   * click on "show".
   */
  ownerCodeShownIn: number | null = null;
  ownerCodeVisible(screen: number): boolean {
    if (!this.ownerCode()) return false;
    if (this.ownerCodeShownIn === null) this.ownerCodeShownIn = screen;
    if (this.ownerCodeShownIn === screen) return true;
    this.ownerCodeDisplayed = true;
    const c = this.created;
    if (c?.ownerCode && this.storage?.getItem(OWNER_CODE_KEY(c.network, c.T)) === c.ownerCode.code) this.created = { ...c, ownerCode: null };
    return false;
  }
  /** The bearer secret A of the owner code. */
  ownerSecret(): Uint8Array | null {
    const code = this.ownerCode();
    if (!code) return null;
    try { return parseOwnerCode(code).A; } catch { return null; }
  }

  /** The owner code: from memory, or from this browser's storage. */
  ownerCode(): string | null {
    const c = this.created;
    if (!c) return null;
    return c.ownerCode?.code ?? this.storage?.getItem(OWNER_CODE_KEY(c.network, c.T)) ?? null;
  }

  ics(language: Language): string {
    const c = this.created!;
    return icsForDeadline({ T: c.T, deadline: c.deadline, language, drill: this.drill, termSeconds: c.deadline - c.createdAt, appUrl: this.config?.app_url, now: this.now() });
  }
  icsName(): string { return `${this.drill ? 'drill-' : ''}deadline-${(this.created?.T ?? '0x').slice(2, 10)}.ics`; }

  // ---- owner archive ----
  static archiveStrong(passphrase: string): boolean { return passphraseStrength(passphrase) >= ARCHIVE_MIN_STRENGTH; }
  archiveName(): string { return `owner-archive-${(this.created?.T ?? '0x').slice(2, 10)}.dmsa`; }
  archiveContents(): ArchiveContents {
    const c = this.created;
    if (!c || !c.K) throw new Error('nothing to archive');
    return {
      network: c.network, T: c.T, I: c.I, K: bytesToHex(c.K), sender_label: this.senderLabel.trim(), rhythm: rhythmIso(this.rhythm),
      letters: this.recipients.map((r) => this.letterFor(r)),
      recipients: this.recipients.map((r) => ({ index: r.index, name: r.name.trim(), language: r.language, email: r.email.trim() || null, link: r.link.trim() || null })),
    };
  }
  /** Seals the owner archive (scrypt + AES-GCM); keeps it open in this session. Returns the file content. */
  async archive(passphrase: string): Promise<Uint8Array> {
    if (!WriteSession.archiveStrong(passphrase)) throw new Error('passphrase too weak');
    const file = await sealArchive(this.archiveContents(), passphrase, this.rng);
    this.archivePassphrase = passphrase;
    return utf8(JSON.stringify(file, null, 2));
  }

  // ---- hand over ----
  linkError(r: RecipientDraft): string | null {
    if (r.link.trim() === '') return null;
    try { checkLink(r.link.trim()); return null; } catch (e) { return (e as Error).message; }
  }
  /**
   * Encrypts the links with keys derived from K and sends the record to the messenger (when on); then drops K and
   * the letters from memory, unless the owner archive is kept open.
   */
  async handover(): Promise<void> {
    const c = this.created, cfg = this.config;
    try {
      if (!c || !c.K || !c.descriptor || !c.envelopes || !cfg) throw new Error('nothing to hand over');
      for (const r of this.recipients) { const err = this.linkError(r); if (err) throw new Error(err); }
      const A = c.claimed ? this.ownerSecret() : null;
      if (c.claimed && !A) throw new Error('the owner code is missing from this browser');
      const messenger = c.claimed && this.messengerOn ? this.deps.messenger?.(cfg) ?? null : null;
      if (messenger && A) {
        const recipients = [];
        for (const r of this.recipients) {
          const url = r.link.trim();
          recipients.push({ index: r.index, name: r.name.trim(), language: r.language, email: r.email.trim() || null,
            tell_now: (this.drill || r.tellNow) && r.email.trim() !== '', link: url ? await encryptLink(c.K, c.I, r.index, url, this.rng) : null });
        }
        const record = buildRecord({ network: c.network, T: c.T, I: c.I, drill: this.drill, sender_label: this.senderLabel.trim(), rhythm: rhythmIso(this.rhythm),
          descriptor: c.descriptor, envelopes: c.envelopes, owner: { email: this.messenger.email.trim() || null, language: getLanguage(), reminders: this.messenger.reminders },
          recipients });
        await messenger.put(record, A);
      }
      this.handedOver = true;
      this.handoverError = null;
      if (this.archivePassphrase === null) this.dropSecrets();
    } catch (e) {
      this.handoverError = (e as Error).message || String(e);
    }
    this.changed();
  }

  /** Forgets K and the letters (the vaults hold only ciphertext and stay downloadable in this session). */
  dropSecrets(): void {
    if (this.created?.K) { this.created.K.fill(0); this.created = { ...this.created, K: null }; }
    this.shared = { text: '', files: [] };
    for (const r of this.recipients) { r.text = ''; r.note = ''; r.files = []; }
    this.dropped = true;
  }
}

function safeStorage(): StorageLike | null {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

export type { LetterFile };
