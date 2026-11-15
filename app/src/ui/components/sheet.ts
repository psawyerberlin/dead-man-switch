// A sheet of paper on the warm background (SPEC.md §8): cards and screen bodies. Radius 14 px, two-layer shadow.
import { h, nextId, type Child } from '../dom';

export interface SheetOptions {
  title?: string;
  /** heading level of the title (default 2) */
  level?: 1 | 2 | 3;
  class?: string;
  /** `section` (default) or `article` (a switch card, a letter) */
  tag?: 'section' | 'article' | 'div';
}

export function sheet(opts: SheetOptions, ...children: Child[]): HTMLElement {
  const id = opts.title ? nextId('sheet') : undefined;
  const heading = opts.title ? h(`h${opts.level ?? 2}` as 'h2', { id, class: 'dms-sheet__title' }, opts.title) : null;
  return h(opts.tag ?? 'section', { class: ['dms-sheet', opts.class].filter(Boolean).join(' '), 'aria-labelledby': id }, heading, ...children);
}
