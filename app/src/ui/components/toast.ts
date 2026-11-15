// Toasts: short messages in a polite live region (errors: assertive), with an icon class so the kind is not shown
// by colour alone. One region per document, created on first use.
import { t } from '../../core/i18n';
import { h } from '../dom';

export type ToastKind = 'info' | 'ok' | 'error';

export interface ToastOptions {
  kind?: ToastKind;
  /** ms before it disappears; 0 keeps it until closed */
  timeout?: number;
}

function region(doc: Document, kind: ToastKind): HTMLElement {
  const id = kind === 'error' ? 'dms-toasts-alert' : 'dms-toasts';
  let el = doc.getElementById(id);
  if (!el) {
    el = h('div', { id, class: 'dms-toasts', 'aria-live': kind === 'error' ? 'assertive' : 'polite', role: kind === 'error' ? 'alert' : 'status',
      'aria-label': t('toast.region') });
    doc.body.append(el);
  }
  return el;
}

export function toast(message: string, opts: ToastOptions = {}, doc: Document = document): HTMLElement {
  const kind = opts.kind ?? 'info';
  const close = h('button', { type: 'button', class: 'dms-toast__close', 'aria-label': t('action.close') }, '×');
  const el = h('div', { class: `dms-toast dms-toast--${kind}` }, h('span', { class: 'dms-toast__icon', 'aria-hidden': 'true' }),
    h('span', { class: 'dms-toast__text' }, message), close);
  close.addEventListener('click', () => el.remove());
  region(doc, kind).append(el);
  const timeout = opts.timeout ?? (kind === 'error' ? 0 : 6000);
  if (timeout > 0) setTimeout(() => el.remove(), timeout);
  return el;
}
