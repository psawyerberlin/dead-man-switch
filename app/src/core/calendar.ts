// Calendar file for a deadline (`.ics`, RFC 5545) with two VALARMs: −14 days and −2 days; for terms of at most
// two days (fire drill) at −50 % of the term and at the deadline.
import type { Language } from './bundle';
import { formatDate, translate } from './i18n';

export const SHORT_TERM_SECONDS = 2 * 86_400;
const DEFAULT_APP_URL = 'https://dead-man-switch.chainsolution.net';

export interface IcsInput {
  T: string;
  /** unix seconds */
  deadline: number | bigint;
  language: Language;
  drill: boolean;
  /** length of the term in seconds; terms ≤ 2 days get the short-term alarms. Default: a long term */
  termSeconds?: number;
  /** app origin (config `app_url`) */
  appUrl?: string;
  /** DTSTAMP (unix seconds), default now; fixed in tests */
  now?: number;
}

const stamp = (s: number): string => new Date(s * 1000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** TEXT value escaping (RFC 5545 §3.3.11). */
const text = (s: string): string => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Folds a content line at 75 octets (RFC 5545 §3.1) without splitting a UTF-8 sequence. */
function fold(line: string): string {
  const enc = new TextEncoder();
  const parts: string[] = [];
  let cur = '', size = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (size + n > (parts.length ? 74 : 75)) { parts.push(cur); cur = ''; size = 0; }
    cur += ch; size += n;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

function duration(seconds: number): string {
  if (seconds === 0) return 'PT0S';
  const sign = seconds < 0 ? '-' : '';
  let s = Math.abs(Math.round(seconds));
  const d = Math.floor(s / 86_400); s -= d * 86_400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  const time = (h ? `${h}H` : '') + (m ? `${m}M` : '') + (s ? `${s}S` : '');
  return `${sign}P${d ? `${d}D` : ''}${time ? `T${time}` : ''}`;
}

export function icsForDeadline(input: IcsInput): string {
  const deadline = Number(input.deadline);
  const lang = input.language;
  const T = input.T.toLowerCase();
  const appUrl = (input.appUrl ?? DEFAULT_APP_URL).replace(/\/+$/, '');
  const url = `${appUrl}/app/#/checkin?T=${T}`;
  const short = input.termSeconds !== undefined && input.termSeconds <= SHORT_TERM_SECONDS;
  const alarms: Array<[number, string]> = short
    ? [[-Math.round((input.termSeconds ?? 0) / 2), translate(lang, 'ics.alarm_half')], [0, translate(lang, 'ics.alarm_deadline')]]
    : [[-14 * 86_400, translate(lang, 'ics.alarm_14')], [-2 * 86_400, translate(lang, 'ics.alarm_2')]];
  const summary = (input.drill ? `${translate(lang, 'drill.subject_prefix')} ` : '') + translate(lang, 'ics.summary');
  const description = translate(lang, 'ics.description', { url, deadline: formatDate(deadline, lang, { timeZone: 'UTC' }) + ' UTC' });
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//dead-man-switch//dms-core//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${T}-${deadline}@dead-man-switch`,
    `DTSTAMP:${stamp(input.now ?? Math.floor(Date.now() / 1000))}`,
    `DTSTART:${stamp(deadline)}`,
    `DTEND:${stamp(deadline + 1800)}`,
    `SUMMARY:${text(summary)}`,
    `DESCRIPTION:${text(description)}`,
    `URL:${url}`,
    'TRANSP:TRANSPARENT',
    ...alarms.flatMap(([offset, label]) => [
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `TRIGGER;RELATED=START:${duration(offset)}`,
      `DESCRIPTION:${text(label)}`,
      'END:VALARM',
    ]),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}
