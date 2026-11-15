// The drill ribbon (SPEC.md §3.4, §8): on every fire-drill screen, in `--warn`, with text (never colour alone).
import { t } from '../../core/i18n';
import { h } from '../dom';

export function ribbon(): HTMLElement {
  return h('div', { class: 'dms-ribbon', role: 'note' }, h('span', { class: 'dms-ribbon__text' }, t('drill.ribbon')));
}
