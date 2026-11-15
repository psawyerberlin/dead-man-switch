// Three figures side by side, drawn as simple shapes (no faces, SPEC.md §8).
import { s } from '../dom';
import { drawing } from './draw';

export const people = (): SVGElement => drawing('people', [
  'M30 100c0-16 8-26 20-26s20 10 20 26',
  'M60 100c0-20 9-32 20-32s20 12 20 32',
  'M90 100c0-16 8-26 20-26s20 10 20 26',
  'M22 100h116',
], [s('circle', { cx: 50, cy: 60, r: 9 }), s('circle', { cx: 80, cy: 50, r: 11 }), s('circle', { cx: 110, cy: 60, r: 9 })]);
