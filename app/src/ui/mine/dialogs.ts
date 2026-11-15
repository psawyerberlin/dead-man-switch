// The dialogs of a switch card: Away until…, Messenger settings, Change guardians, open the owner archive.
import { LANGUAGES, type Language } from '../../core/bundle';
import { awayBounds, awayDeadline, AwayError } from '../../core/away';
import { formatCkb, formatDate, t, translate } from '../../core/i18n';
import type { RecordPatch } from '../../core/messenger';
import type { SavedSwitch } from '../../core/switches';
import { button } from '../components/button';
import { openDialog } from '../components/dialog';
import { field, input, select } from '../components/field';
import { h } from '../dom';
import { readText } from '../screens/open';
import { checkbox, note } from '../write/controls';
import type { MineApp } from './view';

/** Away until…: a check-in with a chosen date (earliest tomorrow, latest 5 years), at 12:00 local time. */
export function awayDialog(app: MineApp, sw: SavedSwitch, parent: HTMLElement): void {
  const svc = app.service;
  const b = awayBounds(svc.now());
  const date = input({ type: 'date', min: b.min, max: b.max, 'data-k': 'away-date', required: true });
  const f = field({ label: t('away.date_label'), hint: t('away.hint', { min: formatDate(awayDeadline(b.min, svc.now()), undefined, { time: false }),
    max: formatDate(awayDeadline(b.max, svc.now()), undefined, { time: false }) }), control: date });
  const summary = h('p', { class: 'dms-consequence', 'aria-live': 'polite' });
  const go = button(t('away.confirm'), { kind: 'primary', disabled: true });
  go.setAttribute('data-action', 'away-confirm');
  let deadline: number | null = null;
  const refresh = (): void => {
    deadline = null;
    summary.textContent = '';
    if (!date.value) { f.setError(null); go.disabled = true; return; }
    try {
      deadline = awayDeadline(date.value, svc.now());
      f.setError(null);
      const est = svc.checkinQuote(sw, deadline);
      summary.textContent = `${t('mine.checkin_note', { deadline: formatDate(deadline) })}${est ? ` ${t('mine.checkin_cost', { amount: formatCkb(est.spentOverTerm) })}` : ''}`;
    } catch (e) {
      f.setError(t(e instanceof AwayError && e.code === 'late' ? 'away.too_late' : e instanceof AwayError && e.code === 'early' ? 'away.too_early' : 'away.invalid'));
    }
    go.disabled = deadline === null;
  };
  date.addEventListener('input', refresh);
  date.addEventListener('change', refresh);
  const cancel = button(t('cancel.keep'), { kind: 'quiet' });
  const d = openDialog({ title: t('away.title'), body: [h('p', {}, t('away.intro')), f.el, summary], actions: [cancel, go], initialFocus: date }, parent);
  cancel.addEventListener('click', () => d.close());
  go.addEventListener('click', () => {
    if (deadline === null) return;
    const target = deadline;
    d.close();
    void svc.checkin(sw, target);
  });
}

