// A closed envelope, its flap held by a small round seal.
import { s } from '../dom';
import { drawing } from './draw';

export const envelope = (): SVGElement => drawing('envelope', [
  'M28 32h104v62H28z',
  'M28 32l52 36 52-36',
  'M28 94l38-30',
  'M132 94l-38-30',
], [s('circle', { cx: 80, cy: 68, r: 9 }), s('path', { d: 'M76 68h8M80 64v8' })]);
