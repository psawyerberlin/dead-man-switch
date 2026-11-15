// A modal dialog (SPEC.md §8): role="dialog", aria-modal, labelled by its title, focus trapped inside, Escape and
// the close button dismiss it, focus returns to where it was. Built on a plain element (not <dialog>) so it behaves
// the same in every browser and in jsdom.
import { t } from '../../core/i18n';
import { focusables, trapFocus } from '../a11y';
import { h, nextId, type Child } from '../dom';

export interface DialogOptions {
  title: string;
  body: Child[];
  /** buttons in the footer; the first focusable one receives focus unless `initialFocus` is given */
  actions?: HTMLElement[];
  initialFocus?: HTMLElement;
  /** called once, whatever closed the dialog */
  onClose?: () => void;
  /** false: Escape and the backdrop do not close it (e.g. while a signature is pending) */
  dismissible?: boolean;
}

export interface DialogHandle {
  el: HTMLElement;
  close(): void;
}

export function openDialog(opts: DialogOptions, parent: HTMLElement = document.body): DialogHandle {
  const doc = parent.ownerDocument;
  const returnTo = doc.activeElement as HTMLElement | null;
  const titleId = nextId('dialog');
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    release();
    backdrop.remove();
    if (returnTo && typeof returnTo.focus === 'function' && doc.contains(returnTo)) returnTo.focus();
    opts.onClose?.();
  };
  const closeButton = h('button', { type: 'button', class: 'dms-dialog__close', 'aria-label': t('action.close') }, '×');
  closeButton.addEventListener('click', close);
  const box = h('div', { class: 'dms-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, tabindex: -1 },
    h('div', { class: 'dms-dialog__head' }, h('h2', { id: titleId, class: 'dms-dialog__title' }, opts.title), opts.dismissible === false ? null : closeButton),
    h('div', { class: 'dms-dialog__body' }, ...opts.body),
    opts.actions?.length ? h('div', { class: 'dms-dialog__actions' }, ...opts.actions) : null);
  const backdrop = h('div', { class: 'dms-dialog-backdrop' }, box);
  backdrop.addEventListener('mousedown', (ev) => { if (ev.target === backdrop && opts.dismissible !== false) close(); });
  box.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && opts.dismissible !== false) { ev.preventDefault(); close(); }
  });
  const release = trapFocus(box);
  parent.append(backdrop);
  const first = opts.initialFocus ?? focusables(box).find((e) => e !== closeButton) ?? closeButton;
  (first ?? box).focus();
  return { el: box, close };
}

/** A two-button confirmation; resolves true when the confirm button was pressed. */
export function confirmDialog(opts: { title: string; body: Child[]; confirm: HTMLButtonElement; keep: HTMLButtonElement }): Promise<boolean> {
  return new Promise((resolve) => {
    let result = false;
    const handle = openDialog({ title: opts.title, body: opts.body, actions: [opts.keep, opts.confirm], initialFocus: opts.keep,
      onClose: () => resolve(result) });
    opts.confirm.addEventListener('click', () => { result = true; handle.close(); });
    opts.keep.addEventListener('click', () => handle.close());
  });
}
