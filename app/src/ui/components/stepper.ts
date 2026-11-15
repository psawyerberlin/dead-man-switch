// The Write stepper (SPEC.md §8): the letter on its way in seven steps, each with its own line icon. The current
// step carries aria-current="step"; a visually hidden live line announces "Step n of 7: name".
import { t } from '../../core/i18n';
import { h } from '../dom';
import { icon, type IconName } from './icons';

export type StepId = 'letters' | 'recipients' | 'rhythm' | 'guardians' | 'price' | 'seal' | 'handover';

export const STEPS: readonly { id: StepId; icon: IconName }[] = [
  { id: 'letters', icon: 'pen' },
  { id: 'recipients', icon: 'people' },
  { id: 'rhythm', icon: 'calendar' },
  { id: 'guardians', icon: 'shield' },
  { id: 'price', icon: 'coin' },
  { id: 'seal', icon: 'seal' },
  { id: 'handover', icon: 'hand' },
];

/** Route step (`#/write/<step>`) → stepper step. `create` happens after the price is accepted and is shown as the seal step. */
export function stepOf(route: string): StepId {
  if (route === 'create') return 'seal';
  return STEPS.find((s) => s.id === route)?.id ?? 'letters';
}

export interface StepperOptions {
  current: StepId;
  /** href for a step the owner may go back to (done steps only); null = not a link */
  hrefFor?: (id: StepId) => string | null;
}

export function stepper(opts: StepperOptions): HTMLElement {
  const index = STEPS.findIndex((s) => s.id === opts.current);
  const items = STEPS.map((step, i) => {
    const state = i < index ? 'done' : i === index ? 'current' : 'upcoming';
    const name = t(`step.${step.id}`);
    const body = [h('span', { class: 'dms-stepper__icon' }, icon(i < index ? 'check' : step.icon, 20)), h('span', { class: 'dms-stepper__name' }, name)];
    const href = state === 'done' ? opts.hrefFor?.(step.id) ?? null : null;
    const inner = href ? h('a', { href, class: 'dms-stepper__link' }, ...body) : h('span', { class: 'dms-stepper__link' }, ...body);
    if (state === 'done') inner.append(h('span', { class: 'dms-visually-hidden' }, ` (${t('stepper.done')})`));
    return h('li', { class: `dms-stepper__step is-${state}`, 'data-step': step.id, 'aria-current': state === 'current' ? 'step' : undefined }, inner);
  });
  return h('nav', { class: 'dms-stepper', 'aria-label': t('stepper.label') },
    h('ol', { class: 'dms-stepper__list' }, ...items),
    h('p', { class: 'dms-visually-hidden', 'aria-live': 'polite' },
      t('stepper.status', { n: String(index + 1), total: String(STEPS.length), name: t(`step.${opts.current}`) })));
}
