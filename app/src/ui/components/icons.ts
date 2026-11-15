// Original 24 px line icons for the Write stepper (SPEC.md §8: pen, people, calendar, shield, coin, seal, hand).
// Stroke `currentColor`, no fill, decorative (the step name is the label).
import { s } from '../dom';

export type IconName = 'pen' | 'people' | 'calendar' | 'shield' | 'coin' | 'seal' | 'hand' | 'check' | 'sun' | 'moon';

const PATHS: Record<IconName, string[]> = {
  pen: ['M4 20l1.2-4.6L15.8 4.8a2 2 0 0 1 2.8 0l.6.6a2 2 0 0 1 0 2.8L8.6 18.8z', 'M13.8 6.8l3.4 3.4', 'M4 20h6'],
  people: ['M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5', 'M16 10.5a2.5 2.5 0 1 0-.8-4.9', 'M17 14c2 .4 3.3 2 3.7 4.5'],
  calendar: ['M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z', 'M4 10h16', 'M8 3.5V7', 'M16 3.5V7', 'M12 13.5v3.5h2.5'],
  shield: ['M12 3.5l7 2.6v5.2c0 4.4-2.9 7.7-7 9.2-4.1-1.5-7-4.8-7-9.2V6.1z', 'M9 12l2.2 2.2L15.5 10'],
  coin: ['M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17z', 'M12 7v10', 'M14.6 9.2c-.4-.9-1.4-1.4-2.6-1.4-1.5 0-2.6.8-2.6 2s1.1 1.7 2.6 2 2.6.8 2.6 2-1.1 2-2.6 2c-1.2 0-2.3-.6-2.7-1.5'],
  seal: ['M12 3.6c1.3 0 1.9 1 3 1.4s2.3 0 3.1.9.4 2 .9 3.1 1.4 1.7 1.4 3-1 1.9-1.4 3 0 2.3-.9 3.1-2 .4-3.1.9-1.7 1.4-3 1.4-1.9-1-3-1.4-2.3 0-3.1-.9-.4-2-.9-3.1S3.6 13.3 3.6 12s1-1.9 1.4-3 0-2.3.9-3.1 2-.4 3.1-.9S10.7 3.6 12 3.6z', 'M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9z'],
  hand: ['M4 14.5h3l3.2 1.2h3.4a1.4 1.4 0 0 1 0 2.8H10', 'M13.6 18.5l4.9-2.4a1.5 1.5 0 0 1 1.6 2.4l-4.3 3.1a3 3 0 0 1-2 .5L7 21.5H4', 'M11 4h7v7h-7z', 'M11 4l3.5 3.5L18 4'],
  check: ['M5 12.5l4.2 4.2L19 7'],
  sun: ['M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M12 2.5v2', 'M12 19.5v2', 'M2.5 12h2', 'M19.5 12h2', 'M5.3 5.3l1.4 1.4', 'M17.3 17.3l1.4 1.4', 'M5.3 18.7l1.4-1.4', 'M17.3 6.7l1.4-1.4'],
  moon: ['M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z'],
};

export function icon(name: IconName, size = 24): SVGElement {
  return s('svg', { class: `dms-icon dms-icon--${name}`, viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor',
    'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' },
  ...PATHS[name].map((d) => s('path', { d })));
}
