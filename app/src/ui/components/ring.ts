// The countdown ring (SPEC.md §8): the stamp on the switch card. An SVG circle in `--gold` that empties as the
// deadline nears, with the remaining time written inside (never colour alone). `update` refills it after a check-in
// (CSS transition, none under prefers-reduced-motion).
import { t } from '../../core/i18n';
import { s } from '../dom';

export type RingState = 'ok' | 'warn' | 'grace' | 'done';

export interface RingOptions {
  /** remaining fraction of the term, 0..1 */
  fraction: number;
  /** big text inside, e.g. "12 days" */
  value: string;
  /** small text below it, e.g. "until the deadline" */
  caption: string;
  state?: RingState;
  size?: number;
}

export interface Ring {
  el: SVGElement;
  update(next: Partial<RingOptions>): void;
}

const R = 52;
const C = 2 * Math.PI * R;

/** State by the remaining fraction: warn in the last 10 % (SPEC.md §8). */
export const ringState = (fraction: number): RingState => (fraction <= 0 ? 'grace' : fraction <= 0.1 ? 'warn' : 'ok');

export function ring(opts: RingOptions): Ring {
  let cur: RingOptions = { ...opts };
  const track = s('circle', { class: 'dms-ring__track', cx: 60, cy: 60, r: R, fill: 'none', 'stroke-width': 8 });
  const arc = s('circle', { class: 'dms-ring__arc', cx: 60, cy: 60, r: R, fill: 'none', 'stroke-width': 8, 'stroke-linecap': 'round',
    'stroke-dasharray': C.toFixed(2), transform: 'rotate(-90 60 60)' });
  const value = s('text', { class: 'dms-ring__value', x: 60, y: 58, 'text-anchor': 'middle' });
  const caption = s('text', { class: 'dms-ring__caption', x: 60, y: 78, 'text-anchor': 'middle' });
  const el = s('svg', { class: 'dms-ring', viewBox: '0 0 120 120', width: opts.size ?? 160, height: opts.size ?? 160, role: 'img' }, track, arc, value, caption);
  const render = (): void => {
    const f = Math.min(1, Math.max(0, cur.fraction));
    arc.setAttribute('stroke-dashoffset', (C * (1 - f)).toFixed(2));
    value.textContent = cur.value;
    caption.textContent = cur.caption;
    el.setAttribute('data-state', cur.state ?? ringState(f));
    el.setAttribute('aria-label', t('ring.label', { value: cur.value, caption: cur.caption }));
  };
  render();
  return { el, update(next) { cur = { ...cur, ...next }; render(); } };
}
