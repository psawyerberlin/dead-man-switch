// The fire drill (SPEC.md §3.4): `#/drill` (what it is, then the Write flow at `#/drill/<step>`) and
// `#/drill/report?T=` (the timeline of what happened and the checklist for a real switch). Testnet only; the drill
// ribbon is on every drill screen.
import { formatDate, t } from '../../core/i18n';
import { type SavedSwitch, normaliseSwitchId } from '../../core/switches';
import { linkButton } from '../components/button';
import { ribbon } from '../components/ribbon';
import { sheet } from '../components/sheet';
import { h, mount } from '../dom';
import { envelope } from '../illustrations';
import { live, type MineApp } from '../mine/view';
import { note } from '../write/controls';

export const DRILL_CHECKS = ['check1', 'check2', 'check3', 'check4', 'check5'] as const;

/** On mainnet (or without a drill configuration) there is no drill: the screen says so and offers nothing. */
export function drillUnavailable(): HTMLElement {
  return h('div', { class: 'dms-screen dms-drill' }, sheet({ title: t('drill.title'), level: 1 },
    note(t('drill.unavailable'), 'warn', { 'data-drill': 'unavailable' }),
    h('div', { class: 'dms-actions' }, linkButton(t('nav.home'), '#/', { kind: 'secondary' }))));
}

export function drillIntro(available: boolean): HTMLElement {
  if (!available) return drillUnavailable();
  return h('div', { class: 'dms-screen dms-drill' }, ribbon(),
    sheet({ title: t('drill.title'), level: 1 },
      h('div', { class: 'dms-drill__art' }, envelope()),
      h('p', { class: 'dms-lead' }, t('drill.intro')),
      h('ul', {}, h('li', {}, t('drill.point_term')), h('li', {}, t('drill.point_marked')), h('li', {}, t('drill.point_confirm')), h('li', {}, t('drill.point_report'))),
      h('div', { class: 'dms-actions' }, linkButton(t('drill.start'), '#/drill/letters', { kind: 'primary' }), linkButton(t('nav.mine'), '#/mine', { kind: 'quiet' }))));
}

export function drillReport(query: URLSearchParams, app: MineApp, available: boolean): HTMLElement {
  if (!available) return drillUnavailable();
  const root = h('div', { class: 'dms-screen dms-drill dms-drill-report' });
  let T: string | null = null;
  try { T = normaliseSwitchId(query.get('T') ?? ''); } catch { T = null; }
  const network = app.network();
  const svc = app.service;
  const drills = svc.list(network).filter((s) => s.drill);
  const sw: SavedSwitch | null = T ? svc.get(network, T) ?? { network, T, drill: true } : null;
  return live(root, svc, () => {
    if (!sw) {
      mount(root, ribbon(), sheet({ title: t('drill.report_title'), level: 1 },
        drills.length ? h('ul', {}, ...drills.map((d) => h('li', {}, h('a', { href: `#/drill/report?T=${d.T}` }, d.sender_label || d.T.slice(0, 10)))))
          : note(t('drill.report_none')),
        h('div', { class: 'dms-actions' }, linkButton(t('drill.start'), '#/drill', { kind: 'secondary' }))));
      return;
    }
    const c = svc.card(sw);
    if (!c.summary && !c.error && c.busy === null) void svc.refresh(sw);
    const entries = svc.timeline(sw);
    mount(root, ribbon(), sheet({ title: t('drill.report_title'), level: 1 },
      h('p', {}, h('code', {}, sw.T)),
      c.error ? note(t('mine.error', { message: c.error }), 'error') : null,
      c.summary ? h('p', { 'data-state': c.summary.state }, t(`drill.state.${c.summary.state}`)) : null,
      h('h2', { class: 'dms-sheet__subtitle' }, t('timeline.title')),
      entries.length ? h('ol', { class: 'dms-timeline', 'data-report': 'timeline' }, ...entries.map((e) => h('li', { class: `dms-timeline__item is-${e.kind}` },
        h('span', { class: 'dms-timeline__when' }, e.at ? formatDate(e.at) : '—'), ' ', t(e.key, { kind: e.detail ?? '' }))))
        : note(t('timeline.empty')),
      svc.ownerCode(sw) ? null : note(t('drill.report_needs_code')),
      h('h2', { class: 'dms-sheet__subtitle' }, t('drill.checklist_title')),
      h('ul', { class: 'dms-checklist', 'data-report': 'checklist' }, ...DRILL_CHECKS.map((k) => {
        const id = `drill-${k}`;
        return h('li', {}, h('input', { type: 'checkbox', id }), h('label', { for: id }, t(`drill.${k}`)));
      })),
      h('p', { class: 'dms-soft' }, t('drill.retention')),
      h('div', { class: 'dms-actions' }, linkButton(t('nav.write'), '#/write', { kind: 'primary' }), linkButton(t('nav.mine'), '#/mine', { kind: 'quiet' }))));
  });
}
