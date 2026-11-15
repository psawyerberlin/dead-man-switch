// `#/open` and `#/open/demo` (SPEC.md §3.3.4). A dropped vault runs its own code (the CRT kit and the DMS opener it
// carries) inside a sandboxed frame of this page: nothing is uploaded, the file never leaves the browser. `?T=` only
// reads the status of a switch from the chain. The practice vault is built at build time from a fixed sample letter.
import type { SwitchSummary } from '../../core/chain';
import type { Language } from '../../core/bundle';
import type { Network } from '../../core/config';
import { formatDate, getLanguage, t } from '../../core/i18n';
import { normaliseSwitchId } from '../../core/switches';
import { parseVault } from '../../core/vault';
import { linkButton } from '../components/button';
import { sheet } from '../components/sheet';
import { h, mount, nextId } from '../dom';
import { note } from '../write/controls';

export interface OpenApp {
  network: () => Network;
  /** reads switch T from the chain (null: no chain connection) */
  status: ((network: Network, T: string) => Promise<SwitchSummary>) | null;
  /** the practice vaults by language (`virtual:dms-practice`, built at build time; null: unavailable) */
  practice: (() => Promise<Record<Language, string>>) | null;
}

/** The frame a vault runs in: scripts and downloads, but no access to this page (no `allow-same-origin`). */
export const VAULT_SANDBOX = 'allow-scripts allow-downloads allow-modals allow-popups';

export function vaultFrame(html: string, title: string): HTMLIFrameElement {
  const frame = h('iframe', { class: 'dms-vault-frame', title, sandbox: VAULT_SANDBOX, referrerpolicy: 'no-referrer' });
  frame.srcdoc = html;
  return frame;
}

function statusLine(s: SwitchSummary): HTMLElement {
  if (s.state === 'released') return note(t('open.status.released', { count: s.nodeCount, n: s.nodeCount }), 'ok', { 'data-status': 'released' });
  if (s.state === 'cancelled') return note(t('open.status.cancelled_undated'), 'warn', { 'data-status': 'cancelled' });
  if (s.state === 'absent') return note(t('open.status.absent'), 'warn', { 'data-status': 'absent' });
  return note(t('open.status.not_yet', { deadline: s.deadline !== null ? formatDate(s.deadline) : '—' }), 'soft', { 'data-status': 'not_yet' });
}

function statusPanel(query: URLSearchParams, app: OpenApp): HTMLElement | null {
  const raw = query.get('T');
  if (!raw) return null;
  const box = h('div', { class: 'dms-open__status', 'aria-live': 'polite' });
  let T: string;
  try { T = normaliseSwitchId(raw); } catch { mount(box, note(t('mine.id_invalid'), 'error')); return box; }
  const network = query.get('network') === 'mainnet' ? 'mainnet' : app.network();
  if (!app.status) { mount(box, note(t('open.status.offline'))); return box; }
  mount(box, note(t('open.reading')));
  void app.status(network, T).then((s) => mount(box, h('p', {}, h('code', {}, T)), statusLine(s)), () => mount(box, note(t('open.status.offline'))));
  return box;
}

/** The text of a dropped file (`File.text`, or a FileReader where it is missing). */
export function readText(file: Blob): Promise<string> {
  if (typeof (file as Blob & { text?: unknown }).text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ''));
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

export function openScreen(query: URLSearchParams, app: OpenApp): HTMLElement {
  const id = nextId('vault');
  const picker = h('input', { type: 'file', id, accept: '.html,text/html', class: 'dms-visually-hidden', 'data-k': 'vault-file' });
  const zone = h('label', { for: id, class: 'dms-dropzone dms-open__drop' }, t('open.drop'));
  const out = h('div', { class: 'dms-open__out', 'aria-live': 'polite' });
  const show = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    const html = await readText(file);
    try { parseVault(html); } catch { mount(out, note(t('open.error.not_vault'), 'error', { 'data-open': 'error' })); return; }
    mount(out, note(t('open.running'), 'soft'), vaultFrame(html, t('open.frame_title')));
  };
  picker.addEventListener('change', () => void show(picker.files?.[0]));
  zone.addEventListener('dragover', (ev) => { ev.preventDefault(); zone.classList.add('is-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('is-over'));
  zone.addEventListener('drop', (ev) => { ev.preventDefault(); zone.classList.remove('is-over'); void show((ev as DragEvent).dataTransfer?.files?.[0]); });
  return h('div', { class: 'dms-screen dms-open' },
    sheet({ title: t('open.title'), level: 1 },
      h('ol', { class: 'dms-open__steps' }, h('li', {}, t('open.step1')), h('li', {}, t('open.step2')), h('li', {}, t('open.step3'))),
      picker, zone, h('p', { class: 'dms-soft' }, t('open.local_only')), out),
    statusPanel(query, app),
    sheet({ title: t('open.practice_link') }, h('p', {}, t('open.practice_note')),
      h('div', { class: 'dms-actions' }, linkButton(t('open.practice_open'), '#/open/demo', { kind: 'secondary' }))));
}

export function practiceScreen(app: OpenApp): HTMLElement {
  const out = h('div', { class: 'dms-open__out', 'aria-live': 'polite' }, note(t('app.loading')));
  const lang = getLanguage();
  const load = app.practice ?? (() => Promise.reject(new Error('no practice vault')));
  void load().then((vaults) => mount(out, vaultFrame(vaults[lang] ?? vaults.en, t('open.practice'))),
    () => mount(out, note(t('open.practice_failed'), 'error')));
  return h('div', { class: 'dms-screen dms-open dms-open--practice' },
    sheet({ title: t('open.practice_title'), level: 1 },
      h('p', { class: 'dms-banner-practice', role: 'note', 'data-practice': '' }, t('open.practice')),
      h('p', {}, t('open.practice_note')), out,
      h('div', { class: 'dms-actions' }, linkButton(t('nav.open'), '#/open', { kind: 'quiet' }))));
}
