// The check-in rhythm (SPEC.md §3.1.4): every n months (presets of the configuration) or every n days (custom,
// at least one day). Terms over 5 years in one step are not offered (CRT §10).
export type Rhythm = { kind: 'months'; months: number } | { kind: 'days'; days: number };

export const MAX_RHYTHM_MONTHS = 60;
export const MAX_RHYTHM_DAYS = 1826;
export const GRACE_SECONDS = 86_400;

export class RhythmError extends Error {
  constructor(message: string) { super(message); this.name = 'RhythmError'; }
}

export function validateRhythm(r: Rhythm): Rhythm {
  if (r.kind === 'months') {
    if (!Number.isInteger(r.months) || r.months < 1 || r.months > MAX_RHYTHM_MONTHS) throw new RhythmError('months must be 1 to 60');
  } else if (r.kind === 'days') {
    if (!Number.isInteger(r.days) || r.days < 1 || r.days > MAX_RHYTHM_DAYS) throw new RhythmError('days must be 1 to 1826');
  } else {
    throw new RhythmError('unknown rhythm');
  }
  return r;
}

/** ISO 8601 duration (`P3M`, `P10D`), as in the messenger record and the phone check-in link. */
export const rhythmIso = (r: Rhythm): string => (r.kind === 'months' ? `P${r.months}M` : `P${r.days}D`);

/** Parses `P3M`, `P10D`, `P1Y` (= 12 months), `P2W` (= 14 days). */
export function parseRhythmIso(iso: string): Rhythm {
  const m = /^P(\d+)([YMWD])$/.exec(iso.trim());
  if (!m) throw new RhythmError('not a rhythm');
  const n = Number(m[1]);
  const r: Rhythm = m[2] === 'Y' ? { kind: 'months', months: 12 * n } : m[2] === 'M' ? { kind: 'months', months: n }
    : { kind: 'days', days: m[2] === 'W' ? 7 * n : n };
  return validateRhythm(r);
}

/** The deadline one rhythm after `now` (unix seconds). Months are calendar months (UTC), clamped to the month's end. */
export function addRhythm(now: number, r: Rhythm): number {
  validateRhythm(r);
  if (r.kind === 'days') return now + r.days * 86_400;
  const d = new Date(now * 1000);
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + r.months, 1, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return Math.floor(target.getTime() / 1000);
}

/** Term in seconds of one rhythm starting at `now`. */
export const rhythmSeconds = (now: number, r: Rhythm): number => addRhythm(now, r) - now;

/** Approximate months of a term, for the price lines (`price.line.tips`). */
export const termMonths = (seconds: number): number => Math.max(1, Math.round(seconds / (30.44 * 86_400)));
