import { test, expect } from 'vitest';
import { icsForDeadline } from '../src/core/calendar';

const T = '0x' + 'ab'.repeat(32);
const deadline = 1_800_000_000;

test('ics_has_two_alarms', () => {
  const ics = icsForDeadline({ T, deadline, language: 'de', drill: false, now: 1_763_000_000 });
  expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
  expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
  expect(ics.match(/BEGIN:VALARM/g)).toHaveLength(2);
  expect(ics.match(/END:VALARM/g)).toHaveLength(2);
  expect(ics).toContain('TRIGGER;RELATED=START:-P14D');
  expect(ics).toContain('TRIGGER;RELATED=START:-P2D');
  expect(ics).toContain('DTSTART:20270115T080000Z');
  const unfolded = ics.replace(/\r\n /g, '');
  expect(unfolded).toContain("SUMMARY:Melden: Dead man's switch");
  expect(unfolded).toContain('Zwei Wochen vor der Frist');
  expect(unfolded).toMatch(/DESCRIPTION:Melden Sie sich auf https:\/\/dead-man-switch\.chainsolution\.net\/app\/#\/checkin\?T=0xab[0-9a-f]+ vor dem .+\\, sonst/);
  expect(ics.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);

  const drill = icsForDeadline({ T, deadline, language: 'fr', drill: true, termSeconds: 3 * 3600, now: 1_763_000_000 }).replace(/\r\n /g, '');
  expect(drill.match(/BEGIN:VALARM/g)).toHaveLength(2);
  expect(drill).toContain('TRIGGER;RELATED=START:-PT1H30M');
  expect(drill).toContain('TRIGGER;RELATED=START:PT0S');
  expect(drill).toContain('SUMMARY:[Exercice] Signaler ma présence : dead man\'s switch');
  const en = icsForDeadline({ T, deadline, language: 'en', drill: false, termSeconds: 90 * 86_400 });
  expect(en).toContain('-P14D');
});
