// Write steps 1–3 (SPEC.md §3.1.2–4): letters, recipients (with the messenger), rhythm.
import { type Language, LANGUAGES } from '../../core/bundle';
import { formatBytes, formatDate, getLanguage, MESSAGES, t } from '../../core/i18n';
import { MAX_RHYTHM_DAYS } from '../../core/rhythm';
import { TEMPLATES, type TemplateId } from '../../core/templates';
import { button, linkButton } from '../components/button';
import { field, input, select } from '../components/field';
import { sheet } from '../components/sheet';
import { h, nextId } from '../dom';
import { actions, checkbox, note, radioGroup } from './controls';
import { type LetterFile, type LetterMode, type RecipientDraft, WriteSession, fileFromBytes } from './session';
import type { StepView } from './view';

const recipientLabel = (r: RecipientDraft): string => r.name.trim() || t('recipients.unnamed', { n: r.index });

// ---- letters ---------------------------------------------------------------------------------------------------

interface EditorTarget {
  get(): string;
  set(v: string): void;
  files: LetterFile[] | null;
  language: Language;
  label: string;
  key: string;
}

function editor(v: StepView, target: EditorTarget, onInput: () => void): HTMLElement {
  const area = h('textarea', { rows: 10, 'data-k': `${target.key}:text`, placeholder: t('letter.text_placeholder'), spellcheck: 'true' });
  area.value = target.get();
  area.addEventListener('input', () => { target.set(area.value); onInput(); });
  const tpl = select(TEMPLATES.map((id) => ({ value: id, label: t(`template.${id}.title`) })));
  tpl.setAttribute('data-k', `${target.key}:template`);
  const insert = button(t('letters.template_insert'), { kind: 'quiet', onClick: () => {
    area.value = WriteSession.insertTemplate(area.value, tpl.value as TemplateId, target.language);
    target.set(area.value);
    onInput();
    area.focus();
  } });
  insert.setAttribute('data-k', `${target.key}:insert`);
  const parts: HTMLElement[] = [
    field({ label: target.label, hint: t('letter.markdown_hint'), control: area }).el,
    h('div', { class: 'dms-template' }, field({ label: t('letters.template'), control: tpl }).el, insert),
  ];
  if (target.files) parts.push(filePicker(v, target.files, target.key));
  return h('div', { class: 'dms-editor' }, ...parts);
}

