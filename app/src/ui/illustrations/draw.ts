// Shared frame for the line drawings: 160 × 120, stroke currentColor (styled `--ink-soft`), decorative.
import { s } from '../dom';

export function drawing(name: string, paths: string[], extra: SVGElement[] = []): SVGElement {
  return s('svg', { class: `dms-illus dms-illus--${name}`, viewBox: '0 0 160 120', width: 160, height: 120, fill: 'none', stroke: 'currentColor',
    'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' },
  ...paths.map((d) => s('path', { d })), ...extra);
}
