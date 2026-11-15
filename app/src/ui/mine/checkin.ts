// `#/checkin?network=&T=&rhythm=` (SPEC.md §3.2): the one-screen phone page of the reminder emails. The switch
// summary is read from the chain, the new deadline is chain time + rhythm, one large button; the connected wallet
// must be the owner (lock hash = the owner lock hash of the Node Cells), otherwise the page explains.
import type { Network } from '../../core/config';
import { formatDate, formatDuration, t } from '../../core/i18n';
import { type Rhythm, addRhythm, parseRhythmIso, rhythmIso } from '../../core/rhythm';
import { type SavedSwitch, normaliseSwitchId } from '../../core/switches';
import { button, linkButton } from '../components/button';
import { sheet } from '../components/sheet';
import { h, mount } from '../dom';
import { note } from '../write/controls';
import { switchRing } from './card';
import { live, type MineApp } from './view';

export interface CheckinLink { network: Network; T: string; rhythm: Rhythm }

/** Parses the three parameters of the phone link; null when one is missing or malformed. */
export function parseCheckinLink(query: URLSearchParams): CheckinLink | null {
  const network = query.get('network');
  if (network !== 'testnet' && network !== 'mainnet') return null;
  try {
    return { network, T: normaliseSwitchId(query.get('T') ?? ''), rhythm: parseRhythmIso(query.get('rhythm') ?? '') };
  } catch { return null; }
}

export function checkinScreen(query: URLSearchParams, app: MineApp): HTMLElement {
  const link = parseCheckinLink(query);
  const root = h('div', { class: 'dms-screen dms-checkin' });
  if (!link) {
    mount(root, sheet({ title: t('checkin.title'), level: 1 }, note(t('checkin.bad_link'), 'error'),
      h('div', { class: 'dms-actions' }, linkButton(t('nav.mine'), '#/mine', { kind: 'secondary' }))));
    return root;
  }
  const svc = app.service;
  const saved = svc.get(link.network, link.T);
  const sw: SavedSwitch = { ...(saved ?? {}), network: link.network, T: link.T, rhythm: rhythmIso(link.rhythm) };
  let owner: boolean | null | 'pending' = null;
  let ownerFor = '';
  const checkOwner = (): void => {
    if (!app.walletConnected() || owner === 'pending') return;
    const key = `${svc.card(sw).summary?.ownerLockHash ?? ''}`;
    if (ownerFor === key && owner !== null) return;
    owner = 'pending';
    ownerFor = key;
    void svc.isOwner(sw).then((v) => { owner = v; }, () => { owner = null; }).finally(() => svc.changed());
  };
  return live(root, svc, () => {
    const c = svc.card(sw);
    if (!c.summary && !c.error && c.busy === null) void svc.refresh(sw);
    const summary = c.summary;
    const connected = app.walletConnected();
    if (connected && summary) checkOwner();
    if (!connected) { owner = null; ownerFor = ''; }
    const next = summary ? addRhythm(summary.chainTime, link.rhythm) : null;
    const state = summary?.state ?? null;
    const usable = state === 'armed' || state === 'committed';
    let action: HTMLElement;
    if (!connected) {
      action = button(t('checkin.connect'), { kind: 'primary', class: 'dms-checkin__button', onClick: () => { void app.connectWallet?.().then(() => svc.changed()); } });
    } else {
      action = button(next !== null ? t('checkin.button', { deadline: formatDate(next) }) : t('mine.checkin'), {
        kind: 'primary', class: 'dms-checkin__button', disabled: next === null || !usable || owner !== true || (c.busy !== null && c.busy !== 'refresh'),
        onClick: () => { if (next !== null) void svc.checkin(sw, addRhythm(svc.chainNow(sw), link.rhythm)); } });
    }
    action.setAttribute('data-action', 'checkin');
    action.setAttribute('data-k', 'checkin');
    mount(root, sheet({ title: t('checkin.title'), level: 1, class: 'dms-checkin__sheet' },
      sw.sender_label ? h('p', { class: 'dms-lead' }, t('mine.card_title', { sender: sw.sender_label })) : null,
      h('p', { class: 'dms-card__id' }, h('code', {}, `${sw.T.slice(0, 10)}…${sw.T.slice(-4)}`), ' ', h('span', { class: 'dms-tag' }, t(`app.network.${sw.network}`))),
      summary ? h('div', { class: 'dms-checkin__stamp' }, switchRing(svc, sw)) : null,
      !summary && !c.error ? note(t('open.reading'), 'soft', { role: 'status' }) : null,
      c.error ? note(t('mine.error', { message: c.error }), 'error') : null,
      summary?.deadline != null ? h('p', { 'data-current': summary.deadline }, t('mine.deadline_at', { deadline: formatDate(summary.deadline), chain_time: t('mine.chain_time') })) : null,
      next !== null ? h('p', { class: 'dms-consequence', 'data-new-deadline': next }, t('checkin.new_deadline', { deadline: formatDate(next), rhythm: formatRhythm(link.rhythm) })) : null,
      state && !usable ? note(t(state === 'released' || state === 'cancelled' ? `checkin.state.${state}` : 'checkin.state.other'), 'warn') : null,
      owner === false ? note(t('checkin.not_owner'), 'error', { 'data-owner': 'no' }) : null,
      owner === 'pending' ? note(t('checkin.checking_owner'), 'soft', { role: 'status' }) : null,
      c.done ? note(t(c.done.key, { deadline: formatDate(Number(c.done.params?.deadline ?? 0)) }), 'ok', { role: 'status' }) : null,
      h('div', { class: 'dms-actions dms-checkin__actions' }, action),
      h('p', {}, linkButton(t('nav.mine'), '#/mine', { kind: 'quiet' }))));
  });
}

function formatRhythm(r: Rhythm): string {
  if (r.kind === 'months') return t('unit.months', { count: r.months });
  if (r.kind === 'days') return t('unit.days', { count: r.days });
  return formatDuration(r.minutes * 60);
}
