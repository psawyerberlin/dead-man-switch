// `#/privacy` (SPEC.md §7): what stays in the browser, what the messenger stores and for how long, how to delete it,
// what the operator receives and cannot do, and the operator's contact (`operator_contact` of the configuration).
import { t } from '../../core/i18n';
import { sheet } from '../components/sheet';
import { h } from '../dom';

export const PRIVACY_SECTIONS = ['browser', 'messenger', 'retention', 'delete', 'operator', 'none'] as const;

export function privacyScreen(contact: string | null): HTMLElement {
  const safe = contact && /^(https:\/\/|mailto:)/i.test(contact) ? contact : null;
  return h('div', { class: 'dms-screen dms-privacy' },
    sheet({ title: t('privacy.title'), level: 1 },
      h('p', { class: 'dms-lead' }, t('privacy.intro')),
      ...PRIVACY_SECTIONS.flatMap((k) => [h('h2', { class: 'dms-sheet__subtitle' }, t(`privacy.${k}.title`)), h('p', { 'data-privacy': k }, t(`privacy.${k}.text`))]),
      h('h2', { class: 'dms-sheet__subtitle' }, t('privacy.contact.title')),
      h('p', { 'data-privacy': 'contact' }, t('privacy.contact.text'), ' ',
        safe ? h('a', { href: safe, rel: 'noopener noreferrer' }, safe.replace(/^mailto:/i, '')) : h('span', {}, contact ?? '—'))));
}
