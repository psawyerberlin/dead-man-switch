// The fire drill's term (SPEC.md §3.4), in place of the rhythm step: presets 30 min … 48 h and a custom term in
// minutes within `drillBounds`; both dates of `drillOpensAt` (deadline + 24 h grace, plus at most one guardian check).
import { drillOpensAt } from '../../core/drill';
import { formatDate, formatDuration, t } from '../../core/i18n';
import { button, linkButton } from '../components/button';
import { field, input } from '../components/field';
import { sheet } from '../components/sheet';
import { h } from '../dom';
import { actions, note, radioGroup } from './controls';
import type { StepView } from './view';

export function drillTermStep(v: StepView): HTMLElement {
  const s = v.s;
  const b = s.drillBounds();
  if (!b) {
    return sheet({ title: t('drill.title'), level: 1, class: 'dms-write__sheet' }, note(t('drill.unavailable'), 'warn', { 'data-drill': 'unavailable' }),
      actions(linkButton(t('nav.home'), '#/', { kind: 'quiet' })));
  }
  const term = s.termSeconds();
  const isPreset = !s.drillCustom && b.presets.includes(term);
  const minutes = input({ type: 'number', min: b.minSeconds / 60, max: b.maxSeconds / 60, step: 1, 'data-k': 'drill-minutes', inputmode: 'numeric' });
  minutes.value = String(Math.round(term / 60));
  const next = button(t('action.next'), { kind: 'primary', onClick: () => v.go('guardians') });
  const dates = h('p', { class: 'dms-consequence', 'aria-live': 'polite', 'data-drill': 'dates' });
  const custom = field({ label: t('drill.custom_minutes'), hint: t('drill.custom_hint', { min: formatDuration(b.minSeconds), max: formatDuration(b.maxSeconds) }), control: minutes });
  const refresh = (): void => {
    const deadline = s.deadlineFrom();
    const opens = drillOpensAt(deadline, b.heartbeatBlocks, s.quote()?.blockSeconds);
    dates.textContent = `${t('drill.deadline_at', { deadline: formatDate(deadline) })} ${t('drill.opens_between', { earliest: formatDate(opens.earliest), latest: formatDate(opens.latest) })}`;
  };
  minutes.addEventListener('input', () => {
    const m = Number(minutes.value);
    const ok = Number.isInteger(m) && s.drillTermAllowed(m * 60);
    custom.setError(ok ? null : t('drill.term_invalid', { min: formatDuration(b.minSeconds), max: formatDuration(b.maxSeconds) }));
    next.disabled = !ok;
    if (ok) { s.rhythm = { kind: 'minutes', minutes: m }; refresh(); }
  });
  const choices = [...b.presets.map((p) => ({ value: String(p), label: formatDuration(p) })), { value: 'custom', label: t('drill.custom') }];
  const group = radioGroup<string>(t('drill.term_label'), 'drill-term', choices, isPreset ? String(term) : 'custom', (val) => {
    s.drillCustom = val === 'custom';
    if (val !== 'custom') s.setDrillTerm(Number(val));
    else if (!s.setDrillTerm(Math.max(b.minSeconds, Math.min(b.maxSeconds, (Number(minutes.value) || 60) * 60)))) s.changed();
  }, { custom: isPreset ? null : custom.el });
  refresh();
  return sheet({ title: t('drill.term_title'), level: 1, class: 'dms-write__sheet' },
    h('p', {}, t('drill.intro')), group, dates,
    h('p', { class: 'dms-soft' }, t('drill.check_interval', { duration: formatDuration(b.heartbeatBlocks * (s.quote()?.blockSeconds ?? 10.8)) })),
    actions(linkButton(t('action.back'), v.href('recipients'), { kind: 'quiet' }), next));
}
