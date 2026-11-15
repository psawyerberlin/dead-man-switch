// One switch in My switches (SPEC.md §3.2, §8): an envelope with the countdown ring as its stamp, the health in plain
// words, the timeline, the recipients and the owner's buttons. Cancel is one button and one dialog.
import { formatCkb, formatDate, formatDuration, t } from '../../core/i18n';
import { GRACE_SECONDS, rhythmSeconds } from '../../core/rhythm';
import type { SavedSwitch } from '../../core/switches';
import { button, linkButton } from '../components/button';
import { confirmDialog } from '../components/dialog';
import { icon } from '../components/icons';
import { ring, type RingState } from '../components/ring';
import { sheet } from '../components/sheet';
import { h } from '../dom';
import { note } from '../write/controls';
import { archiveDialog, awayDialog, changeGuardiansDialog, settingsDialog } from './dialogs';
import { type MineService, recipientState } from './service';
import type { MineApp } from './view';

const short = (T: string): string => `${T.slice(0, 10)}…${T.slice(-4)}`;
/** The ten minutes of SPEC.md §6: the chain's median time is labelled when it differs from the wall clock. */
const CHAIN_TIME_LABEL_SECONDS = 600;

/** The ring of a switch: time left in the current rhythm, amber in the last 10 %, red during the grace. */
export function switchRing(svc: MineService, sw: SavedSwitch): HTMLElement | SVGElement {
  const deadline = svc.deadline(sw);
  const card = svc.card(sw);
  const state = card.summary?.state;
  if (deadline === null) return ring({ fraction: 0, value: '—', caption: t('mine.ring_unknown'), state: 'done' }).el;
  const now = svc.chainNow(sw);
  const left = deadline - now;
  if (state === 'released' || state === 'cancelled') {
    return ring({ fraction: 0, value: t(`mine.state.${state}`), caption: formatDate(deadline, undefined, { time: false }), state: 'done' }).el;
  }
  if (left <= 0) {
    return ring({ fraction: Math.max(0, (left + GRACE_SECONDS) / GRACE_SECONDS), value: formatDuration(left + GRACE_SECONDS), caption: t('mine.ring_grace'), state: 'grace' }).el;
  }
  const lastStart = card.history?.length ? card.history[card.history.length - 1]!.timestamp : sw.created_at;
  const r = svc.rhythmOf(sw);
  const term = lastStart && lastStart < deadline ? deadline - lastStart : r ? rhythmSeconds(now, r) : left;
  const fraction = Math.min(1, left / Math.max(1, term));
  const ringState: RingState = fraction <= 0.1 ? 'warn' : 'ok';
  const rg = ring({ fraction: card.refilled ? 0 : fraction, value: formatDuration(left), caption: t('mine.ring_caption'), state: ringState });
  if (card.refilled) { card.refilled = false; queueMicrotask(() => rg.update({ fraction })); rg.el.classList.add('is-refilling'); }
  return rg.el;
}

function health(svc: MineService, sw: SavedSwitch): HTMLElement | null {
  const hr = svc.card(sw).summary?.headroom;
  if (!hr) return null;
  return h('div', { class: 'dms-card__health', 'data-health': '' },
    h('p', {}, icon(hr.threshold > 0 ? 'shield' : 'check', 18), ' ', t('mine.headroom_sentence', { count: Math.max(0, hr.threshold) })),
    hr.mandatory !== null ? h('p', {}, t('mine.mandatory_headroom', { count: Math.max(0, hr.mandatory) })) : null);
}

function timeline(svc: MineService, sw: SavedSwitch): HTMLElement {
  const entries = svc.timeline(sw);
  return h('section', { class: 'dms-card__timeline', 'aria-label': t('timeline.title') },
    h('h3', { class: 'dms-card__subtitle' }, t('timeline.title')),
    entries.length === 0 ? h('p', { class: 'dms-soft' }, t('timeline.empty')) :
      h('ol', { class: 'dms-timeline' }, ...entries.map((e) => h('li', { class: `dms-timeline__item is-${e.kind}`, 'data-kind': e.kind },
        h('span', { class: 'dms-timeline__when' }, e.at ? formatDate(e.at) : '—'), ' ',
        h('span', {}, t(e.key, { kind: e.detail ?? '' }))))));
}

const STATE_ICON: Record<string, string> = { confirmed: '✓', waiting: '…', not_asked: '–', stopped: '×' };

