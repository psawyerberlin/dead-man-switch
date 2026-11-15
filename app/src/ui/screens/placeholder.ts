// The routes whose screens come in later phases: their title, a short note and the way home.
import { t } from '../../core/i18n';
import { linkButton } from '../components/button';
import { ribbon } from '../components/ribbon';
import { sheet } from '../components/sheet';
import { h, type Child } from '../dom';

export function placeholderScreen(titleKey: string, opts: { drill?: boolean; extra?: Child[] } = {}): HTMLElement {
  return h('div', { class: 'dms-screen' }, opts.drill ? ribbon() : null,
    sheet({ title: t(titleKey), level: 1 },
      h('p', { class: 'dms-soft' }, t('shell.coming_soon')),
      ...(opts.extra ?? []),
      h('div', { class: 'dms-actions' }, linkButton(t('nav.home'), '#/', { kind: 'quiet' }))));
}

export function notFoundScreen(): HTMLElement {
  return h('div', { class: 'dms-screen' }, sheet({ title: t('shell.not_found'), level: 1 },
    h('div', { class: 'dms-actions' }, linkButton(t('nav.home'), '#/', { kind: 'primary' }))));
}
