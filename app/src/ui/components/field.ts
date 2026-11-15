// A form field (SPEC.md §8): visible label, optional hint, error message wired to aria-describedby / aria-invalid.
import { h, nextId } from '../dom';

export type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

export interface FieldOptions {
  label: string;
  hint?: string;
  error?: string | null;
  control: Control;
  class?: string;
}

export interface Field {
  el: HTMLElement;
  control: Control;
  setError(message: string | null): void;
}

export function field(opts: FieldOptions): Field {
  const id = opts.control.id || nextId('field');
  opts.control.id = id;
  opts.control.classList.add('dms-field__control');
  const hint = opts.hint ? h('p', { id: `${id}-hint`, class: 'dms-field__hint' }, opts.hint) : null;
  const error = h('p', { id: `${id}-error`, class: 'dms-field__error', role: 'alert', hidden: true });
  const el = h('div', { class: ['dms-field', opts.class].filter(Boolean).join(' ') },
    h('label', { for: id, class: 'dms-field__label' }, opts.label), hint, opts.control, error);
  const setError = (message: string | null): void => {
    error.textContent = message ?? '';
    error.hidden = !message;
    el.classList.toggle('dms-field--invalid', !!message);
    if (message) opts.control.setAttribute('aria-invalid', 'true');
    else opts.control.removeAttribute('aria-invalid');
    opts.control.setAttribute('aria-describedby', [hint ? `${id}-hint` : '', message ? `${id}-error` : ''].filter(Boolean).join(' '));
    if (!hint && !message) opts.control.removeAttribute('aria-describedby');
  };
  setError(opts.error ?? null);
  return { el, control: opts.control, setError };
}

/** `<input>` with the field class; `attrs` are plain attributes (`type`, `name`, `inputmode`, …). */
export function input(attrs: Record<string, string | number | boolean | undefined> = {}): HTMLInputElement {
  return h('input', { type: 'text', ...attrs });
}

export function select(options: { value: string; label: string }[], value?: string): HTMLSelectElement {
  const el = h('select', {}, ...options.map((o) => h('option', { value: o.value }, o.label)));
  if (value !== undefined) el.value = value;
  return el;
}
