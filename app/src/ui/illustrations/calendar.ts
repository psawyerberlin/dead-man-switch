// A wall calendar with one day circled.
import { s } from '../dom';
import { drawing } from './draw';

export const calendar = (): SVGElement => drawing('calendar', [
  'M36 24h88a4 4 0 0 1 4 4v70a4 4 0 0 1-4 4H36a4 4 0 0 1-4-4V28a4 4 0 0 1 4-4z',
  'M32 42h96',
  'M56 16v16M104 16v16',
  'M46 56h8M66 56h8M86 56h8M106 56h8',
  'M46 72h8M66 72h8M106 72h8',
  'M46 88h8M66 88h8M86 88h8',
], [s('path', { d: 'M90 64c9-2 15 4 13 10s-12 8-16 3-3-12 5-13' })]);
