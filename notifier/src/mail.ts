// Emails of the messenger, rendered from the i18n files: plain text plus a simple HTML part, no remote images,
// a stop link and a List-Unsubscribe header in every email, the drill prefix in subjects (SPEC.md §5.4).
import { randomBytes } from 'node:crypto';
import { t, type MessageKey } from './i18n.ts';
import nodemailer, { type Transporter } from 'nodemailer';
import type { MailMessage, Mailer } from './interfaces.ts';
import type { AddressRow, Store } from './store.ts';

export const API_PREFIX = '/api/v1';

/** A fresh token for a confirm or stop link (32 random bytes, base64url); only its SHA-256 is stored. */
export const newToken = (): string => randomBytes(32).toString('base64url');
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export const confirmUrl = (appUrl: string, token: string): string => `${appUrl}${API_PREFIX}/confirm/${token}`;
export const stopUrl = (appUrl: string, token: string): string => `${appUrl}${API_PREFIX}/stop/${token}`;
/** How a switch is named in emails: `0x` and the first 8 hex digits of `T` (nothing personal). */
export const switchLabel = (T: string): string => T.slice(0, 10);

/** An address may be mailed unless it pressed "stop" for this switch or "never" for all of them. */
export const canMail = (store: Store, a: AddressRow): boolean => a.confirmation !== 'stopped' && !store.isNever(a.email);

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Builds text and HTML from paragraphs; `{url}`s become links in the HTML part. */
export function compose(lang: string, subject: string, paragraphs: string[], stop: string): Omit<MailMessage, 'to'> {
  const footer = t(lang, 'footer_stop', { url: stop });
  const text = [...paragraphs, '--', footer].join('\n\n') + '\n';
  const linkify = (p: string) => escapeHtml(p).replace(/https?:\/\/[^\s<>"']+/g, (u) => `<a href="${u}">${u}</a>`).replace(/\n/g, '<br>');
  const html = `<!doctype html><html lang="${escapeHtml(lang)}"><head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>`
    + `<body style="font-family:system-ui,sans-serif;line-height:1.5;max-width:40em">`
    + paragraphs.map((p) => `<p>${linkify(p)}</p>`).join('')
    + `<hr><p style="font-size:small">${linkify(footer)}</p></body></html>`;
  return { subject, text, html, headers: { 'List-Unsubscribe': `<${stop}>` } };
}

export const subjectFor = (lang: string, key: MessageKey, drill: boolean, params: Record<string, string | number> = {}): string =>
  (drill ? t(lang, 'drill_prefix') + ' ' : '') + t(lang, key, params);

export interface ConfirmationParams { lang: string; sender: string; T: string; drill: boolean; confirmUrl: string; stopUrl: string }

/** The owner's confirmation email, or the recipient's "told now" email (§3.3.1: no vault link, nothing about the letter). */
export function renderConfirmation(kind: 'owner_confirm' | 'told_now', p: ConfirmationParams): Omit<MailMessage, 'to'> {
  const vars = { sender: p.sender, switch: switchLabel(p.T) };
  const subject = subjectFor(p.lang, kind === 'owner_confirm' ? 'owner_confirm_subject' : 'told_now_subject', p.drill, vars);
  const body = t(p.lang, kind === 'owner_confirm' ? 'owner_confirm_text' : 'told_now_text', vars);
  return compose(p.lang, subject, [body, t(p.lang, 'told_now_confirm', { url: p.confirmUrl })], p.stopUrl);
}

// ---- the watcher's emails (phase 3)

/** The phone check-in page of SPEC.md §3.2, carried by every reminder and alarm. */
export const checkinUrl = (appUrl: string, network: string, T: string, rhythm: string): string =>
  `${appUrl}/app/#/checkin?network=${encodeURIComponent(network)}&T=${encodeURIComponent(T)}&rhythm=${encodeURIComponent(rhythm)}`;
export const openPageUrl = (appUrl: string): string => `${appUrl}/app/#/open`;

/** A chain time (unix seconds) in the address's language, in UTC. */
export function formatDate(lang: string, at: number): string {
  const date = new Intl.DateTimeFormat(lang, { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(at * 1000));
  return t(lang, 'deadline_utc', { date });
}

export interface SwitchMailParams { lang: string; T: string; network: string; drill: boolean; rhythm: string; appUrl: string; stopUrl: string }

/** Owner reminder before the deadline: `days` left (long terms) or the drill reminder (short terms). */
export function renderReminder(p: SwitchMailParams & { deadline: number; days: number; short: boolean }): Omit<MailMessage, 'to'> {
  const vars = { switch: switchLabel(p.T), deadline: formatDate(p.lang, p.deadline), days: p.days };
  const subject = p.short ? subjectFor(p.lang, 'reminder_drill_subject', p.drill, vars)
    : subjectFor(p.lang, p.days <= 1 ? 'reminder_subject_one' : 'reminder_subject', p.drill, vars);
  const body = t(p.lang, p.short ? 'reminder_drill_text' : 'reminder_text', vars);
  return compose(p.lang, subject, [body, t(p.lang, 'checkin_link', { url: checkinUrl(p.appUrl, p.network, p.T, p.rhythm) })], p.stopUrl);
}

/** Grace alarm: "Your letters open in N hours. Check in now:" with the phone check-in link. */
export function renderAlarm(p: SwitchMailParams & { hours: number }): Omit<MailMessage, 'to'> {
  const vars = { switch: switchLabel(p.T), hours: p.hours };
  const subject = subjectFor(p.lang, p.hours <= 1 ? 'alarm_subject_one' : 'alarm_subject', p.drill, vars);
  return compose(p.lang, subject, [t(p.lang, 'alarm_text', vars), t(p.lang, 'checkin_link', { url: checkinUrl(p.appUrl, p.network, p.T, p.rhythm) })], p.stopUrl);
}

/** The release email of §3.3.3: the decrypted link (or "open the vault <sender> gave you"), the open page, three steps. */
export function renderRelease(p: { lang: string; sender: string; drill: boolean; link: string | null; appUrl: string; stopUrl: string }): Omit<MailMessage, 'to'> {
  const vars = { sender: p.sender };
  const paragraphs = [
    t(p.lang, 'release_text', vars),
    p.link ? t(p.lang, 'release_link', { url: p.link }) : t(p.lang, 'release_no_link', vars),
    t(p.lang, 'release_open_page', { url: openPageUrl(p.appUrl) }),
    t(p.lang, 'release_steps'),
  ];
  return compose(p.lang, subjectFor(p.lang, 'release_subject', p.drill, vars), paragraphs, p.stopUrl);
}

/** The owner's delivery report: who was emailed, never a link. */
export function renderReport(p: { lang: string; T: string; drill: boolean; stopUrl: string;
  lines: { index: number; name: string; sent: boolean }[] }): Omit<MailMessage, 'to'> {
  const sent = p.lines.filter((l) => l.sent).length;
  const paragraphs = [
    t(p.lang, 'report_text', { switch: switchLabel(p.T), sent, skipped: p.lines.length - sent }),
    p.lines.map((l) => t(p.lang, l.sent ? 'report_line_sent' : 'report_line_not_sent', { index: l.index, name: l.name })).join('\n'),
  ];
  return compose(p.lang, subjectFor(p.lang, 'report_subject', p.drill), paragraphs, p.stopUrl);
}

/** "Cancelled; the messenger deleted the data." */
export function renderCancelled(p: { lang: string; T: string; drill: boolean; stopUrl: string }): Omit<MailMessage, 'to'> {
  return compose(p.lang, subjectFor(p.lang, 'cancelled_subject', p.drill), [t(p.lang, 'cancelled_text', { switch: switchLabel(p.T) })], p.stopUrl);
}

/** The real mailer: SMTP through nodemailer, implicit TLS on 465 or STARTTLS required on 587 (SPEC.md §5.4). */
export class SmtpMailer implements Mailer {
  private readonly transport: Transporter;
  constructor(smtp: { host: string; port: number; secure: boolean; requireTLS: boolean; user: string; pass: string }, private readonly from: string) {
    this.transport = nodemailer.createTransport({ host: smtp.host, port: smtp.port, secure: smtp.secure, requireTLS: smtp.requireTLS,
      auth: { user: smtp.user, pass: smtp.pass } });
  }
  async send(msg: MailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.from, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html, headers: msg.headers });
  }
}
