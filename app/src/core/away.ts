// "Away until…" (SPEC.md §3.2): a check-in with a chosen date instead of the rhythm. The date picker offers
// tomorrow at the earliest and five years ahead at the latest; the new deadline is the chosen day at 12:00 local time.

export const AWAY_MAX_YEARS = 5;
export const AWAY_HOUR = 12;

export class AwayError extends Error {
  constructor(message: string, readonly code: 'format' | 'early' | 'late' = 'format') { super(message); this.name = 'AwayError'; }
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** `YYYY-MM-DD` of a local date. */
export const localDateString = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** The `min` and `max` of the date picker, as `YYYY-MM-DD` in local time: tomorrow and today + 5 years. */
export function awayBounds(now: number): { min: string; max: string } {
  const d = new Date(now * 1000);
  const min = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  const max = new Date(d.getFullYear() + AWAY_MAX_YEARS, d.getMonth(), d.getDate());
  return { min: localDateString(min), max: localDateString(max) };
}

/** Parses `YYYY-MM-DD` (a real calendar date) into its parts. */
export function parseLocalDate(value: string): { y: number; m: number; d: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) throw new AwayError('not a date');
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const probe = new Date(y, mo - 1, d);
  if (probe.getFullYear() !== y || probe.getMonth() !== mo - 1 || probe.getDate() !== d) throw new AwayError('not a date');
  return { y, m: mo, d };
}

/**
 * The deadline of "away until `value`": that day at 12:00 local time, in unix seconds. Throws `AwayError` when the
 * date is before tomorrow or more than five years ahead of `now`.
 */
export function awayDeadline(value: string, now: number): number {
  const { y, m, d } = parseLocalDate(value);
  const b = awayBounds(now);
  const day = `${y}-${pad(m)}-${pad(d)}`;
  if (day < b.min) throw new AwayError('the earliest date is tomorrow', 'early');
  if (day > b.max) throw new AwayError('the latest date is five years from today', 'late');
  return Math.floor(new Date(y, m - 1, d, AWAY_HOUR, 0, 0, 0).getTime() / 1000);
}
