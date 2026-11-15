// Buttons (SPEC.md §8): primary in `--seal` (one per screen), secondary, quiet; pill shaped, at least 44 px high.
import { h, type Child } from '../dom';

export type ButtonKind = 'primary' | 'secondary' | 'quiet' | 'danger';

export interface ButtonOptions {
  kind?: ButtonKind;
  onClick?: (ev: MouseEvent) => void;
  type?: 'button' | 'submit' | 'reset';
  disabled?: boolean;
  icon?: Child;
  /** accessible name when the label alone is not enough */
  label?: string;
  class?: string;
}

const cls = (kind: ButtonKind, extra?: string): string => ['dms-button', `dms-button--${kind}`, extra].filter(Boolean).join(' ');

export function button(text: string, opts: ButtonOptions = {}): HTMLButtonElement {
  const b = h('button', { type: opts.type ?? 'button', class: cls(opts.kind ?? 'secondary', opts.class), 'aria-label': opts.label },
    opts.icon ?? null, h('span', { class: 'dms-button__text' }, text));
  if (opts.disabled) b.disabled = true;
  if (opts.onClick) b.addEventListener('click', opts.onClick as EventListener);
  return b;
}

/** A link styled as a button (navigation, downloads). */
export function linkButton(text: string, href: string, opts: Omit<ButtonOptions, 'type' | 'disabled' | 'onClick'> & { download?: string; external?: boolean } = {}): HTMLAnchorElement {
  return h('a', { href, class: cls(opts.kind ?? 'secondary', opts.class), 'aria-label': opts.label, download: opts.download,
    rel: opts.external ? 'noopener noreferrer' : undefined, target: opts.external ? '_blank' : undefined },
  opts.icon ?? null, h('span', { class: 'dms-button__text' }, text));
}
