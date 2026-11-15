// Write steps 6–8 (SPEC.md §3.1.7–9, §3.3.2, §3.5, §3.7): create, seal, hand over.
import { passphraseStrength } from '../../core/archive';
import { formatDate, getLanguage, t } from '../../core/i18n';
import { runnerName } from '../../core/guardians';
import { guideSteps, isPlace, PLACES, placeName, type PlaceId } from '../../core/places';
import { qrSvg } from '../../core/qr';
import { button, linkButton } from '../components/button';
import { field, input, select } from '../components/field';
import { icon } from '../components/icons';
import { press, seal } from '../components/seal';
import { sheet } from '../components/sheet';
import { toast } from '../components/toast';
import { h } from '../dom';
import { actions, checkbox, note } from './controls';
import { type CreatePhase, type RecipientDraft, WriteSession } from './session';
import type { StepView } from './view';

// ---- create --------------------------------------------------------------------------------------------------------

const PHASES: CreatePhase[] = ['claim', 'sign', 'wait', 'verify', 'arm'];

export function createStep(v: StepView): HTMLElement {
  const s = v.s;
  const st = s.status;
  const phases = PHASES.filter((p) => p !== 'claim' || s.messengerOn);
  const at = st.phase === 'done' ? phases.length : phases.indexOf(st.phase as CreatePhase);
  const items = phases.map((p, i) => {
    const state = st.phase === 'failed' ? (i < Math.max(0, lastIndex(s, phases)) ? 'done' : 'upcoming') : i < at ? 'done' : i === at ? 'current' : 'upcoming';
    return h('li', { class: `dms-progress__item is-${state}`, 'data-phase': p, 'aria-current': state === 'current' ? 'step' : undefined },
      h('span', { class: 'dms-progress__icon' }, icon(state === 'done' ? 'check' : p === 'wait' ? 'shield' : p === 'claim' ? 'people' : 'seal', 20)),
      h('span', {}, t(`create.step.${p}`, { done: st.done, n: st.n })));
  });
  const chosen = s.created?.chosen ?? s.chosen();
  const parts: (HTMLElement | null)[] = [h('ol', { class: 'dms-progress', 'aria-live': 'polite' }, ...items)];
  if (st.phase === 'wait' || st.phase === 'verify') {
    parts.push(h('ul', { class: 'dms-progress__guardians' }, ...chosen.map((r, i) =>
      h('li', { class: i < st.done ? 'is-done' : 'is-waiting' }, runnerName(r), h('span', { class: 'dms-visually-hidden' }, ` (${t(i < st.done ? 'create.guardian_ready' : 'create.guardian_waiting')})`)))),
    note(t('create.waiting_note')));
  }
  let primary: HTMLElement | null = null;
  if (st.phase === 'failed') {
    parts.push(note(st.rule !== null ? t('create.verify_failed', { rule: st.rule }) : t('error.generic', { message: st.error ?? '' }), 'error', { 'data-create-error': '' }));
    if (!st.sent && st.rule === null) primary = button(t('action.retry'), { kind: 'primary', onClick: () => { void s.create(t('guardians.ack_phrase')); } });
  } else if (st.phase === 'idle') {
    primary = button(t('price.next'), { kind: 'primary', onClick: () => { void s.create(t('guardians.ack_phrase')); } });
  } else if (st.phase === 'done') {
    parts.push(note(t('create.done'), 'ok'));
    primary = button(t('create.to_seal'), { kind: 'primary', onClick: () => v.go('seal') });
  }
  const back = st.sent || s.created ? null : linkButton(t('action.back'), '#/write/price', { kind: 'quiet' });
  return sheet({ title: t('create.title'), level: 1, class: 'dms-write__sheet' }, ...parts, actions(back, primary));
}

function lastIndex(s: WriteSession, phases: CreatePhase[]): number {
  if (!s.created) return 0;
  return s.status.sent ? phases.indexOf('wait') + 1 : phases.indexOf('sign');
}

// ---- seal ----------------------------------------------------------------------------------------------------------

/** The printable cover sheet of one recipient's paper backup (SPEC.md §3.7). */
export function paperBackup(s: WriteSession, r: RecipientDraft): HTMLElement {
  const c = s.created!;
  const target = r.link.trim() || `${s.config?.app_url ?? ''}/app/#/open`;
  const qr = new DOMParser().parseFromString(qrSvg(target), 'image/svg+xml').documentElement;
  const doc = document;
  return h('article', { class: 'dms-paper' },
    h('h1', {}, t('paper.heading', { sender: s.senderLabel.trim(), recipient: r.name.trim() })),
    h('p', {}, t('paper.sealed_on', { date: formatDate(c.createdAt, getLanguage(), { time: false }) })),
    h('p', {}, `${t('paper.switch_id')}: `, h('code', {}, c.T)),
    doc.importNode(qr, true),
    h('p', {}, h('code', {}, target)),
    h('ol', {}, h('li', {}, t('paper.step1')), h('li', {}, t('paper.step2')), h('li', {}, t('paper.step3'))));
}

