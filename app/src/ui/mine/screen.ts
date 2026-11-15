// `#/mine` (SPEC.md §3.2): the owner's switches on this device, one card each, "add by T", "restore from owner
// code", and the fire drill entry on testnet.
import { type Network } from '../../core/config';
import { t } from '../../core/i18n';
import { button, linkButton } from '../components/button';
import { field, input } from '../components/field';
import { sheet } from '../components/sheet';
import { h, mount } from '../dom';
import { note } from '../write/controls';
import { switchCard } from './card';
import { live, type MineApp } from './view';

function addById(app: MineApp, network: Network): HTMLElement {
  const T = input({ 'data-k': 'add-T', autocomplete: 'off', spellcheck: 'false', inputmode: 'text' });
  const f = field({ label: t('mine.id_label'), control: T });
  const add = button(t('mine.add_by_id'), { kind: 'secondary', onClick: () => {
    try { app.service.addById(network, T.value); } catch { f.setError(t('mine.id_invalid')); }
  } });
  add.setAttribute('data-action', 'add');
  return h('details', { class: 'dms-advanced', 'data-add': 'id' }, h('summary', {}, t('mine.add_by_id')), f.el, h('div', { class: 'dms-actions' }, add));
}

function restore(app: MineApp): HTMLElement {
  const code = input({ 'data-k': 'restore-code', autocomplete: 'off', spellcheck: 'false' });
  const T = input({ 'data-k': 'restore-T', autocomplete: 'off', spellcheck: 'false' });
  const fc = field({ label: t('owner_code.title'), control: code });
  const ft = field({ label: t('mine.id_label'), hint: t('mine.restore_hint'), control: T });
  const go = button(t('mine.restore'), { kind: 'secondary', onClick: () => {
    fc.setError(null);
    void app.service.restoreFromCode(code.value, T.value).catch((e: unknown) => fc.setError(t('mine.restore_failed', { message: (e as Error).message })));
  } });
  go.setAttribute('data-action', 'restore');
  return h('details', { class: 'dms-advanced', 'data-add': 'code' }, h('summary', {}, t('mine.restore')), fc.el, ft.el, h('div', { class: 'dms-actions' }, go));
}

export function mineScreen(app: MineApp): HTMLElement {
  const root = h('div', { class: 'dms-screen dms-mine' });
  return live(root, app.service, () => {
    const network = app.network();
    const list = app.service.list(network);
    mount(root,
      h('div', { class: 'dms-mine__intro' }, h('h1', {}, t('mine.title')), h('p', { class: 'dms-lead' }, t('mine.lead'))),
      list.length === 0 ? sheet({}, note(t('mine.empty')), h('div', { class: 'dms-actions' }, linkButton(t('nav.write'), '#/write', { kind: 'primary' }))) : null,
      h('div', { class: 'dms-mine__cards' }, ...list.slice().reverse().map((sw) => switchCard(app, sw))),
      sheet({ title: t('mine.more_title'), class: 'dms-mine__more' }, addById(app, network), restore(app),
        app.drillAvailable() ? h('p', { 'data-drill': 'entry' }, linkButton(t('drill.title'), '#/drill', { kind: 'quiet' })) : null));
  });
}
