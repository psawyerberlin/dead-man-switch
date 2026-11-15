// `#/guide` and `#/guide/<place>`: the handover tutorials of SPEC.md §3.3.2 for the ten places, in the UI language.
import { getLanguage, t } from '../../core/i18n';
import { guideSteps, isPlace, PLACES, placeName } from '../../core/places';
import { linkButton } from '../components/button';
import { sheet } from '../components/sheet';
import { h } from '../dom';
import { notFoundScreen } from './placeholder';

function facts(): HTMLElement {
  return h('section', { class: 'dms-guide__facts' }, h('h2', { class: 'dms-sheet__subtitle' }, t('guide.facts_title')),
    h('ul', {}, h('li', {}, t('guide.fact_closed')), h('li', {}, t('handover.open_link_note')), h('li', {}, t('guide.fact_years'))));
}

export function guideScreen(place: string | null): HTMLElement {
  const lang = getLanguage();
  if (place === null) {
    return h('div', { class: 'dms-screen dms-guide-screen' }, sheet({ title: t('guide.title'), level: 1 },
      h('p', {}, t('guide.intro')),
      h('ul', { class: 'dms-guide__places' }, ...PLACES.map((p) => h('li', {}, h('a', { href: `#/guide/${p}` }, placeName(p, lang))))),
      facts()));
  }
  if (!isPlace(place)) return notFoundScreen();
  return h('div', { class: 'dms-screen dms-guide-screen' }, sheet({ title: placeName(place, lang), level: 1 },
    h('p', { class: 'dms-soft' }, t('guide.covers')),
    h('ol', { class: 'dms-guide__steps' }, ...guideSteps(place, lang).map((s) => h('li', {}, s))),
    facts(),
    h('div', { class: 'dms-actions' }, linkButton(t('guide.all'), '#/guide', { kind: 'quiet' }), linkButton(t('guide.back_to_write'), '#/write/handover', { kind: 'quiet' }))));
}