export function sealStep(v: StepView): HTMLElement {
  const s = v.s;
  const io = v.app.io;
  if (!s.vaults && !s.sealing && !s.sealError) void s.seal();
  const parts: (HTMLElement | null)[] = [h('p', {}, t('seal.intro'))];
  const next = button(t('seal.next'), { kind: 'primary', disabled: !s.saved, onClick: () => v.go('handover') });
  next.setAttribute('data-k', 'seal-next');
  if (s.sealError) parts.push(note(t('error.generic', { message: s.sealError }), 'error'));
  else if (!s.vaults) parts.push(note(t('seal.sealing')));
  else {
    const seals = s.vaults.map((vault) => {
      const el = seal({ name: s.senderLabel, seed: vault.index, size: 112 });
      return { vault, el };
    });
    parts.push(h('ul', { class: 'dms-seals' }, ...seals.map(({ vault, el }) => h('li', { class: 'dms-seals__item', 'data-vault': vault.index },
      el, h('p', { class: 'dms-seals__name' }, t('seal.for', { name: vault.name })),
      h('p', { class: 'dms-field__hint dms-mono' }, t('seal.filename', { name: vault.fileName })),
      button(t('seal.download_one', { name: vault.name }), { kind: 'secondary', onClick: () => io.save(vault.fileName, vault.html, 'text/html') })))));
    // the seal moment: pressed once per letter (nothing under prefers-reduced-motion)
    for (const { el } of seals) press(el, io.motion);
    parts.push(h('div', { class: 'dms-actions' },
      button(t('seal.download_zip'), { kind: 'secondary', onClick: () => io.save(s.zipName(), s.zip(), 'application/zip') }),
      button(t('seal.calendar'), { kind: 'quiet', onClick: () => io.save(s.icsName(), s.ics(getLanguage()), 'text/calendar') })));
    parts.push(h('p', { class: 'dms-soft' }, t('seal.secret_note')));
    parts.push(ownerCodeBlock(v));
    parts.push(archiveBlock(v));
    parts.push(h('section', { class: 'dms-paper-list' }, h('h2', { class: 'dms-sheet__subtitle' }, t('paper.title')), h('p', { class: 'dms-soft' }, t('paper.note')),
      h('div', { class: 'dms-actions' }, ...s.recipients.map((r) =>
        button(t('paper.print', { name: r.name.trim() }), { kind: 'quiet', onClick: () => io.print(t('paper.title'), paperBackup(s, r)) })))));
    parts.push(checkbox(t('seal.saved_checkbox'), s.saved, (c) => { s.saved = c; next.disabled = !c; }, { 'data-k': 'saved', class: 'dms-seal__saved' }));
  }
  return sheet({ title: t('seal.title'), level: 1, class: 'dms-write__sheet dms-seal-step' }, ...parts, actions(null, next));
}

function ownerCodeBlock(v: StepView): HTMLElement | null {
  const s = v.s;
  const code = s.ownerCode();
  if (!code) return null;
  const box = h('div', { class: 'dms-owner-code' });
  const reveal = (): void => {
    box.replaceChildren(
      h('code', { class: 'dms-owner-code__value dms-mono' }, code),
      h('div', { class: 'dms-actions' },
        button(t('action.copy'), { kind: 'secondary', onClick: () => { void v.app.io.copy(code).then((ok) => { if (ok) toast(t('action.copied'), { kind: 'ok' }); }); } }),
        button(t('owner_code.print'), { kind: 'quiet', onClick: () => v.app.io.print(t('owner_code.title'),
          h('article', {}, h('h1', {}, t('owner_code.title')), h('p', {}, t('owner_code.note')), h('p', {}, h('code', {}, code)))) })));
  };
  if (s.ownerCodeVisible(v.screen)) reveal();
  else {
    const show = button(t('owner_code.show'), { kind: 'secondary', onClick: reveal });
    show.classList.add('dms-owner-code__show');
    box.replaceChildren(h('p', { class: 'dms-soft' }, t('owner_code.stored')), show);
  }
  return h('section', { class: 'dms-owner-code-block' }, h('h2', { class: 'dms-sheet__subtitle' }, t('owner_code.title')),
    h('p', {}, t('owner_code.note')), h('p', { class: 'dms-soft' }, t('owner_code.once')), box);
}

