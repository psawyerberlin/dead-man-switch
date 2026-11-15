// The watcher (SPEC.md §5.3): every 5 minutes per network, for each active record, read the switch and decide.
// Every send goes through the outbox: recorded before the mailer is called, marked done after; a send that was
// attempted but not marked done (crash, SMTP error) is retried once, never more. The outbox key (network, T, kind,
// address, step) carries the deadline in the step, so a check-in (a later deadline) reschedules the reminders.
import { decryptLink } from './crypto.ts';
import type { NetworkStatus } from './api.ts';
import type { Chain, Clock, Mailer, MailMessage, SwitchState } from './interfaces.ts';
import { logger as defaultLogger, type Logger } from './log.ts';
import {
  canMail, confirmUrl, newToken, renderAlarm, renderCancelled, renderConfirmation, renderRelease, renderReminder, renderReport,
  stopUrl, switchLabel,
} from './mail.ts';
import type { MessengerRecord } from './record.ts';
import type { AddressRow, Store } from './store.ts';

export const TICK_S = 300;
export const HOUR = 3600;
export const DAY = 24 * HOUR;
/** CRT protocol constant: the letters open 24 h after the deadline. */
export const GRACE_S = 24 * HOUR;
/** Terms up to this length (drills) get reminders at 50 % and at the deadline. */
export const SHORT_TERM_S = 2 * DAY;
export const REMINDER_DAYS = [14, 3, 1] as const;
export const ALARM_HOURS = [0, 12, 20, 23] as const;
export const DRILL_ALARM_HOURS = [0, 12, 20] as const;
export const RETENTION_S = 30 * DAY;
export const DRILL_RETENTION_S = 7 * DAY;

export interface WatcherDeps {
  store: Store;
  chain: Chain;
  clock: Clock;
  mailer: Mailer;
  config: { networks: readonly string[]; appUrl: string };
  log?: Logger;
}

export interface TickReport { checked: number; sent: number; failed: number; deleted: number }

export interface Watcher {
  tick(network: string): Promise<TickReport>;
  /** Chain status per network, for `/health`. */
  status(): Record<string, NetworkStatus>;
}

type Outcome = 'sent' | 'done' | 'failed' | 'gave_up';

/** Seconds of an ISO 8601 duration (years 365 d, months 30 d); 0 when it cannot be read. */
export function durationSeconds(d: string): number {
  const m = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(d);
  if (!m) return 0;
  const n = (i: number) => Number(m[i] ?? 0);
  return n(1) * 365 * DAY + n(2) * 30 * DAY + n(3) * 7 * DAY + n(4) * DAY + n(5) * HOUR + n(6) * 60 + n(7);
}

/** Pieces needed to recover K: `t` of a threshold tree, the sum over the groups of an xor tree; 0 when unknown. */
export function piecesNeeded(descriptor: unknown): number {
  const tree = (descriptor as { access_tree?: { kind?: string; t?: number; branches?: { t?: number }[] } } | null)?.access_tree;
  if (!tree) return 0;
  if (tree.kind === 'threshold' && typeof tree.t === 'number') return tree.t;
  if (tree.kind === 'xor' && Array.isArray(tree.branches)) return tree.branches.reduce((s, b) => s + (typeof b.t === 'number' ? b.t : 0), 0);
  return 0;
}

const who = (a: AddressRow): string => (a.role === 'owner' ? 'owner' : `recipient ${a.idx}`);
const isHttps = (s: string): boolean => /^https:\/\/[^\s]+$/.test(s) && s.length <= 2048;