/** Messenger settings: the owner's email and reminders, the recipients' emails, languages and "tell them now". */
export function settingsDialog(app: MineApp, sw: SavedSwitch, parent: HTMLElement): void {
  const svc = app.service;
  const close = button(t('action.close'), { kind: 'quiet' });
  if (!svc.ownerCode(sw)) {
    const code = input({ 'data-k': 'owner-code', autocomplete: 'off', spellcheck: 'false' });
    const f = field({ label: t('owner_code.title'), hint: t('settings.needs_code'), control: code });
    const restore = button(t('mine.restore'), { kind: 'primary' });
    const d = openDialog({ title: t('messenger.settings'), body: [f.el], actions: [close, restore] }, parent);
    close.addEventListener('click', () => d.close());
    restore.addEventListener('click', () => {
      void svc.restoreFromCode(code.value, sw.T).then(() => { d.close(); settingsDialog(app, sw, parent); },
        (e: unknown) => f.setError((e as Error).message));
    });
    return;
  }
  const view = svc.card(sw).messenger;
  const rec = view?.record;
  const ownerEmail = input({ type: 'email', 'data-k': 'settings-owner-email', autocomplete: 'email' });
  ownerEmail.value = rec?.owner?.email ?? '';
  let reminders = rec?.owner?.reminders !== false;
  const rows = (rec?.recipients ?? sw.recipients?.map((r) => ({ ...r, email: '', tell_now: false })) ?? []).map((r) => {
    const email = input({ type: 'email', 'data-k': `settings-r${r.index}-email` });
    email.value = ('email' in r && r.email) || '';
    const lang = select(LANGUAGES.map((l) => ({ value: l, label: translate(l, 'app.language_name') })), r.language);
    const state = { index: r.index, tell: 'tell_now' in r && r.tell_now === true, email, lang };
    const el = h('fieldset', { class: 'dms-settings__recipient' }, h('legend', {}, r.name),
      field({ label: t('recipients.email_label'), control: email }).el, field({ label: t('recipients.language_label'), control: lang }).el,
      checkbox(t('recipients.tell_now'), state.tell, (v) => { state.tell = v; }));
    return { state, el };
  });
  const error = h('p', { class: 'dms-field__error', role: 'alert', hidden: true });
  const save = button(t('settings.save'), { kind: 'primary' });
  save.setAttribute('data-action', 'settings-save');
  const d = openDialog({ title: t('messenger.settings'), body: [
    view ? null : note(t('settings.not_loaded'), 'warn'),
    field({ label: t('messenger.owner_email'), control: ownerEmail }).el,
    checkbox(t('messenger.reminders'), reminders, (v) => { reminders = v; }),
    ...rows.map((r) => r.el),
    note(t('settings.links_need_archive')), error], actions: [close, save] }, parent);
  close.addEventListener('click', () => d.close());
  save.addEventListener('click', () => {
    const patch: RecordPatch = {
      owner: { email: ownerEmail.value.trim() || null, reminders },
      recipients: rows.map(({ state }) => ({ index: state.index, email: state.email.value.trim() || null, language: state.lang.value as Language, tell_now: state.tell })),
    };
    void svc.saveSettings(sw, patch).then((ok) => {
      if (ok) d.close();
      else { error.textContent = svc.card(sw).messengerError ?? ''; error.hidden = false; }
    });
  });
}

/** Opens the owner archive of this switch (file + passphrase); kept in memory for this page only. */
export function archiveDialog(app: MineApp, sw: SavedSwitch, parent: HTMLElement, then?: () => void): void {
  const svc = app.service;
  const file = input({ type: 'file', accept: '.dmsa,application/json', 'data-k': 'archive-file' });
  const pass = input({ type: 'password', autocomplete: 'current-password', 'data-k': 'archive-pass' });
  const f = field({ label: t('archive.passphrase'), control: pass });
  const close = button(t('action.close'), { kind: 'quiet' });
  const open = button(t('mine.archive_open'), { kind: 'primary' });
  const d = openDialog({ title: t('mine.archive_title'), body: [h('p', {}, t('mine.download_unavailable')),
    field({ label: t('mine.archive_file'), control: file }).el, f.el], actions: [close, open] }, parent);
  close.addEventListener('click', () => d.close());
  open.addEventListener('click', () => {
    const chosen = file.files?.[0];
    if (!chosen) { f.setError(t('mine.archive_missing')); return; }
    void readText(chosen).then((text) => svc.openArchive(sw, text, pass.value)).then(() => { d.close(); then?.(); },
      () => f.setError(t('mine.archive_failed')));
  });
}

/**
 * Change guardians (CRT rewrap) needs K, hence the owner archive (or the Write tab of this switch), and produces new
 * vaults that must replace the old ones with every recipient: said before, during and after.
 */
export function changeGuardiansDialog(app: MineApp, sw: SavedSwitch, parent: HTMLElement): void {
  const svc = app.service;
  const close = button(t('action.close'), { kind: 'quiet' });
  const hasK = svc.archiveOf(sw) !== null || (app.sessions?.() ?? []).some((x) => x.created?.T === sw.T.toLowerCase() && x.created.K);
  if (!hasK) {
    const open = button(t('mine.archive_open'), { kind: 'primary' });
    const d = openDialog({ title: t('mine.change_guardians'), body: [h('p', { 'data-change': 'needs-archive' }, t('mine.change_needs_archive')),
      note(t('mine.change_warning'), 'warn')], actions: [close, open] }, parent);
    close.addEventListener('click', () => d.close());
    open.addEventListener('click', () => { d.close(); archiveDialog(app, sw, parent, () => changeGuardiansDialog(app, sw, parent)); });
    return;
  }
  const d = openDialog({ title: t('mine.change_guardians'), body: [note(t('mine.change_warning'), 'warn', { 'data-change': 'warning' }),
    h('p', {}, t('mine.change_steps'))], actions: [close] }, parent);
  close.addEventListener('click', () => d.close());
}