function filePicker(v: StepView, files: LetterFile[], key: string): HTMLElement {
  const id = nextId('files');
  const picker = h('input', { type: 'file', id, multiple: true, class: 'dms-visually-hidden', 'data-k': `${key}:files` });
  const add = async (list: FileList | null): Promise<void> => {
    for (const f of Array.from(list ?? [])) files.push(fileFromBytes(f.name, f.type, new Uint8Array(await f.arrayBuffer())));
    v.s.changed();
  };
  picker.addEventListener('change', () => void add(picker.files));
  const zone = h('label', { for: id, class: 'dms-dropzone' }, t('letter.files_drop'));
  zone.addEventListener('dragover', (ev) => { ev.preventDefault(); zone.classList.add('is-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('is-over'));
  zone.addEventListener('drop', (ev) => { ev.preventDefault(); zone.classList.remove('is-over'); void add((ev as DragEvent).dataTransfer?.files ?? null); });
  const total = files.reduce((a, f) => a + f.size, 0);
  return h('div', { class: 'dms-files' },
    h('p', { class: 'dms-field__label' }, t('letter.files_label')), picker, zone,
    files.length ? h('ul', { class: 'dms-files__list' }, ...files.map((f, i) => h('li', {},
      h('span', {}, `${f.name} · ${formatBytes(f.size)}`),
      button(t('letter.remove_file'), { kind: 'quiet', label: `${t('letter.remove_file')}: ${f.name}`, onClick: () => { files.splice(i, 1); v.s.changed(); } })))) : null,
    h('p', { class: 'dms-field__hint' }, t('letter.files_total', { count: files.length, size: formatBytes(total) })));
}

export function lettersStep(v: StepView): HTMLElement {
  const s = v.s;
  const max = s.maxVaultBytes;
  const sizes = h('ul', { class: 'dms-sizes', 'aria-live': 'polite' });
  const next = button(t('action.next'), { kind: 'primary', onClick: () => v.go('recipients') });
  const refresh = (): void => {
    sizes.replaceChildren(...s.recipients.map((r) => {
      const size = s.vaultSize(r);
      const over = size > max;
      return h('li', { class: `dms-size${over ? ' is-over' : ''}`, 'data-size': r.index },
        h('meter', { min: 0, max, value: Math.min(size, max), 'aria-hidden': 'true' }),
        h('span', {}, t('letter.size', { name: recipientLabel(r), size: formatBytes(size), max: formatBytes(max) })),
        over ? h('span', { class: 'dms-field__error', role: 'alert' }, t('letter.files_limit', { max: formatBytes(max), excess: formatBytes(size - max) })) : null);
    }));
    next.disabled = !s.lettersValid();
  };

  const sender = input({ 'data-k': 'sender', autocomplete: 'name', maxlength: 100 });
  sender.value = s.senderLabel;
  sender.addEventListener('input', () => { s.senderLabel = sender.value; refresh(); });

  const mode = radioGroup<LetterMode>(t('letters.mode_label'), 'mode', [
    { value: 'shared', label: t('letters.mode_shared') },
    { value: 'each', label: t('letters.mode_each') },
    { value: 'note', label: t('letters.mode_shared_note') },
  ], s.mode, (m) => { s.mode = m; s.changed(); });

  const body: HTMLElement[] = [];
  if (s.mode !== 'each') {
    body.push(editor(v, { get: () => s.shared.text, set: (x) => { s.shared.text = x; }, files: s.shared.files, language: getLanguage(),
      label: t('letters.shared_label'), key: 'shared' }, refresh));
  }
  if (s.mode !== 'shared') {
    for (const r of s.recipients) {
      const name = input({ 'data-k': `r${r.index}:name`, maxlength: 200 });
      name.value = r.name;
      name.addEventListener('input', () => { r.name = name.value; refresh(); });
      const ed = s.mode === 'each'
        ? editor(v, { get: () => r.text, set: (x) => { r.text = x; }, files: r.files, language: r.language, label: t('letter.text_label'), key: `r${r.index}` }, refresh)
        : editor(v, { get: () => r.note, set: (x) => { r.note = x; }, files: null, language: r.language, label: t('letters.note_label'), key: `r${r.index}` }, refresh);
      body.push(h('section', { class: 'dms-letter-for' }, h('h2', { class: 'dms-sheet__subtitle' }, t('letters.for', { name: recipientLabel(r) })),
        field({ label: t('recipients.name_label'), control: name }).el, ed));
    }
    const add = button(t('recipients.add'), { kind: 'secondary', disabled: !s.canAddRecipient, onClick: () => { s.addRecipient(); } });
    add.setAttribute('data-k', 'add-recipient');
    body.push(h('div', { class: 'dms-actions' }, add), s.canAddRecipient ? null as never : note(t('recipients.max_reached', { max: s.maxRecipients })));
  }
  refresh();
  return sheet({ title: t('letter.title'), level: 1, class: 'dms-write__sheet' },
    note(t('letter.memory_note'), 'warn'),
    field({ label: t('letter.sender_label'), control: sender }).el,
    mode, ...body.filter(Boolean),
    h('h2', { class: 'dms-sheet__subtitle' }, t('letters.sizes')), sizes,
    actions(linkButton(t('action.back'), '#/', { kind: 'quiet' }), next));
}

// ---- recipients --------------------------------------------------------------------------------------------------

export function recipientsStep(v: StepView): HTMLElement {
  const s = v.s;
  const next = button(t('action.next'), { kind: 'primary', onClick: () => v.go('rhythm') });
  const refresh = (): void => { next.disabled = !s.recipientsValid(); };
  const langOptions = LANGUAGES.map((l) => ({ value: l, label: MESSAGES[l]['app.language_name'] ?? l }));
  const cards = s.recipients.map((r) => {
    const name = input({ 'data-k': `r${r.index}:name`, autocomplete: 'off', maxlength: 200 });
    name.value = r.name;
    name.addEventListener('input', () => { r.name = name.value; legend.textContent = recipientLabel(r); refresh(); });
    const lang = select(langOptions, r.language);
    lang.setAttribute('data-k', `r${r.index}:lang`);
    lang.addEventListener('change', () => { r.language = lang.value as Language; });
    const email = input({ type: 'email', 'data-k': `r${r.index}:email`, autocomplete: 'off', inputmode: 'email' });
    email.value = r.email;
    const emailField = field({ label: t('recipients.email_label'), hint: t('recipients.email_note'), control: email });
    email.addEventListener('input', () => { r.email = email.value; refresh(); });
    email.addEventListener('blur', () => emailField.setError(email.value.trim() && !email.checkValidity() ? t('recipients.email_invalid') : null));
    const legend = h('legend', { class: 'dms-recipient__name' }, recipientLabel(r));
    return h('fieldset', { class: 'dms-recipient', 'data-recipient': r.index }, legend,
      field({ label: t('recipients.name_label'), hint: t('recipients.name_note'), control: name }).el,
      field({ label: t('recipients.language_label'), control: lang }).el,
      emailField.el,
      s.messengerOn ? checkbox(t('recipients.tell_now'), r.tellNow, (c) => { r.tellNow = c; }, { 'data-k': `r${r.index}:tell` }) : null,
      s.recipients.length > 1 ? h('div', { class: 'dms-actions' }, button(t('recipients.remove'), { kind: 'quiet', onClick: () => s.removeRecipient(r.index) })) : null);
  });
  const add = button(t('recipients.add'), { kind: 'secondary', disabled: !s.canAddRecipient, onClick: () => { s.addRecipient(); } });
  add.setAttribute('data-k', 'add-recipient');
  add.classList.add('dms-recipients__add');

  const messenger: HTMLElement[] = [h('h2', { class: 'dms-sheet__subtitle' }, t('messenger.title')), h('p', {}, t('messenger.intro'))];
  if (s.messengerAvailable) {
    messenger.push(checkbox(t('messenger.use'), s.messenger.on, (c) => { s.messenger.on = c; s.changed(); }, { 'data-k': 'messenger' }));
    if (s.messenger.on) {
      const email = input({ type: 'email', 'data-k': 'owner-email', autocomplete: 'email', inputmode: 'email' });
      email.value = s.messenger.email;
      email.addEventListener('input', () => { s.messenger.email = email.value; });
      messenger.push(field({ label: t('messenger.owner_email'), hint: t('messenger.owner_email_note'), control: email }).el,
        checkbox(t('messenger.reminders'), s.messenger.reminders, (c) => { s.messenger.reminders = c; }, { 'data-k': 'reminders' }));
    }
  } else {
    messenger.push(note(t('messenger.unavailable')));
  }
  refresh();
  return sheet({ title: t('recipients.title'), level: 1, class: 'dms-write__sheet' },
    h('p', {}, t('recipients.intro', { max: s.maxRecipients })),
    h('div', { class: 'dms-recipients' }, ...cards),
    h('div', { class: 'dms-actions' }, add),
    s.canAddRecipient ? null : note(t('recipients.max_reached', { max: s.maxRecipients }), 'soft', { 'data-max': 'reached' }),
    ...messenger,
    actions(linkButton(t('action.back'), '#/write/letters', { kind: 'quiet' }), next));
}

// ---- rhythm --------------------------------------------------------------------------------------------------------

export function rhythmStep(v: StepView): HTMLElement {
  const s = v.s;
  const presets = s.config?.rhythms_months ?? [1, 3, 6, 12];
  const current = s.rhythm.kind === 'months' && presets.includes(s.rhythm.months) ? `m${s.rhythm.months}` : 'custom';
  const days = input({ type: 'number', min: 1, max: MAX_RHYTHM_DAYS, step: 1, 'data-k': 'rhythm-days', inputmode: 'numeric' });
  days.value = String(s.rhythm.kind === 'days' ? s.rhythm.days : 30);
  const consequence = h('p', { class: 'dms-consequence', 'aria-live': 'polite' });
  const next = button(t('action.next'), { kind: 'primary', onClick: () => v.go('guardians') });
  const refresh = (): void => {
    const deadline = s.deadlineFrom();
    consequence.textContent = t('rhythm.consequence', { deadline: formatDate(deadline), opens: formatDate(deadline + 86_400) });
  };
  days.addEventListener('input', () => {
    const d = Number(days.value);
    if (Number.isInteger(d) && d >= 1 && d <= MAX_RHYTHM_DAYS) { s.rhythm = { kind: 'days', days: d }; next.disabled = false; refresh(); } else next.disabled = true;
  });
  const choices = [...presets.map((m) => ({ value: `m${m}`, label: t('rhythm.option', { months: m }) })), { value: 'custom', label: t('rhythm.custom_days') }];
  const group = radioGroup<string>(t('rhythm.label'), 'rhythm', choices, current, (val) => {
    s.rhythm = val === 'custom' ? { kind: 'days', days: Math.max(1, Math.min(MAX_RHYTHM_DAYS, Number(days.value) || 30)) } : { kind: 'months', months: Number(val.slice(1)) };
    s.changed();
  }, { custom: current === 'custom' ? field({ label: t('rhythm.days_label'), control: days }).el : null });
  refresh();
  return sheet({ title: t('rhythm.title'), level: 1, class: 'dms-write__sheet' },
    group, consequence, h('p', { class: 'dms-soft' }, t('rhythm.grace_note')), h('p', { class: 'dms-soft' }, t('rhythm.long_warning')),
    actions(linkButton(t('action.back'), '#/write/recipients', { kind: 'quiet' }), next));
}
