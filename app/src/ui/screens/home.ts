// Home `#/`: one sentence of what the app does, three entries (write, my switches, fire drill on testnet) and,
// for recipients, the way to open a vault and the practice vault.
import { t } from '../../core/i18n';
import type { Network } from '../../core/config';
import { linkButton } from '../components/button';
import { sheet } from '../components/sheet';
import { h } from '../dom';
import { calendar, envelope, letter } from '../illustrations';

function entry(title: string, note: string, href: string, art: SVGElement, primary = false): HTMLElement {
  return h('li', { class: 'dms-entry' },
    h('a', { href, class: `dms-entry__link${primary ? ' is-primary' : ''}` },
      h('span', { class: 'dms-entry__art' }, art),
      h('span', { class: 'dms-entry__title' }, title),
      h('span', { class: 'dms-entry__note' }, note)));
}

export function homeScreen(network: Network): HTMLElement {
  const entries = [
    entry(t('nav.write'), t('home.write_note'), '#/write', letter(), true),
    entry(t('nav.mine'), t('home.mine_note'), '#/mine', calendar()),
    network === 'testnet' ? entry(t('drill.title'), t('home.drill_note'), '#/drill', envelope()) : null,
  ].filter((e): e is HTMLElement => e !== null);
  return h('div', { class: 'dms-screen dms-home' },
    h('div', { class: 'dms-home__intro' },
      h('h1', { class: 'dms-home__title' }, t('app.tagline')),
      h('p', { class: 'dms-lead' }, t('home.lead'))),
    h('ul', { class: 'dms-entries' }, ...entries),
    sheet({ title: t('home.recipient_title'), class: 'dms-home__recipient' },
      h('p', {}, t('home.recipient_note')),
      h('div', { class: 'dms-actions' },
        linkButton(t('nav.open'), '#/open', { kind: 'secondary' }),
        linkButton(t('open.practice_link'), '#/open/demo', { kind: 'quiet' }))));
}