export function createWatcher(deps: WatcherDeps): Watcher {
  const { store, chain, clock, mailer, config } = deps;
  const log = deps.log ?? defaultLogger;
  const status: Record<string, NetworkStatus> = {};
  /** Consecutive "absent" reads per switch: a switch that vanished is treated as cancelled on the second read. */
  const absent = new Map<string, number>();
  /** Switches whose recovery failed, so the event is written once and not every tick. */
  const recoverFailed = new Set<string>();
  let report: TickReport = { checked: 0, sent: 0, failed: 0, deleted: 0 };

  /** One email through the outbox. */
  async function deliver(network: string, T: string, kind: string, a: AddressRow, step: string, render: () => Omit<MailMessage, 'to'>): Promise<Outcome> {
    const row = store.findOutbox(network, T, kind, a.id, step) ?? store.enqueue(network, T, kind, a.id, step, clock.now())
      ?? store.findOutbox(network, T, kind, a.id, step);
    if (!row) return 'gave_up';
    if (row.status === 'done') return 'done';
    if (row.attempts >= 2) return 'gave_up';
    store.markAttempt(row.id);
    try {
      await mailer.send({ to: a.email, ...render() });
    } catch (e) {
      report.failed++;
      store.addEvent(network, T, clock.now(), 'mail_failed', `${who(a)}: ${kind}`);
      log.warn('mail failed', { network, switch: switchLabel(T), kind, to: who(a), error: e });
      return row.attempts + 1 >= 2 ? 'gave_up' : 'failed';
    }
    const now = clock.now();
    store.markDone(row.id, now);
    store.touchLastMail(network, T, now);
    store.addEvent(network, T, now, `${kind}_sent`, `${who(a)}: ${step.split('@')[0]}`);
    report.sent++;
    log.info('mail sent', { network, switch: switchLabel(T), kind, to: who(a), step });
    return 'sent';
  }

  /** Confirmation emails of the API whose send did not complete (older than one tick, so not in flight): one retry. */
  async function retryConfirmations(network: string): Promise<void> {
    for (const row of store.pendingOutbox(network)) {
      if (row.kind !== 'owner_confirm' && row.kind !== 'told_now') continue;
      if (clock.now() - row.createdAt < TICK_S || row.attempts >= 2) continue;
      const a = store.getAddress(row.addressId);
      const sw = store.getSwitch(network, row.T);
      if (!a || !sw || store.addressHmac(a.email).slice(0, 16) !== row.step || !canMail(store, a) || a.confirmation === 'confirmed') {
        store.markDone(row.id, clock.now()); continue; // nothing left to ask
      }
      const rec = sw.record as MessengerRecord;
      const confirm = newToken(), stop = store.stopToken(a);
      store.setTokens(a.id, confirm, stop, clock.now());
      store.markAttempt(row.id);
      try {
        await mailer.send({ to: a.email, ...renderConfirmation(row.kind, { lang: a.language, sender: rec.sender_label, T: row.T, drill: rec.drill,
          confirmUrl: confirmUrl(config.appUrl, confirm), stopUrl: stopUrl(config.appUrl, stop) }) });
        store.markDone(row.id, clock.now());
        store.touchLastMail(network, row.T, clock.now());
        store.addEvent(network, row.T, clock.now(), row.kind === 'owner_confirm' ? 'owner_asked' : 'recipient_asked', who(a));
        report.sent++;
      } catch (e) {
        report.failed++;
        store.addEvent(network, row.T, clock.now(), 'mail_failed', `${who(a)}: ${row.kind}`);
        log.warn('mail failed', { network, switch: switchLabel(row.T), kind: row.kind, to: who(a), error: e });
      }
    }
  }

  /** The owner may get reminders and alarms: confirmed, reminders on, not stopped, not on the never list. */
  const ownerReachable = (rec: MessengerRecord, owner: AddressRow | undefined): owner is AddressRow =>
    !!owner && owner.confirmation === 'confirmed' && rec.owner.reminders && canMail(store, owner);

  async function remindersAndAlarms(network: string, rec: MessengerRecord, s: SwitchState, owner: AddressRow | undefined, chainNow: number): Promise<void> {
    if (s.deadline === undefined || !ownerReachable(rec, owner)) return;
    const deadline = s.deadline;
    const term = durationSeconds(rec.rhythm);
    const short = rec.drill || (term > 0 && term <= SHORT_TERM_S);
    const base = { lang: owner.language, T: rec.T, network, drill: rec.drill, rhythm: rec.rhythm, appUrl: config.appUrl, stopUrl: stopUrl(config.appUrl, store.stopToken(owner)) };
    const days = Math.max(0, Math.ceil((deadline - chainNow) / DAY));

    if (chainNow < deadline) {
      let step: string | undefined;
      if (short) { if (term > 0 && chainNow >= deadline - term / 2) step = 'half'; }
      else for (const d of REMINDER_DAYS) if (chainNow >= deadline - d * DAY) step = `${d}d`; // the latest one due
      if (step) await deliver(network, rec.T, 'reminder', owner, `${step}@${deadline}`, () => renderReminder({ ...base, deadline, days, short }));
      return;
    }
    // In the grace: nothing once a guardian has released.
    if (chainNow >= deadline + GRACE_S || s.releases > 0) return;
    if (short) await deliver(network, rec.T, 'reminder', owner, `deadline@${deadline}`, () => renderReminder({ ...base, deadline, days: 0, short }));
    let off: number | undefined;
    for (const h of rec.drill ? DRILL_ALARM_HOURS : ALARM_HOURS) if (chainNow >= deadline + h * HOUR) off = h;
    if (off === undefined) return;
    const hours = Math.max(1, Math.ceil((deadline + GRACE_S - chainNow) / HOUR));
    await deliver(network, rec.T, 'alarm', owner, `${off}h@${deadline}`, () => renderAlarm({ ...base, hours }));
  }

  async function release(network: string, rec: MessengerRecord, s: SwitchState, addrs: AddressRow[], owner: AddressRow | undefined): Promise<void> {
    const T = rec.T;
    const needed = piecesNeeded(rec.descriptor) || s.t || 1;
    if (s.releases < needed) return;
    let K: Uint8Array;
    try {
      K = await chain.recoverK(network, rec.descriptor, rec.envelopes);
    } catch (e) {
      if (!recoverFailed.has(`${network}/${T}`)) {
        recoverFailed.add(`${network}/${T}`);
        store.addEvent(network, T, clock.now(), 'recover_failed');
      }
      log.warn('recovery failed', { network, switch: switchLabel(T), error: e });
      return;
    }
    recoverFailed.delete(`${network}/${T}`);
    const lines: { index: number; name: string; sent: boolean }[] = [];
    let settled = true;
    try {
      if (K.length !== 32) throw new Error('recovered key has a wrong length');
      for (const r of rec.recipients) {
        const a = addrs.find((x) => x.role === 'recipient' && x.idx === r.index);
        // Confirmed recipients get it; unconfirmed ones exactly this one email; on a drill only confirmed ones.
        const eligible = !!a && canMail(store, a) && (a.confirmation === 'confirmed' || !rec.drill);
        if (!a || !eligible) {
          lines.push({ index: r.index, name: r.name, sent: false });
          // Written once (the outbox row is only a marker, no email is sent).
          const marker = store.enqueue(network, T, 'release_skipped', a?.id ?? 0, `r${r.index}`, clock.now());
          if (marker) {
            store.markDone(marker.id, clock.now());
            store.addEvent(network, T, clock.now(), 'release_skipped', `recipient ${r.index}`);
          }
          continue;
        }
        let link: string | null = null;
        if (r.link) {
          try {
            const l = decryptLink(K, rec.I, r.index, r.link);
            if (isHttps(l)) link = l; else throw new Error('not an https link');
          } catch {
            store.addEvent(network, T, clock.now(), 'link_unreadable', `recipient ${r.index}`);
          }
        }
        const stop = stopUrl(config.appUrl, store.stopToken(a));
        const out = await deliver(network, T, 'release', a, 'release', () => renderRelease({ lang: a.language, sender: rec.sender_label, drill: rec.drill, link, appUrl: config.appUrl, stopUrl: stop }));
        if (out === 'failed') settled = false;
        lines.push({ index: r.index, name: r.name, sent: out === 'sent' || out === 'done' });
      }
    } finally {
      K.fill(0);
    }
    if (!settled) return; // a failed send is retried on the next tick; the report waits for it
    if (owner && owner.confirmation === 'confirmed' && canMail(store, owner)) {
      const stop = stopUrl(config.appUrl, store.stopToken(owner));
      const out = await deliver(network, T, 'report', owner, 'report', () => renderReport({ lang: owner.language, T, drill: rec.drill, stopUrl: stop, lines }));
      if (out === 'failed') return;
    }
    const now = clock.now();
    store.setSwitchState(network, T, 'delivered', now);
    store.addEvent(network, T, now, 'delivered', `${lines.filter((l) => l.sent).length}/${lines.length}`);
    log.info('switch delivered', { network, switch: switchLabel(T) });
  }

  async function cancelled(network: string, rec: MessengerRecord, owner: AddressRow | undefined): Promise<void> {
    if (owner && owner.confirmation === 'confirmed' && canMail(store, owner)) {
      const stop = stopUrl(config.appUrl, store.stopToken(owner));
      const out = await deliver(network, rec.T, 'cancelled', owner, 'cancelled', () => renderCancelled({ lang: owner.language, T: rec.T, drill: rec.drill, stopUrl: stop }));
      if (out === 'failed') return;
    }
    store.deleteSwitch(network, rec.T, { state: 'cancelled', now: clock.now() });
    report.deleted++;
    log.info('switch cancelled, data deleted', { network, switch: switchLabel(rec.T) });
  }

  async function check(network: string, T: string): Promise<void> {
    let s: SwitchState;
    try { s = await chain.switchState(network, T); } catch (e) {
      log.warn('chain read failed', { network, switch: switchLabel(T), error: e });
      return;
    }
    report.checked++;
    const sw = store.getSwitch(network, T);
    if (!sw) return;
    const rec = sw.record as MessengerRecord;
    const addrs = store.listAddresses(network, T);
    const owner = addrs.find((a) => a.role === 'owner');
    const chainNow = s.medianTime || clock.now();
    const key = `${network}/${T}`;
    if (s.state === 'absent') {
      const n = (absent.get(key) ?? 0) + 1;
      absent.set(key, n);
      if (n >= 2) { absent.delete(key); await cancelled(network, rec, owner); }
      return;
    }
    absent.delete(key);
    switch (s.state) {
      case 'cancelled': await cancelled(network, rec, owner); return;
      case 'released': await release(network, rec, s, addrs, owner); return;
      case 'armed': await remindersAndAlarms(network, rec, s, owner, chainNow); return;
      default: return; // pending, committed: nothing to do yet
    }
  }

  /** Delivered records: 30 days after the last email, drills 7 days after the release; then a tombstone remains. */
  function retention(network: string, sw: { T: string; drill: boolean; lastMailAt: number | null; endedAt: number | null }): boolean {
    const now = clock.now();
    const ref = sw.drill ? sw.endedAt : Math.max(sw.lastMailAt ?? 0, sw.endedAt ?? 0);
    if (ref === null || now - ref < (sw.drill ? DRILL_RETENTION_S : RETENTION_S)) return false;
    store.deleteSwitch(network, sw.T, { state: 'delivered', now });
    report.deleted++;
    log.info('delivered switch deleted after retention', { network, switch: switchLabel(sw.T) });
    return true;
  }

  async function refreshStatus(network: string): Promise<void> {
    if (!chain.tip) return;
    try {
      const tip = await chain.tip(network);
      status[network] = { tip: tip.number, lag_s: Math.max(0, clock.now() - tip.timestamp) };
    } catch (e) {
      log.warn('tip read failed', { network, error: e });
    }
  }

  async function tick(network: string): Promise<TickReport> {
    report = { checked: 0, sent: 0, failed: 0, deleted: 0 };
    if (!config.networks.includes(network)) throw new Error(`network ${network} is not configured`);
    await refreshStatus(network);
    await retryConfirmations(network);
    for (const sw of store.listSwitches(network)) {
      try {
        if (sw.state === 'delivered') { retention(network, sw); continue; }
        await check(network, sw.T);
      } catch (e) {
        log.error('watcher failed on a switch', { network, switch: switchLabel(sw.T), error: e });
      }
    }
    log.info('tick', { network, ...report });
    return report;
  }

  return { tick, status: () => ({ ...status }) };
}
