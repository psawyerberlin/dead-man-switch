// The wax seal (SPEC.md §8): an original SVG seal, an irregular wax disc with an embossed ring and a monogram.
// `press()` plays the 600 ms scale-and-blur press; under prefers-reduced-motion it adds no animation class at all
// and the seal simply appears pressed.
import { t } from '../../core/i18n';
import { prefersReducedMotion } from '../a11y';
import { s } from '../dom';

export const PRESS_CLASS = 'dms-seal--pressing';
export const PRESS_MS = 600;

/** Up to two initials, upper case (`"Anna Maria Weber"` → `"AW"`, `"élise"` → `"É"`); a wax dot when empty. */
export function monogram(name: string): string {
  const words = name.trim().split(/\s+/).filter((w) => /\p{L}/u.test(w));
  if (words.length === 0) return '·';
  const first = [...words[0]!].find((c) => /\p{L}/u.test(c)) ?? '';
  const last = words.length > 1 ? [...words[words.length - 1]!].find((c) => /\p{L}/u.test(c)) ?? '' : '';
  return (first + last).toLocaleUpperCase();
}

/** The outline of the wax: a closed smooth path around (60, 60) whose radius wanders like poured wax. */
export function waxPath(seed = 0): string {
  const n = 40;
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI;
    const r = 50 + 2.6 * Math.sin(5 * a + 1 + seed) + 1.6 * Math.sin(11 * a + seed * 2) + 1.1 * Math.sin(17 * a + 2);
    pts.push([60 + r * Math.cos(a), 60 + r * Math.sin(a)]);
  }
  const mid = (p: [number, number], q: [number, number]): string => `${((p[0] + q[0]) / 2).toFixed(2)} ${((p[1] + q[1]) / 2).toFixed(2)}`;
  let d = `M${mid(pts[n - 1]!, pts[0]!)}`;
  for (let i = 0; i < n; i++) d += ` Q${pts[i]![0].toFixed(2)} ${pts[i]![1].toFixed(2)} ${mid(pts[i]!, pts[(i + 1) % n]!)}`;
  return `${d} Z`;
}

export interface SealOptions {
  /** the sender's name; the monogram is taken from it */
  name: string;
  size?: number;
  /** varies the wax outline, e.g. by recipient index */
  seed?: number;
}

export function seal(opts: SealOptions): SVGElement {
  const mono = monogram(opts.name);
  const rays = Array.from({ length: 24 }, (_, i) => {
    const a = (i / 24) * 2 * Math.PI;
    return `M${(60 + 36 * Math.cos(a)).toFixed(2)} ${(60 + 36 * Math.sin(a)).toFixed(2)} L${(60 + 39 * Math.cos(a)).toFixed(2)} ${(60 + 39 * Math.sin(a)).toFixed(2)}`;
  }).join(' ');
  return s('svg', { class: 'dms-seal', viewBox: '0 0 120 120', width: opts.size ?? 120, height: opts.size ?? 120, role: 'img',
    'aria-label': t('seal.monogram_label', { monogram: mono }) },
  s('path', { class: 'dms-seal__wax', d: waxPath(opts.seed ?? 0) }),
  s('circle', { class: 'dms-seal__rim', cx: 60, cy: 60, r: 42, fill: 'none', 'stroke-width': 1.5 }),
  s('path', { class: 'dms-seal__rays', d: rays, fill: 'none', 'stroke-width': 1.2, 'stroke-linecap': 'round' }),
  s('circle', { class: 'dms-seal__rim', cx: 60, cy: 60, r: 33, fill: 'none', 'stroke-width': 1 }),
  s('path', { class: 'dms-seal__shine', d: 'M30 44 Q38 28 56 24', fill: 'none', 'stroke-width': 3, 'stroke-linecap': 'round' }),
  s('text', { class: 'dms-seal__monogram', x: 60, y: 60, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': mono.length > 1 ? 26 : 32 }, mono));
}

/**
 * Presses the seal: adds PRESS_CLASS for PRESS_MS (then removes it). Returns false, and adds nothing, under
 * prefers-reduced-motion.
 */
export function press(el: Element, win: Parameters<typeof prefersReducedMotion>[0] = globalThis as never): boolean {
  if (prefersReducedMotion(win)) return false;
  el.classList.remove(PRESS_CLASS);
  void (el as SVGElement).getBoundingClientRect?.(); // restart the animation
  el.classList.add(PRESS_CLASS);
  setTimeout(() => el.classList.remove(PRESS_CLASS), PRESS_MS + 50);
  return true;
}
