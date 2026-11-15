// The DMS opener (SPEC.md §3.3.4, aiworker/01-dms-core.md phase 3): the script every vault carries as CRT's
// `application.script`. It registers `window.crtApplication = { onKey }` when it is evaluated (before the kit can
// run any recovery), renders its own UI into the kit's `<div id="crt-application">`, reads the chain and recovers
// only through `window.CRT_KIT.api` (CRT §8.2), and on `onKey(K)` derives `letterKey(K, I, r)`, decrypts this
// recipient's letter and shows it. Nothing leaves the page.
import { aesGcmDecrypt, DecryptError } from '../core/aead';
import { BundleError, decodeBundle, letterAad, type Letter } from '../core/bundle';
import { fromBase64, hexToBytes } from '../core/bytes';
import { formatBytes, formatDate, isLanguage, LANGUAGES, translate, type Language, type Params } from '../core/i18n';
import { letterKey } from '../core/keys';
import type { VaultPayload } from '../core/vault';
import { renderMarkdown } from './markdown';
import { OPENER_CSS } from './styles';

// ---- what the CRT kit exposes (CRT client/kit/recovery.ts) -------------------------------------------------------

export interface KitSwitchStatus {
  alive: boolean;
  nodes: { R: string; state: number; deadline: bigint; descriptorHash: string }[];
  deadline: bigint | null;
  descriptorHashMatches: boolean;
  released: number;
}
type ThresholdTree = { kind: 'threshold'; t: number; n: number };
export interface KitDescriptor {
  identity: string;
  type_id: string;
  nodes: { runner_lock_hash: string; label?: string }[];
  access_tree: ThresholdTree | { kind: 'xor'; branches: ThresholdTree[] };
}
export interface KitApi {
  readSwitch(rpcUrls?: string[]): Promise<KitSwitchStatus>;
  collectReleases(rpcUrls?: string[]): Promise<Map<string, string>>;
  recover(releases?: Map<string, string | Uint8Array> | string[]): Promise<Uint8Array>;
}
export interface CrtKit {
  descriptor?: KitDescriptor;
  application?: { name: string; version: string; payload: VaultPayload };
  api?: KitApi;
}
interface LeafReport { position: number; runner_lock_hash: string; status: string }

export type OpenerWindow = Window & typeof globalThis & {
  CRT_KIT?: CrtKit;
  crtApplication?: { onKey(K: Uint8Array): unknown };
  DMS_PRACTICE?: boolean;
  /** the practice vault's key (hex or bytes), embedded by `#/open/demo` */
  DMS_PRACTICE_KEY?: string | Uint8Array;
  __dmsOpener?: OpenerHandle;
};

// ---- state -----------------------------------------------------------------------------------------------------

type Message = { key: string; params?: Params };
type Chain = { kind: 'none' } | { kind: 'reading' } | { kind: 'offline' } | { kind: 'status'; status: KitSwitchStatus };

interface OpenedLetter { letter: Letter; urls: string[] }

interface State {
  lang: Language;
  chain: Chain;
  busy: string | null;
  error: Message | null;
  hints: Message[];
  pasted: string;
  opened: OpenedLetter | null;
}

export interface OpenerHandle {
  /** the hook the kit calls after recovery; resolves to true when the letter is shown */
  onKey(K: Uint8Array | string): Promise<boolean>;
  setLanguage(lang: Language): void;
  checkChain(): Promise<void>;
  readonly state: Readonly<State>;
  readonly root: HTMLElement | null;
}

/** Keys needed to recover: `t` of a threshold tree, the sum over the groups of an xor tree (each group is needed). */
export function piecesNeeded(tree: KitDescriptor['access_tree'] | undefined): number {
  if (!tree) return 0;
  return tree.kind === 'threshold' ? tree.t : tree.branches.reduce((s, b) => s + b.t, 0);
}

const NONCE_HEX = /^0x[0-9a-fA-F]{24}$/;
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?Z/;