function archiveBlock(v: StepView): HTMLElement {
  const s = v.s;
  const parts: (HTMLElement | null)[] = [h('p', {}, t('archive.intro'))];
  if (s.archivePassphrase !== null) {
    parts.push(note(t('archive.saved'), 'ok'));
  } else if (!s.created?.K) {
    parts.push(note(t('archive.unavailable')));
  } else {
    const pass = input({ type: 'password', autocomplete: 'new-password', 'data-k': 'archive-pass' });
    const strength = h('p', { class: 'dms-field__hint', 'aria-live': 'polite' }, t('archive.strength', { level: 0 }));
    const create = button(t('archive.create'), { kind: 'secondary', disabled: true, onClick: () => {
      create.disabled = true;
      void s.archive(pass.value).then((bytes) => { v.app.io.save(s.archiveName(), bytes, 'application/json'); s.changed(); },
        (e: unknown) => { toast(t('error.generic', { message: (e as Error).message }), { kind: 'error' }); create.disabled = false; });
    } });
    pass.addEventListener('input', () => {
      const strong = WriteSession.archiveStrong(pass.value);
      strength.textContent = t('archive.strength', { level: passphraseStrength(pass.value) });
      create.disabled = !strong;
    });
    parts.push(note(t('archive.warning'), 'warn'), field({ label: t('archive.passphrase'), hint: t('archive.passphrase_note'), control: pass }).el, strength,
      h('div', { class: 'dms-actions' }, create));
  }
  return h('details', { class: 'dms-advanced dms-archive' }, h('summary', {}, t('archive.title')), ...parts);
}

// ---- hand over -----------------------------------------------------------------------------------------------------

export function guideList(place: PlaceId): HTMLElement {
  return h('ol', { class: 'dms-guide__steps' }, ...guideSteps(place, getLanguage()).map((step) => h('li', {}, step)));
}

export function handoverStep(v: StepView): HTMLElement {
  const s = v.s;
  const io = v.app.io;
  const parts: (HTMLElement | null)[] = [h('p', {}, t('handover.p1')), h('p', {}, t('handover.p2')),
    note(t('handover.open_link_note')), h('p', { class: 'dms-soft' }, t('guide.fact_years'))];
  const cards = (s.vaults ?? []).map((vault) => {
    const r = s.recipients.find((x) => x.index === vault.index)!;
    const placeSel = select([{ value: '', label: t('handover.where_choose') }, ...PLACES.map((p) => ({ value: p, label: placeName(p, getLanguage()) }))], r.place ?? '');
    placeSel.setAttribute('data-k', `r${r.index}:place`);
    placeSel.addEventListener('change', () => { r.place = isPlace(placeSel.value) ? placeSel.value : null; s.changed(); });
    const link = input({ type: 'url', inputmode: 'url', 'data-k': `r${r.index}:link`, maxlength: 2048, placeholder: 'https://', disabled: s.handedOver });
    link.value = r.link;
    const linkField = field({ label: t('handover.link_label', { name: vault.name }), hint: t('handover.link_note'), control: link });
    link.addEventListener('input', () => { r.link = link.value; });
    link.addEventListener('blur', () => linkField.setError(s.linkError(r) ? t('handover.link_invalid') : null));
    return h('article', { class: 'dms-handover', 'data-recipient': r.index },
      h('h2', { class: 'dms-sheet__subtitle' }, t('handover.for', { name: vault.name })),
      h('div', { class: 'dms-actions' }, button(t('seal.download_one', { name: vault.name }), { kind: 'secondary', onClick: () => io.save(vault.fileName, vault.html, 'text/html') }),
        button(t('paper.print', { name: vault.name }), { kind: 'quiet', onClick: () => io.print(t('paper.title'), paperBackup(s, r)) })),
      field({ label: t('handover.where_label'), control: placeSel }).el,
      r.place ? h('div', { class: 'dms-guide' }, guideList(r.place), h('p', {}, h('a', { href: `#/guide/${r.place}` }, t('handover.guide_link')))) : null,
      linkField.el);
  });
  parts.push(...cards);
  let primary: HTMLElement | null = null;
  if (s.handoverError) parts.push(note(t('handover.failed', { message: s.handoverError }), 'error'));
  if (!s.handedOver) {
    primary = button(t(s.messengerOn && s.created?.claimed ? 'handover.send' : 'handover.finish'), { kind: 'primary', onClick: () => {
      for (const r of s.recipients) if (s.linkError(r)) { toast(t('handover.link_invalid'), { kind: 'error' }); return; }
      (primary as HTMLButtonElement).disabled = true;
      void s.handover();
    } });
  } else {
    parts.push(note(t(s.created?.claimed && s.messengerOn ? 'handover.sent' : 'handover.finished'), 'ok'), h('p', {}, t('handover.p3')));
    if (s.archivePassphrase !== null && s.created?.K) {
      parts.push(h('div', { class: 'dms-actions' }, button(t('archive.download_updated'), { kind: 'secondary', onClick: () => {
        void s.archive(s.archivePassphrase!).then((bytes) => io.save(s.archiveName(), bytes, 'application/json'));
      } })));
    }
    primary = linkButton(t('handover.done'), '#/mine', { kind: 'primary' });
  }
  return sheet({ title: t('handover.title'), level: 1, class: 'dms-write__sheet' }, ...parts, actions(null, primary));
}
