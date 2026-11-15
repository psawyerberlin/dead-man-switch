import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { hexToBytes } from '../src/crypto.ts';
import type { Chain, MailMessage, SwitchState, SwitchStateName } from '../src/interfaces.ts';
import { logger, redact, setLogSink } from '../src/log.ts';
import {
  renderAlarm, renderCancelled, renderConfirmation, renderRelease, renderReminder, renderReport,
} from '../src/mail.ts';
import type { MessengerRecord } from '../src/record.ts';
import { Store, type Confirmation } from '../src/store.ts';
import { DAY, HOUR, createWatcher } from '../src/watcher.ts';
import { KEY_HEX, VECTORS, tmp } from './helpers.ts';

// The log output of the whole run is captured here and checked by the last test.
const LOG: string[] = [];
setLogSink((line) => { LOG.push(line); });
/** Every fixture email, name, link and token of the run, for `logs_redact_personal_data`. */
const SECRETS = new Set<string>();

const hex = (n: number) => '0x' + randomBytes(n).toString('hex');
const BASE = 1_800_000_000;
const APP = 'https://dms.example';

class Clock { t = BASE; now() { return this.t; } }

class FakeChain implements Chain {
  states = new Map<string, Omit<SwitchState, 'medianTime'>>();
  recovered: Uint8Array[] = [];
  constructor(private readonly clock: Clock) {}
  async switchState(network: string, T: string): Promise<SwitchState> {
    const s = this.states.get(`${network}/${T}`) ?? { state: 'absent' as const, releases: 0, t: 0 };
    return { ...s, medianTime: this.clock.t };
  }
  async recoverK(): Promise<Uint8Array> {
    const K = new Uint8Array(hexToBytes(VECTORS.K));
    this.recovered.push(K);
    return K;
  }
  set(T: string, state: SwitchStateName, deadline: number, releases = 0, t = 2): void {
    this.states.set(`testnet/${T}`, { state, deadline, releases, t });
  }
}

class FakeMailer {
  sent: MailMessage[] = [];
  failures = 0;
  calls = 0;
  async send(m: MailMessage) {
    this.calls++;
    if (this.failures > 0) { this.failures--; throw new Error(`SMTP 451 temporary failure for <${m.to}>`); }
    this.sent.push(m);
    for (const tok of (m.text.match(/\/api\/v1\/(?:stop|confirm)\/([A-Za-z0-9_-]{43})/g) ?? [])) SECRETS.add(tok.split('/').pop()!);
  }
  to(prefix: string) { return this.sent.filter((m) => m.to.startsWith(prefix)); }
}

interface RecipientSpec { index: number; name?: string; language?: 'en' | 'fr' | 'de'; confirmation?: Confirmation; link?: boolean }
interface SeedOpts { drill?: boolean; rhythm?: string; ownerLang?: 'en' | 'fr' | 'de'; ownerConfirmed?: boolean; reminders?: boolean; recipients?: RecipientSpec[] }