function recipients(svc: MineService, sw: SavedSwitch): HTMLElement | null {
  const view = svc.card(sw).messenger;
  const list = view?.record?.recipients?.map((r) => ({ index: r.index, name: r.name, language: r.language, link: r.link !== null && r.link !== undefined, known: true }))
    ?? sw.recipients?.map((r) => ({ ...r, link: false, known: false })) ?? [];
  if (list.length === 0) return null;
  return h('section', { class: 'dms-card__recipients' }, h('h3', { class: 'dms-card__subtitle' }, t('recipients.title')),
    h('ul', { class: 'dms-card__people' }, ...list.map((r) => {
      const conf = view?.confirmations?.find((c) => c.role === 'recipient' && c.index === r.index);
      const st = recipientState(conf);
      return h('li', { 'data-recipient': r.index, 'data-state': view ? st : 'unknown' },
        h('span', { class: 'dms-card__person' }, r.name), ' ',
        h('span', { class: 'dms-tag' }, r.language.toUpperCase()), ' ',
        view ? h('span', { class: `dms-card__state is-${st}` }, h('span', { 'aria-hidden': 'true' }, STATE_ICON[st] ?? ''), ' ', t(`mine.recipient.${st}`)) : null, ' ',
        r.known ? h('span', { class: 'dms-soft' }, t(r.link ? 'mine.link_set' : 'mine.link_unset')) : null);
    })));
}

