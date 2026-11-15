// The guardian constellation (SPEC.md §8): guardians as points on a soft circle, each joined to the letter in the
// middle by a line. A missing guardian fades (and its title says so); a mandatory one has a double ring.
import { t } from '../../core/i18n';
import { s } from '../dom';

export interface StarGuardian {
  label: string;
  present: boolean;
  mandatory?: boolean;
}

/** Positions on the circle, the first at the top, clockwise. */
export function starPositions(count: number, radius = 74, cx = 100, cy = 100): [number, number][] {
  return Array.from({ length: count }, (_, i) => {
    const a = -Math.PI / 2 + (i / Math.max(1, count)) * 2 * Math.PI;
    return [cx + radius * Math.cos(a), cy + radius * Math.sin(a)];
  });
}

export function constellation(guardians: readonly StarGuardian[], size = 220): SVGElement {
  const pos = starPositions(guardians.length);
  const missing = guardians.filter((g) => !g.present).length;
  const lines = guardians.map((g, i) => s('line', { class: `dms-constellation__line${g.present ? '' : ' is-missing'}`,
    x1: 100, y1: 100, x2: pos[i]![0].toFixed(2), y2: pos[i]![1].toFixed(2) }));
  const stars = guardians.map((g, i) => {
    const [x, y] = pos[i]!;
    const title = !g.present ? t('constellation.missing', { label: g.label }) : g.mandatory ? t('constellation.mandatory', { label: g.label }) : g.label;
    return s('g', { class: `dms-constellation__star${g.present ? '' : ' is-missing'}${g.mandatory ? ' is-mandatory' : ''}`, 'data-index': i },
      s('title', {}, title),
      g.mandatory ? s('circle', { class: 'dms-constellation__halo', cx: x.toFixed(2), cy: y.toFixed(2), r: 11, fill: 'none' }) : null,
      s('circle', { class: 'dms-constellation__point', cx: x.toFixed(2), cy: y.toFixed(2), r: 7 }));
  });
  // the letter in the middle: a small envelope
  const letter = s('g', { class: 'dms-constellation__letter' },
    s('rect', { x: 84, y: 88, width: 32, height: 24, rx: 3 }),
    s('path', { d: 'M84 90 L100 102 L116 90', fill: 'none' }));
  return s('svg', { class: 'dms-constellation', viewBox: '0 0 200 200', width: size, height: size, role: 'img',
    'aria-label': t('constellation.label', { count: guardians.length, missing }) },
  s('circle', { class: 'dms-constellation__orbit', cx: 100, cy: 100, r: 74, fill: 'none' }), ...lines, letter, ...stars);
}