function setup() {
  const clock = new Clock();
  const store = new Store(join(tmp(), 'w.db'), hexToBytes(KEY_HEX));
  const chain = new FakeChain(clock);
  const mailer = new FakeMailer();
  const deps = { store, chain, clock, mailer, config: { networks: ['testnet'], appUrl: APP } };
  let watcher = createWatcher(deps);
  const tick = async (at?: number) => { if (at !== undefined) clock.t = at; return watcher.tick('testnet'); };
  const restart = () => { watcher = createWatcher(deps); };

  function seed(o: SeedOpts = {}) {
    const T = hex(32);
    const tag = T.slice(2, 8);
    const recipients = (o.recipients ?? [{ index: 1, confirmation: 'confirmed', link: true }]).map((r) => {
      const v = VECTORS.cases.find((c) => c.r === r.index);
      return { index: r.index, name: r.name ?? `Name${r.index}x${tag}`, language: r.language ?? 'en', email: `rcpt${r.index}-${tag}@example.net`,
        tell_now: false, link: r.link && v ? { nonce: v.link.nonce, ciphertext: v.link.ciphertext } : null };
    });
    const rec: MessengerRecord = {
      version: 1, network: 'testnet', T, I: VECTORS.I, drill: !!o.drill, sender_label: `Sender${tag}`, rhythm: o.rhythm ?? 'P3M',
      descriptor: { access_tree: { kind: 'threshold', t: 2, n: 3, leaves: [{ node: 0 }, { node: 1 }, { node: 2 }] } }, envelopes: [],
      owner: { email: `owner-${tag}@example.org`, language: o.ownerLang ?? 'en', reminders: o.reminders ?? true }, recipients,
    };
    SECRETS.add(rec.owner.email); SECRETS.add(rec.sender_label);
    for (const r of recipients) { SECRETS.add(r.email); SECRETS.add(r.name); }
    for (const c of VECTORS.cases) SECRETS.add(c.link.plaintext);
    store.putSwitch('testnet', T, rec, rec.drill, clock.t);
    const addrs = store.syncAddresses('testnet', T, [
      { role: 'owner', idx: 0, email: rec.owner.email, name: rec.sender_label, language: rec.owner.language },
      ...recipients.map((r) => ({ role: 'recipient' as const, idx: r.index, email: r.email, name: r.name, language: r.language })),
    ]);
    for (const a of addrs) {
      const c = a.role === 'owner' ? (o.ownerConfirmed === false ? 'none' : 'confirmed') : (o.recipients?.find((r) => r.index === a.idx)?.confirmation ?? 'confirmed');
      store.setConfirmation(a.id, c);
    }
    return { T, rec };
  }
  return { clock, store, chain, mailer, tick, restart, seed, close: () => store.close() };
}