function toKeyBytes(K: unknown): Uint8Array | null {
  if (typeof K === 'string') {
    try { return hexToBytes(K.trim()); } catch { return null; }
  }
  if (ArrayBuffer.isView(K)) return new Uint8Array(K.buffer, K.byteOffset, K.byteLength);
  return null;
}

/** Installs the opener into `win` (idempotent). */
export function installOpener(win: Window): OpenerHandle {
  const w = win as OpenerWindow;
  if (w.__dmsOpener) return w.__dmsOpener;
  const doc = w.document;
  const kit = (): CrtKit => w.CRT_KIT ?? {};
  const payload = (): VaultPayload | null => kit().application?.payload ?? null;
  const practice = (): boolean => w.DMS_PRACTICE === true;

  const initial = payload()?.language;
  const state: State = {
    lang: isLanguage(initial) ? initial : 'en', chain: { kind: 'none' }, busy: null, error: null, hints: [], pasted: '', opened: null,
  };
  let root: HTMLElement | null = null;
  const tr = (key: string, params?: Params): string => translate(state.lang, key, params);

  // ---- DOM helpers ----
  type Child = Node | string | null | false | undefined;
  function h(tag: string, attrs: Record<string, string | boolean | undefined> = {}, ...children: Child[]): HTMLElement {
    const el = doc.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === false) continue;
      el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children) if (c !== null && c !== false && c !== undefined) el.append(typeof c === 'string' ? doc.createTextNode(c) : c);
    return el;
  }
  function button(key: string, onClick: () => void, primary = false, disabled = false): HTMLElement {
    const b = h('button', { type: 'button', class: primary ? 'primary' : undefined, disabled: disabled || undefined }, tr(key));
    b.addEventListener('click', onClick);
    return b;
  }
  const msg = (m: Message, cls?: string): HTMLElement => h('p', { class: cls }, tr(m.key, m.params));

  // ---- facts read from the page ----
  function integrity(): 'match' | 'mismatch' | 'pending' {
    const c = doc.getElementById('crt-verify')?.className ?? '';
    return /\bmismatch\b/.test(c) ? 'mismatch' : /\bmatch\b/.test(c) ? 'match' : 'pending';
  }
  /** The deadline printed on the kit's certificate when the vault was made (unix seconds), if any. */
  function certificateDeadline(): number | null {
    for (const th of Array.from(doc.querySelectorAll('#crt-certificate th, table th'))) {
      if ((th.textContent ?? '').trim() !== 'Deadline') continue;
      const m = ISO.exec(th.nextElementSibling?.textContent ?? '');
      if (m) { const t = Date.parse(m[0]); if (Number.isFinite(t)) return Math.floor(t / 1000); }
    }
    return null;
  }
  function practiceKey(): Uint8Array | null {
    const k = w.DMS_PRACTICE_KEY ?? doc.getElementById('dms-practice-key')?.textContent ?? null;
    return k === null ? null : toKeyBytes(k);
  }
  function guardianLabel(R: string): string {
    const n = kit().descriptor?.nodes.find((x) => x.runner_lock_hash.toLowerCase() === R.toLowerCase());
    return n?.label || `${R.slice(0, 10)}…`;
  }

  // ---- rendering ----
  function render(): void {
    if (!root) return;
    const p = payload();
    const d = state.lang;
    root.replaceChildren();
    root.setAttribute('lang', d);
    root.className = 'dms';
    doc.documentElement.setAttribute('lang', d);
    doc.body.classList.toggle('dms-letter-open', state.opened !== null);

    const chrome = h('div', { class: 'dms-chrome' });
    if (p?.drill) chrome.append(h('div', { class: 'dms-ribbon', 'aria-hidden': 'true' }, tr('drill.ribbon')));
    const select = h('select', { id: 'dms-language', 'aria-label': tr('app.language') }) as HTMLSelectElement;
    for (const l of LANGUAGES) select.append(h('option', { value: l, selected: l === d }, translate(l, 'app.language_name')));
    select.addEventListener('change', () => { if (isLanguage(select.value)) { setLanguage(select.value); doc.getElementById('dms-language')?.focus(); } });
    chrome.append(h('header', { class: 'dms-head' }, h('span', { class: 'dms-name dms-serif' }, tr('app.name')),
      h('label', {}, select)));
    if (practice()) chrome.append(h('div', { class: 'dms-banner practice', role: 'note' }, tr('open.practice')));
    if (p?.drill) chrome.append(h('div', { class: 'dms-banner drill', role: 'note' }, tr('open.drill_banner')));
    root.append(chrome);

    if (!p) {
      root.append(h('section', { class: 'dms-sheet' }, msg({ key: 'open.error.not_vault' }, 'dms-error')));
      return;
    }

    // 1. integrity
    const integ = integrity();
    const status = state.chain.kind === 'status' ? state.chain.status : null;
    const integritySheet = h('section', { class: 'dms-chrome' },
      h('div', { class: `dms-banner ${integ === 'match' ? 'ok' : integ === 'mismatch' ? 'bad' : ''}`, role: 'status' },
        tr(integ === 'match' ? 'open.integrity.match' : integ === 'mismatch' ? 'open.integrity.mismatch' : 'open.integrity.pending')));
    if (status && status.nodes.length > 0) {
      integritySheet.append(h('div', { class: `dms-banner ${status.descriptorHashMatches ? 'ok' : 'bad'}` },
        tr(status.descriptorHashMatches ? 'open.integrity.chain_match' : 'open.integrity.chain_mismatch')));
    }
    root.append(integritySheet);

    // the letter, once opened
    if (state.opened) root.append(renderLetter(state.opened));

    // 2. status and 3. open
    if (!state.opened) root.append(renderStatus(p, status));

    // progress and errors (aria-live)
    const live = h('div', { class: 'dms-chrome', 'aria-live': 'polite', id: 'dms-live' });
    if (state.busy) live.append(msg({ key: state.busy }, 'dms-soft'));
    if (state.error) live.append(msg(state.error, 'dms-error'));
    for (const hint of state.hints) live.append(msg(hint, 'dms-soft'));
    root.append(live);
    root.append(h('p', { class: 'dms-chrome dms-soft' }, tr('open.certificate_note')));
  }

  function renderStatus(p: VaultPayload, status: KitSwitchStatus | null): HTMLElement {
    const sheet = h('section', { class: 'dms-sheet dms-chrome', id: 'dms-status' });
    const sender = p.sender_label;
    sheet.append(h('h1', {}, tr('open.title')));
    sheet.append(msg({ key: 'open.sealed_by', params: { sender, recipient: p.recipient.name, date: formatDate(p.created_at, state.lang) } }));
    const deadline = status?.deadline != null ? Number(status.deadline) : certificateDeadline();
    if (deadline !== null) sheet.append(msg({ key: 'open.opens_if', params: { sender, deadline: formatDate(deadline, state.lang) } }));

    const actions = h('div', { class: 'dms-actions' });
    const busy = state.busy !== null;
    if (practice()) {
      actions.append(button('open.practice_open', () => { void openPractice(); }, true, busy));
      sheet.append(actions);
      return sheet;
    }
    const need = piecesNeeded(kit().descriptor?.access_tree);
    const n = kit().descriptor?.nodes.length ?? 0;
    if (state.chain.kind === 'reading') sheet.append(msg({ key: 'open.reading' }, 'dms-soft'));
    else if (state.chain.kind === 'offline') sheet.append(msg({ key: 'open.status.offline' }));
    else if (status) {
      if (status.released >= need && need > 0) {
        sheet.append(msg({ key: 'open.status.released', params: { count: status.released, n: n || status.nodes.length } }));
        actions.append(button('open.recover', () => { void recoverOnline(); }, true, busy));
      } else if (!status.alive) {
        sheet.append(msg({ key: 'open.status.cancelled_undated' }));
      } else if (status.released > 0) {
        sheet.append(msg({ key: 'open.short', params: { have: status.released, need, missing: need - status.released } }));
      } else {
        const dl = status.deadline != null ? Number(status.deadline) : certificateDeadline();
        sheet.append(msg({ key: 'open.status.not_yet', params: { deadline: dl === null ? '—' : formatDate(dl, state.lang) } }));
      }
    }
    if (kit().api) actions.prepend(button('open.check', () => { void checkChain(); }, false, busy));
    sheet.append(actions);

    // offline: paste the released pieces
    const ta = h('textarea', { id: 'dms-paste', rows: '4', spellcheck: 'false', 'aria-describedby': 'dms-paste-hint' }) as HTMLTextAreaElement;
    ta.value = state.pasted;
    ta.addEventListener('input', () => { state.pasted = ta.value; });
    sheet.append(h('h2', {}, tr('open.paste_title')), h('p', { class: 'dms-soft', id: 'dms-paste-hint' }, tr('open.paste_hint')),
      h('label', { 'aria-label': tr('open.paste_title') }, ta),
      h('div', { class: 'dms-actions' }, button('open.paste_button', () => { void recoverPasted(); }, false, busy || !kit().api)));
    return sheet;
  }

  function renderLetter(o: OpenedLetter): HTMLElement {
    const l = o.letter;
    const sheet = h('article', { class: 'dms-sheet dms-letter', id: 'dms-letter', lang: l.language });
    sheet.append(h('h1', {}, translate(l.language, 'open.letter_from', { sender: l.sender_label })));
    const text = h('div', { class: 'dms-text' });
    renderMarkdown(l.text_markdown, text, w);
    sheet.append(text);
    if (l.note_markdown.trim()) {
      const note = h('div', { class: 'dms-note-text' });
      renderMarkdown(l.note_markdown, note, w);
      sheet.append(h('aside', { class: 'dms-note' }, h('h2', {}, tr('open.note')), note));
    }
    sheet.append(h('h2', {}, tr('open.files')));
    if (l.files.length === 0) sheet.append(msg({ key: 'open.no_files' }, 'dms-soft'));
    else {
      const list = h('ul', { class: 'dms-files' });
      l.files.forEach((f, i) => {
        list.append(h('li', {}, h('span', { class: 'dms-file-name' }, f.name), h('span', { class: 'dms-soft' }, formatBytes(f.size, state.lang)),
          h('a', { class: 'dms-button', href: o.urls[i], download: safeFileName(f.name), 'aria-label': `${tr('open.download')}: ${f.name}` }, tr('open.download'))));
      });
      sheet.append(list);
    }
    sheet.append(h('div', { class: 'dms-actions' }, button('open.print', () => w.print(), true)));
    return sheet;
  }

  // ---- actions ----
  function update(patch: Partial<State>): void { Object.assign(state, patch); render(); }

  function setLanguage(lang: Language): void {
    if (!isLanguage(lang)) return;
    update({ lang });
  }

  async function checkChain(): Promise<void> {
    const api = kit().api;
    if (!api || practice()) return;
    update({ chain: { kind: 'reading' }, error: null });
    try {
      const status = await api.readSwitch();
      update({ chain: { kind: 'status', status } });
    } catch {
      update({ chain: { kind: 'offline' } });
    }
  }

  /** Turns a failed recovery (CRT `RecoveryError` with its report) into plain sentences. */
  function explainRecovery(e: unknown): void {
    const report = (e as { report?: { leaves?: LeafReport[] } } | null)?.report;
    if (!report?.leaves) {
      const network = e instanceof TypeError || /fetch|network|rpc|connect/i.test(String((e as Error)?.message ?? ''));
      update({ busy: null, error: { key: network ? 'error.rpc' : 'open.error.recover' }, hints: [] });
      return;
    }
    const hints: Message[] = report.leaves.filter((l) => l.status === 'bad-privkey' || l.status === 'commitment-mismatch')
      .map((l) => ({ key: 'open.bad_piece', params: { label: guardianLabel(l.runner_lock_hash) } }));
    const have = report.leaves.filter((l) => l.status === 'ok').length;
    const need = piecesNeeded(kit().descriptor?.access_tree);
    if (have < need) hints.push({ key: 'open.short', params: { have, need, missing: need - have } });
    update({ busy: null, error: { key: 'open.error.recover' }, hints });
  }

  async function recoverWith(releases?: string[]): Promise<void> {
    const api = kit().api;
    if (!api) return;
    update({ busy: 'open.decrypting', error: null, hints: [] });
    try {
      // the kit calls `onKey` itself after a successful recovery
      await api.recover(releases);
      if (state.busy) update({ busy: null });
    } catch (e) {
      explainRecovery(e);
    }
  }
  const recoverOnline = (): Promise<void> => recoverWith();
  const recoverPasted = (): Promise<void> => recoverWith(state.pasted.split('\n').filter((s) => s.trim()));

  async function openPractice(): Promise<void> {
    const k = practiceKey();
    await onKey(k ?? new Uint8Array(0));
  }

  function fail(key: string): false {
    update({ busy: null, error: { key }, hints: [] });
    return false;
  }

  async function onKey(K: Uint8Array | string): Promise<boolean> {
    mount();
    const key = toKeyBytes(K);
    if (!key || key.length !== 32) return fail('open.error.key_length');
    const p = payload();
    const I = kit().descriptor?.identity;
    if (!p || !I || typeof p.nonce !== 'string' || !NONCE_HEX.test(p.nonce) || typeof p.ciphertext_b64 !== 'string') return fail('open.error.not_vault');
    const r = p.recipient?.index;
    update({ busy: 'open.decrypting', error: null, hints: [] });
    let letter: Letter;
    try {
      const plaintext = await aesGcmDecrypt(letterKey(key, I, r), hexToBytes(p.nonce), letterAad(I, r), fromBase64(p.ciphertext_b64));
      letter = decodeBundle(plaintext);
      if (letter.recipient.index !== r) return fail('open.error.decrypt');
    } catch (e) {
      if (e instanceof BundleError && e.code === 'version') return fail('open.error.version');
      if (e instanceof DecryptError || e instanceof BundleError) return fail('open.error.decrypt');
      return fail('open.error.decrypt');
    }
    if (state.opened) for (const u of state.opened.urls) w.URL.revokeObjectURL?.(u);
    const urls = letter.files.map((f) => {
      const bytes = fromBase64(f.data_b64);
      const type = !f.mime || /html|svg|xml|javascript/i.test(f.mime) ? 'application/octet-stream' : f.mime;
      return w.URL.createObjectURL(new w.Blob([bytes as BlobPart], { type }));
    });
    update({ busy: null, error: null, hints: [], opened: { letter, urls } });
    return true;
  }

  // ---- mounting ----
  function mount(): void {
    if (root) return;
    if (!doc.getElementById('dms-opener-style')) {
      const style = h('style', { id: 'dms-opener-style' });
      style.textContent = OPENER_CSS;
      (doc.head ?? doc.documentElement).append(style);
    }
    doc.body.classList.add('dms-body');
    root = doc.getElementById('crt-application');
    if (!root) { root = h('div', { id: 'crt-application' }); doc.body.append(root); }
    // the recipient sees the letter first; the kit's certificate and tools follow below
    if (doc.body.firstElementChild !== root) doc.body.insertBefore(root, doc.body.firstChild);
    render();
    if (!practice() && kit().api && payload()) void checkChain();
  }

  const handle: OpenerHandle = {
    onKey, setLanguage, checkChain,
    get state() { return state; },
    get root() { return root; },
  };
  w.__dmsOpener = handle;
  // registered synchronously, before the kit can recover anything (it calls `crtApplication.onKey(K)` afterwards)
  w.crtApplication = { onKey: (K: Uint8Array) => onKey(K) };
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', mount);
  else mount();
  return handle;
}

/** The last path segment of a file name, without control characters, for the `download` attribute. */
export function safeFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex -- control characters are exactly what is removed
  const s = base.replace(/[\u0000-\u001f\u007f]+/g, '_').replace(/^\.+/, '').trim();
  return s || 'file';
}
