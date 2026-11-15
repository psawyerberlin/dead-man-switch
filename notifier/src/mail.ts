// Emails of the messenger, rendered from the i18n files: plain text plus a simple HTML part, no remote images,
// a stop link and a List-Unsubscribe header in every email, the drill prefix in subjects (SPEC.md §5.4).
// Phase 2 needs the two confirmation emails (owner, "told now" §3.3.1); the watcher's emails come in phase 3.
import { randomBytes } from 'node:crypto';
import { t, type MessageKey } from './i18n.ts';
import type { MailMessage } from './interfaces.ts';
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