/** One card. `onCancelled` etc. are reported through the service's change event. */
export function switchCard(app: MineApp, sw: SavedSwitch): HTMLElement {
  const svc = app.service;
  const c = svc.card(sw);
  if (!c.summary && !c.error && c.busy === null) void svc.refresh(sw);
  const state = c.summary?.state ?? null;
  const deadline = svc.deadline(sw);
  const live = state === null || state === 'armed' || state === 'committed' || state === 'pending';
  const busy = c.busy !== null && c.busy !== 'refresh';
  const parent = (): HTMLElement => app.dialogParent?.() ?? document.body;

  const checkin = button(t('mine.checkin'), { kind: 'primary', class: 'dms-card__action', disabled: !live || busy,
    onClick: () => { void svc.checkin(sw); } });
  checkin.setAttribute('data-action', 'checkin');
  checkin.setAttribute('data-k', `${sw.T}:checkin`);
  const away = button(t('away.title'), { kind: 'secondary', class: 'dms-card__action', disabled: !live || busy, onClick: () => awayDialog(app, sw, parent()) });
  away.setAttribute('data-action', 'away');
  const settings = button(t('messenger.settings'), { kind: 'secondary', class: 'dms-card__action', disabled: busy || sw.messenger === false,
    onClick: () => settingsDialog(app, sw, parent()) });
  settings.setAttribute('data-action', 'settings');
  const change = button(t('mine.change_guardians'), { kind: 'secondary', class: 'dms-card__action', disabled: !live || busy,
    onClick: () => changeGuardiansDialog(app, sw, parent()) });
  change.setAttribute('data-action', 'change');
  const cancel = button(t('mine.cancel'), { kind: 'danger', class: 'dms-card__action', disabled: !live || busy,
    onClick: () => {
      const confirm = button(t('cancel.confirm'), { kind: 'danger', class: 'dms-card__action' });
      confirm.setAttribute('data-action', 'cancel-confirm');
      const keep = button(t('cancel.keep'), { kind: 'secondary', class: 'dms-card__action' });
      void confirmDialog({ title: t('cancel.title'), body: [h('p', { 'data-consequence': '' }, t('cancel.consequence')), h('p', { class: 'dms-soft' }, t('cancel.no_fee'))],
        confirm, keep }).then((yes) => { if (yes) void svc.cancel(sw); });
    } });
  cancel.setAttribute('data-action', 'cancel');
  const reclaim = state === 'released' || state === 'cancelled'
    ? button(t('mine.reclaim'), { kind: 'secondary', class: 'dms-card__action', disabled: busy, onClick: () => { void svc.reclaim(sw); } }) : null;
  reclaim?.setAttribute('data-action', 'reclaim');

  // Download the vaults again: from this page's Write session, or rebuilt from the owner archive.
  const session = app.sessions?.().find((x) => x.created?.T === sw.T.toLowerCase() && x.created.network === sw.network && x.vaults);
  const archive = svc.archiveOf(sw);
  const download = button(t('mine.download_vault'), { kind: 'quiet', class: 'dms-card__action', onClick: () => {
    if (session?.vaults) { for (const v of session.vaults) app.io.save(v.fileName, v.html, 'text/html'); return; }
    if (archive) {
      void svc.rebuildVaults(sw).then((vs) => { for (const v of vs) app.io.save(v.fileName, v.html, 'text/html'); },
        (e: unknown) => { svc.card(sw).error = (e as Error).message; svc.changed(); });
      return;
    }
    archiveDialog(app, sw, parent());
  } });
  download.setAttribute('data-action', 'download');

  const overlap = live && deadline !== null ? svc.overlapDays(sw) : 0;
  const next = svc.nextDeadline(sw);
  const est = next !== null ? svc.checkinQuote(sw, next) : null;
  const chainNow = svc.chainNow(sw);
  const chainLabel = Math.abs(chainNow - svc.now()) > CHAIN_TIME_LABEL_SECONDS ? t('mine.chain_time') : t('mine.local_time');

  const title = sw.sender_label ? t('mine.card_title', { sender: sw.sender_label }) : t('mine.card_untitled');
  return sheet({ title, level: 2, tag: 'article', class: `dms-card${sw.drill ? ' dms-card--drill' : ''}` },
    h('p', { class: 'dms-card__id' }, h('code', { title: sw.T }, short(sw.T)), ' ',
      h('span', { class: 'dms-tag' }, t(`app.network.${sw.network}`)),
      sw.drill ? h('span', { class: 'dms-tag dms-tag--warn' }, t('nav.drill')) : null,
      state ? h('span', { class: 'dms-tag', 'data-state': state }, t(`mine.state.${state === 'released' || state === 'cancelled' ? state : 'live'}`)) : null),
    h('div', { class: 'dms-card__head' },
      h('div', { class: 'dms-card__stamp' }, switchRing(svc, sw)),
      h('div', { class: 'dms-card__facts' },
        deadline !== null && live ? h('p', { class: 'dms-card__opens' }, t('mine.opens_in', { duration: formatDuration(Math.max(0, deadline - chainNow)) })) : null,
        deadline !== null ? h('p', { class: 'dms-soft' }, t('mine.deadline_at', { deadline: formatDate(deadline), chain_time: chainLabel })) : null,
        health(svc, sw))),
    c.busy === 'refresh' && !c.summary ? note(t('open.reading')) : null,
    c.error ? note(t('mine.error', { message: c.error }), 'error') : null,
    c.done ? note(t(c.done.key, { ...c.done.params, deadline: c.done.params?.deadline ? formatDate(Number(c.done.params.deadline)) : '' }), 'ok', { role: 'status' }) : null,
    c.busy === 'checkin' || c.busy === 'cancel' || c.busy === 'reclaim' ? note(t('mine.signing'), 'soft', { role: 'status' }) : null,
    timeline(svc, sw),
    recipients(svc, sw),
    c.messengerError ? note(t('mine.messenger_error', { message: c.messengerError }), 'warn') : null,
    live && next !== null ? h('p', { class: 'dms-soft dms-card__checkin-note' }, t('mine.checkin_note', { deadline: formatDate(next) }),
      est ? ` ${t('mine.checkin_cost', { amount: formatCkb(est.spentOverTerm) })}` : '') : null,
    live && overlap > 0 ? h('p', { class: 'dms-soft', 'data-overlap': overlap }, t('mine.checkin_overlap', { days: overlap })) : null,
    h('div', { class: 'dms-actions dms-card__actions' }, checkin, away, settings, change, cancel, reclaim, download),
    sw.drill ? h('p', {}, linkButton(t('drill.report_title'), `#/drill/report?T=${sw.T}`, { kind: 'quiet' })) : null,
    h('details', { class: 'dms-advanced' }, h('summary', {}, t('mine.details')),
      h('dl', { class: 'dms-card__details' },
        h('dt', {}, 'T'), h('dd', {}, h('code', {}, sw.T)),
        sw.I ? h('dt', {}, 'I') : null, sw.I ? h('dd', {}, h('code', {}, sw.I)) : null,
        sw.descriptor_hash ? h('dt', {}, t('mine.descriptor_hash')) : null, sw.descriptor_hash ? h('dd', {}, h('code', {}, sw.descriptor_hash)) : null),
      h('div', { class: 'dms-actions' }, button(t('mine.forget'), { kind: 'quiet', onClick: () => svc.forget(sw) }))));
}
