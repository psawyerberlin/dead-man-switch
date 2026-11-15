// Three keys on one ring, one for each piece a guardian holds.
import { s } from '../dom';
import { drawing } from './draw';

export const keys = (): SVGElement => drawing('keys', [
  'M66 54l-20 34m6-10l6 4m-2-11l6 4',
  'M80 56v40m0-12h7m-7-8h5',
  'M94 54l20 34m-6-10l-6 4m2-11l-6 4',
], [
  s('circle', { cx: 80, cy: 36, r: 14 }),
  s('circle', { cx: 62, cy: 50, r: 7 }),
  s('circle', { cx: 80, cy: 52, r: 7 }),
  s('circle', { cx: 98, cy: 50, r: 7 }),
]);