test('watcher_sends_reminders_once', async () => {
  const s = setup();
  const D = BASE + 60 * DAY;
  const { T } = s.seed();
  s.chain.set(T, 'armed', D);
  await s.tick(D - 15 * DAY);
  assert.equal(s.mailer.sent.length, 0);
  await s.tick(D - 14 * DAY + 60);
  assert.equal(s.mailer.sent.length, 1);
  assert.match(s.mailer.sent[0]!.subject, /in 14 days/);
  await s.tick(D - 13 * DAY);
  s.restart(); // a restart does not resend
  await s.tick(D - 13 * DAY + 300);
  assert.equal(s.mailer.sent.length, 1);
  await s.tick(D - 3 * DAY);
  await s.tick(D - 2 * DAY);
  await s.tick(D - DAY + 10);
  await s.tick(D - HOUR);
  const subjects = s.mailer.sent.map((m) => m.subject);
  assert.deepEqual(subjects, ['Your dead-man-switch deadline is in 14 days', 'Your dead-man-switch deadline is in 3 days', 'Your dead-man-switch deadline is tomorrow']);
  for (const m of s.mailer.sent) {
    assert.ok(m.to.startsWith('owner-'));
    assert.ok(m.text.includes(`${APP}/app/#/checkin?network=testnet&T=${T}&rhythm=P3M`), 'phone check-in link');
    assert.match(m.headers['List-Unsubscribe']!, /\/api\/v1\/stop\//);
  }
  assert.equal(s.store.listEvents('testnet', T).filter((e) => e.kind === 'reminder_sent').length, 3);

  // A failed send is retried once, never more; an unconfirmed owner gets nothing.
  const b = s.seed();
  const c = s.seed({ ownerConfirmed: false });
  const D2 = s.clock.t + 20 * DAY;
  s.chain.set(b.T, 'armed', D2); s.chain.set(c.T, 'armed', D2);
  const before = s.mailer.sent.length;
  s.mailer.failures = 5;
  s.mailer.calls = 0;
  await s.tick(D2 - 14 * DAY);
  await s.tick(D2 - 14 * DAY + 300);
  await s.tick(D2 - 14 * DAY + 600);
  s.restart();
  await s.tick(D2 - 14 * DAY + 900);
  assert.equal(s.mailer.calls, 2, 'one attempt and one retry');
  assert.equal(s.mailer.sent.length, before);
  s.mailer.failures = 0;
  await s.tick(D2 - 3 * DAY);
  assert.equal(s.mailer.sent.length, before + 1, 'the next reminder goes out normally');
  assert.equal(s.mailer.to(`owner-${c.T.slice(2, 8)}`).length, 0);
  s.close();
});

test('watcher_reminders_follow_checkin', async () => {
  const s = setup();
  const D1 = BASE + 30 * DAY;
  const { T } = s.seed();
  s.chain.set(T, 'armed', D1);
  await s.tick(D1 - 3 * DAY);
  assert.equal(s.mailer.sent.length, 1);
  // check-in: the deadline moves 90 days on
  const D2 = D1 + 90 * DAY;
  s.chain.set(T, 'armed', D2);
  await s.tick(D1 - DAY);
  await s.tick(D1 + HOUR); // the old deadline has passed: no reminder, no alarm
  assert.equal(s.mailer.sent.length, 1);
  await s.tick(D2 - 14 * DAY);
  await s.tick(D2 - 14 * DAY + 300);
  assert.equal(s.mailer.sent.length, 2);
  assert.match(s.mailer.sent[1]!.subject, /14 days/);
  // owners who turned reminders off get none
  const off = s.seed({ reminders: false });
  s.chain.set(off.T, 'armed', s.clock.t + 2 * DAY);
  await s.tick(s.clock.t + DAY + 60);
  assert.equal(s.mailer.to(`owner-${off.T.slice(2, 8)}`).length, 0);
  s.close();
});

test('watcher_drill_reminders', async () => {
  const s = setup();
  const D = BASE + 2 * HOUR;
  const prefixes = { en: '[Drill]', fr: '[Exercice]', de: '[Probealarm]' } as const;
  const seeds = (['en', 'fr', 'de'] as const).map((l) => ({ l, ...s.seed({ drill: true, rhythm: 'PT2H', ownerLang: l }) }));
  for (const x of seeds) s.chain.set(x.T, 'armed', D);
  await s.tick(D - 2 * HOUR + 60);
  assert.equal(s.mailer.sent.length, 0);
  await s.tick(D - HOUR); // 50 % of the term
  await s.tick(D - 30 * 60);
  assert.equal(s.mailer.sent.length, 3);
  await s.tick(D); // the deadline: drill reminder + first grace alarm
  assert.equal(s.mailer.sent.length, 9);
  await s.tick(D + 12 * HOUR);
  await s.tick(D + 20 * HOUR);
  await s.tick(D + 23 * HOUR); // no +23 h alarm on a drill
  assert.equal(s.mailer.sent.length, 15);
  for (const x of seeds) {
    const mine = s.mailer.to(`owner-${x.T.slice(2, 8)}`);
    assert.equal(mine.length, 5);
    for (const m of mine) {
      assert.ok(m.subject.startsWith(prefixes[x.l] + ' '), `${x.l}: ${m.subject}`);
      assert.ok(m.text.includes('/app/#/checkin?network=testnet&T=' + x.T + '&rhythm=PT2H'));
    }
  }
  s.close();
});

test('watcher_grace_alarms', async () => {
  const s = setup();
  const D = BASE + 40 * DAY;
  const a = s.seed();
  const b = s.seed();
  s.chain.set(a.T, 'armed', D); s.chain.set(b.T, 'armed', D);
  const owner = (T: string) => s.mailer.to(`owner-${T.slice(2, 8)}`).filter((m) => /open in/.test(m.subject));
  await s.tick(D + 60);
  assert.deepEqual(owner(a.T).map((m) => m.subject), ['Your letters open in 24 hours']);
  // b: a guardian released → no more alarms
  s.chain.set(b.T, 'released', D, 1);
  await s.tick(D + 12 * HOUR);
  await s.tick(D + 12 * HOUR + 300);
  await s.tick(D + 20 * HOUR);
  await s.tick(D + 23 * HOUR);
  await s.tick(D + 23 * HOUR + 1800);
  assert.deepEqual(owner(a.T).map((m) => m.subject), ['Your letters open in 24 hours', 'Your letters open in 12 hours', 'Your letters open in 4 hours', 'Your letters open in 1 hour']);
  for (const m of owner(a.T)) assert.ok(m.text.includes('/app/#/checkin?network=testnet&T=' + a.T));
  assert.equal(owner(b.T).length, 1);
  // none after a release
  s.chain.set(a.T, 'released', D, 1);
  const n = s.mailer.sent.length;
  await s.tick(D + 23 * HOUR + 3000);
  assert.equal(s.mailer.sent.length, n);
  s.close();
});

test('watcher_release_decrypts_link_and_mails', async () => {
  const s = setup();
  const D = BASE + 10 * DAY;
  const { T, rec } = s.seed({ recipients: [{ index: 1, language: 'fr', link: true }, { index: 2, language: 'de', link: true }, { index: 10, link: false }] });
  s.chain.set(T, 'released', D, 1);
  await s.tick(D + 25 * HOUR);
  assert.equal(s.mailer.sent.length, 0, '1 of 2 released: nothing yet');
  s.chain.set(T, 'released', D, 2);
  await s.tick(D + 26 * HOUR);
  const r1 = s.mailer.to('rcpt1-')[0]!, r2 = s.mailer.to('rcpt2-')[0]!, r10 = s.mailer.to('rcpt10-')[0]!;
  assert.ok(r1.text.includes(VECTORS.cases[0]!.link.plaintext), 'decrypted link of the vector');
  assert.ok(r2.text.includes(VECTORS.cases[1]!.link.plaintext));
  assert.ok(r1.html.includes(`href="${VECTORS.cases[0]!.link.plaintext}"`));
  assert.match(r1.subject, new RegExp(`La lettre de ${rec.sender_label}`));
  assert.match(r2.subject, /Brief/);
  assert.ok(r10.text.includes(`Open the vault ${rec.sender_label} gave you.`));
  for (const m of [r1, r2, r10]) assert.ok(m.text.includes(`${APP}/app/#/open`));
  const report = s.mailer.to('owner-');
  assert.equal(report.length, 1);
  assert.match(report[0]!.subject, /delivery report/);
  assert.ok(report[0]!.text.includes('email sent'));
  for (const c of VECTORS.cases) assert.ok(!report[0]!.text.includes(c.link.plaintext), 'no links in the report');
  // K is zeroed after the tick
  assert.equal(s.chain.recovered.length, 1);
  assert.ok(s.chain.recovered[0]!.every((b) => b === 0));
  assert.equal(s.store.getSwitchMeta('testnet', T)?.state, 'delivered');
  await s.tick(D + 27 * HOUR);
  assert.equal(s.mailer.sent.length, 4);
  assert.equal(s.chain.recovered.length, 1, 'a delivered switch is not read again');
  s.close();
});

test('watcher_release_unconfirmed_one_mail', async () => {
  const s = setup();
  const D = BASE + 20 * DAY;
  const { T } = s.seed({ recipients: [{ index: 1, confirmation: 'none', link: true }, { index: 2, confirmation: 'stopped', link: true }] });
  s.chain.set(T, 'armed', D);
  for (const at of [D - 14 * DAY, D - 3 * DAY, D - DAY, D, D + 12 * HOUR, D + 20 * HOUR, D + 23 * HOUR]) await s.tick(at);
  assert.equal(s.mailer.to('rcpt').length, 0, 'nothing before the release');
  s.chain.set(T, 'released', D, 3);
  await s.tick(D + 25 * HOUR);
  await s.tick(D + 26 * HOUR);
  s.restart();
  await s.tick(D + 27 * HOUR);
  assert.equal(s.mailer.to('rcpt1-').length, 1, 'exactly one email');
  assert.ok(s.mailer.to('rcpt1-')[0]!.text.includes(VECTORS.cases[0]!.link.plaintext));
  assert.equal(s.mailer.to('rcpt2-').length, 0, 'a stopped address gets nothing');
  s.close();
});

test('watcher_drill_skips_unconfirmed', async () => {
  const s = setup();
  const D = BASE + HOUR;
  const { T } = s.seed({ drill: true, rhythm: 'PT1H', recipients: [{ index: 1, confirmation: 'confirmed', link: true }, { index: 2, confirmation: 'asked', link: true }] });
  s.chain.set(T, 'released', D, 2);
  await s.tick(D + 25 * HOUR);
  assert.equal(s.mailer.to('rcpt1-').length, 1);
  assert.ok(s.mailer.to('rcpt1-')[0]!.subject.startsWith('[Drill] '));
  assert.equal(s.mailer.to('rcpt2-').length, 0);
  const report = s.mailer.to('owner-')[0]!;
  assert.match(report.text, /Emails sent to recipients: 1\. Recipients without an email: 1\./);
  assert.match(report.text, /2\. Name2x\w+: no email/);
  assert.ok(s.store.listEvents('testnet', T).some((e) => e.kind === 'release_skipped' && e.detail === 'recipient 2'));
  s.close();
});

test('watcher_cancel_deletes_record', async () => {
  const s = setup();
  const { T } = s.seed({ ownerLang: 'de' });
  s.chain.set(T, 'cancelled', BASE + 30 * DAY);
  await s.tick(BASE + 60);
  const mails = s.mailer.to('owner-');
  assert.equal(mails.length, 1);
  assert.match(mails[0]!.subject, /abgebrochen/);
  assert.equal(s.store.getSwitchMeta('testnet', T), undefined);
  assert.equal(s.store.listAddresses('testnet', T).length, 0);
  assert.equal(s.store.listEvents('testnet', T).length, 0);
  assert.equal(s.store.getTombstone('testnet', T)?.state, 'cancelled');
  await s.tick(BASE + 400);
  assert.equal(s.mailer.sent.length, 1);
  // a switch that vanished from the chain counts as cancelled on the second read
  const g = s.seed();
  await s.tick(BASE + 700);
  assert.ok(s.store.getSwitchMeta('testnet', g.T), 'one absent read is not enough');
  await s.tick(BASE + 1000);
  assert.equal(s.store.getSwitchMeta('testnet', g.T), undefined);
  assert.equal(s.store.getTombstone('testnet', g.T)?.state, 'cancelled');
  s.close();
});

test('watcher_retention_and_tombstone', async () => {
  const s = setup();
  const D = BASE + DAY;
  const real = s.seed();
  const drill = s.seed({ drill: true, rhythm: 'PT1H' });
  s.chain.set(real.T, 'released', D, 2); s.chain.set(drill.T, 'released', D, 2);
  const released = D + 25 * HOUR;
  await s.tick(released);
  assert.equal(s.store.getSwitchMeta('testnet', real.T)?.state, 'delivered');
  await s.tick(released + 7 * DAY - 60);
  assert.ok(s.store.getSwitchMeta('testnet', drill.T));
  await s.tick(released + 7 * DAY);
  assert.equal(s.store.getSwitchMeta('testnet', drill.T), undefined, 'drills: 7 days');
  assert.equal(s.store.getTombstone('testnet', drill.T)?.state, 'delivered');
  await s.tick(released + 30 * DAY - 60);
  assert.ok(s.store.getSwitchMeta('testnet', real.T));
  await s.tick(released + 30 * DAY);
  assert.equal(s.store.getSwitchMeta('testnet', real.T), undefined, 'delivered: 30 days after the last email');
  const tomb = s.store.getTombstone('testnet', real.T)!;
  assert.equal(tomb.state, 'delivered');
  assert.equal(tomb.createdAt, BASE);
  assert.equal(tomb.endedAt, released + 30 * DAY);
  assert.equal(s.store.addClaim('testnet', real.T, 'ab'.repeat(32), s.clock.t), false, 'the tombstone refuses a new claim and PUT');
  s.close();
});

test('mail_three_languages', () => {
  const T = '0x' + 'ab'.repeat(32);
  const stop = `${APP}/api/v1/stop/${'s'.repeat(43)}`;
  const subjects: Record<string, string[]> = {};
  for (const lang of ['en', 'fr', 'de'] as const) {
    const base = { lang, T, network: 'testnet', drill: false, rhythm: 'P3M', appUrl: APP, stopUrl: stop };
    const mails = {
      reminder: renderReminder({ ...base, deadline: BASE, days: 14, short: false }),
      reminder1: renderReminder({ ...base, deadline: BASE, days: 1, short: false }),
      drillReminder: renderReminder({ ...base, drill: true, deadline: BASE, days: 0, short: true }),
      alarm: renderAlarm({ ...base, hours: 12 }),
      drillAlarm: renderAlarm({ ...base, drill: true, hours: 1 }),
      release: renderRelease({ lang, sender: 'Patrick', drill: false, link: 'https://example.org/v.html', appUrl: APP, stopUrl: stop }),
      releaseNoLink: renderRelease({ lang, sender: 'Patrick', drill: true, link: null, appUrl: APP, stopUrl: stop }),
      report: renderReport({ lang, T, drill: false, stopUrl: stop, lines: [{ index: 1, name: 'Anna', sent: true }, { index: 2, name: 'Bert', sent: false }] }),
      cancelled: renderCancelled({ lang, T, drill: false, stopUrl: stop }),
      told: renderConfirmation('told_now', { lang, sender: 'Patrick', T, drill: false, confirmUrl: `${APP}/api/v1/confirm/x`, stopUrl: stop }),
    };
    subjects[lang] = Object.values(mails).map((m) => m.subject);
    for (const [name, m] of Object.entries(mails)) {
      assert.ok(m.text.includes(stop) && m.html.includes(`href="${stop}"`), `${lang} ${name}: stop link`);
      assert.equal(m.headers['List-Unsubscribe'], `<${stop}>`);
      assert.doesNotMatch(m.text + m.subject, /\{\w+\}/, `${lang} ${name}: unfilled placeholder`);
      assert.doesNotMatch(m.html, /<img|<script|src=/i, 'no remote images, no scripts');
      assert.match(m.html, new RegExp(`<html lang="${lang}">`));
    }
    for (const m of [mails.reminder, mails.reminder1, mails.drillReminder, mails.alarm, mails.drillAlarm]) {
      assert.ok(m.text.includes(`${APP}/app/#/checkin?network=testnet&T=${T}&rhythm=P3M`), `${lang}: check-in link`);
    }
    const prefix = { en: '[Drill]', fr: '[Exercice]', de: '[Probealarm]' }[lang];
    for (const m of [mails.drillReminder, mails.drillAlarm, mails.releaseNoLink]) assert.ok(m.subject.startsWith(prefix + ' '));
    assert.ok(!mails.reminder.subject.startsWith('['));
    assert.ok(mails.release.text.includes('https://example.org/v.html') && mails.release.text.includes(`${APP}/app/#/open`));
    assert.ok(mails.report.text.includes('Anna') && mails.report.text.includes('Bert'));
    assert.doesNotMatch(mails.report.text, /example\.org\/v\.html/);
  }
  for (const i of subjects.en!.keys()) {
    assert.notEqual(subjects.en![i], subjects.fr![i]);
    assert.notEqual(subjects.en![i], subjects.de![i]);
  }
});

test('logs_redact_personal_data', () => {
  const tok = randomBytes(32).toString('base64url');
  const secret = randomBytes(32).toString('hex');
  const line = redact(`to anna.b@example.net link https://vault.example.com/x?y=1 token ${tok} key 0x${secret} code dms1-testnet-abcdef01-${tok}`);
  for (const n of ['anna.b@example.net', 'vault.example.com', tok, secret]) assert.ok(!line.includes(n), line);
  assert.ok(redact('switch 0xabcdef01 tick').includes('0xabcdef01'), 'short switch labels stay readable');
  // the logger redacts what it is given, even inside errors
  logger.warn('test', { error: new Error(`failed for <${[...SECRETS].find((x) => x.includes('@'))}> ${tok}`) });
  SECRETS.add(tok);
  const out = LOG.join('\n');
  assert.ok(LOG.length > 10, 'the run wrote logs');
  assert.ok(out.includes('[redacted]'));
  for (const s of SECRETS) assert.ok(!out.includes(s), `the log contains ${s}`);
});
