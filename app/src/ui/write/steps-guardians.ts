// Write steps 4–5 (SPEC.md §3.1.5–6): guardians and how closely they watch, with the live cost panel; the price.
import { formatCkb, formatDuration, t } from '../../core/i18n';
import { concentration, runnerName, thresholdRange } from '../../core/guardians';
import type { Quote } from '../../core/price';
import { termMonths } from '../../core/rhythm';
import { button, linkButton } from '../components/button';
import { constellation } from '../components/constellation';
import { field, input, select } from '../components/field';
import { sheet } from '../components/sheet';
import { h } from '../dom';
import { actions, note, radioGroup } from './controls';
import type { StepView } from './view';

const HEARTBEAT_LABELS: Record<number, string> = { 1000: 'heartbeat.option_3h', 4000: 'heartbeat.option_12h', 8000: 'heartbeat.option_daily', 56000: 'heartbeat.option_weekly' };

export function heartbeatLabel(blocks: number, blockSeconds = 10.8): string {
  const key = HEARTBEAT_LABELS[blocks];
  return key ? t(key) : t('heartbeat.option_custom', { blocks, duration: formatDuration(blocks * blockSeconds) });
}

/** The live cost panel: per month first, then what is paid now. */
export function costPanel(q: Quote | null): HTMLElement {
  return h('aside', { class: 'dms-cost', 'aria-live': 'polite', 'aria-label': t('cost.title') },
    h('h2', { class: 'dms-cost__title' }, t('cost.title')),
    q ? h('p', { class: 'dms-cost__monthly dms-mono', 'data-cost': 'monthly' }, t('price.monthly', { amount: formatCkb(q.monthly, undefined, { unit: false }) })) : note(t('app.loading')),
    q ? h('p', { class: 'dms-cost__now', 'data-cost': 'now' }, `${t('price.spent_now')}: `, h('span', { class: 'dms-mono' }, formatCkb(q.spentNow))) : null,
    q ? h('p', { class: 'dms-cost__parked', 'data-cost': 'parked' }, `${t('price.parked')}: `, h('span', { class: 'dms-mono' }, formatCkb(q.parked))) : null);
}

function numberStepper(label: string, key: string, value: number, min: number, max: number, onChange: (n: number) => void): HTMLElement {
  const control = input({ type: 'number', min, max, step: 1, 'data-k': key, inputmode: 'numeric' });
  control.value = String(value);
  control.addEventListener('change', () => {
    const n = Number(control.value);
    if (Number.isInteger(n) && n >= min && n <= max) onChange(n);
    else control.value = String(value);
  });
  const minus = button('−', { kind: 'quiet', label: t('guardians.fewer', { what: label }), disabled: value <= min, onClick: () => onChange(value - 1) });
  const plus = button('+', { kind: 'quiet', label: t('guardians.more', { what: label }), disabled: value >= max, onClick: () => onChange(value + 1) });
  minus.setAttribute('data-k', `${key}:minus`);
  plus.setAttribute('data-k', `${key}:plus`);
  plus.classList.add('dms-stepnum__plus');
  minus.classList.add('dms-stepnum__minus');
  return h('div', { class: 'dms-stepnum', 'data-stepnum': key }, field({ label, control }).el, h('div', { class: 'dms-stepnum__buttons' }, minus, plus));
}

export function guardiansStep(v: StepView): HTMLElement {
  const s = v.s;
  const cfg = s.config;
  const phrase = t('guardians.ack_phrase');
  if (!s.runners && !s.runnersError) void s.loadRunners();
  const next = button(t('action.next'), { kind: 'primary', disabled: !s.guardiansValid(phrase), onClick: () => v.go('price') });
  const back = linkButton(t('action.back'), '#/write/rhythm', { kind: 'quiet' });
  const q = s.quote();
  const blockSeconds = q?.blockSeconds ?? 10.8;
  const body: (HTMLElement | null)[] = [];
  const b = s.bounds();

  if (!s.runners && !s.runnersError) body.push(note(t('guardians.loading')));
  else if (s.runnersError) {
    body.push(note(t('guardians.load_failed', { message: s.runnersError }), 'error'),
      h('div', { class: 'dms-actions' }, button(t('action.retry'), { kind: 'secondary', onClick: () => { s.runnersError = null; void s.loadRunners(); s.changed(); } })));
  } else if (b && cfg) {
    body.push(h('p', { class: 'dms-guardians__count', 'data-available': b.available }, t('guardians.available', { count: b.available })));
    if (!b.enough || s.n === null || s.t === null) {
      body.push(note(t('guardians.too_few', { count: b.available, min: cfg.n_min }), 'error'));
    } else {
      const n = s.n, tt = s.t, m = s.mandatory.length;
      const range = thresholdRange(n, m);
      const chosen = s.chosen();
      const mandatory = new Set(s.mandatory);
      body.push(h('p', {}, t('guardians.intro', { t: tt, n })));
      body.push(h('div', { class: 'dms-guardians__numbers' },
        numberStepper(t('guardians.count_label'), 'n', n, Math.max(b.nMin, m || 1), b.nMax, (x) => s.setN(x)),
        range.min === range.max ? h('p', { class: 'dms-soft' }, t('guardians.threshold_label', { t: tt, n })) :
          numberStepper(t('guardians.threshold_label', { t: tt, n }), 't', tt, range.min, range.max, (x) => s.setT(x))));
      body.push(h('figure', { class: 'dms-guardians__sky' },
        constellation(chosen.map((r) => ({ label: runnerName(r), present: true, mandatory: mandatory.has(r.R.toLowerCase()) }))),
        h('figcaption', {}, h('ul', { class: 'dms-guardians__list' }, ...chosen.map((r) => h('li', {}, runnerName(r),
          mandatory.has(r.R.toLowerCase()) ? h('span', { class: 'dms-tag' }, t('guardians.mandatory_tag')) : null,
          r.unproven ? h('span', { class: 'dms-tag' }, t('guardians.unproven')) : null))))));
      const c = concentration(chosen);
      body.push(h('p', { class: 'dms-guardians__concentration' }, t('guardians.concentration', { operators: c.operators, networks: c.networks, countries: c.countries, share: c.share })));

      // mandatory guardians
      const others = s.candidates().filter((r) => !mandatory.has(r.R.toLowerCase()));
      const pick = select(others.map((r) => ({ value: r.R, label: runnerName(r) })));
      pick.setAttribute('data-k', 'mandatory-pick');
      const addM = button(t('guardians.add_mandatory'), { kind: 'secondary', disabled: others.length === 0 || m >= n, onClick: () => { if (pick.value) s.addMandatory(pick.value); } });
      addM.setAttribute('data-k', 'mandatory-add');
      const mBlock: (HTMLElement | null)[] = [h('h2', { class: 'dms-sheet__subtitle' }, t('guardians.mandatory_title')), h('p', { class: 'dms-soft' }, t('guardians.mandatory_intro'))];
      if (others.length) mBlock.push(h('div', { class: 'dms-template' }, field({ label: t('guardians.mandatory_pick'), control: pick }).el, addM));
      if (m > 0) {
        mBlock.push(h('ul', { class: 'dms-guardians__mandatory' }, ...s.mandatory.map((R) => {
          const r = s.runners?.find((x) => x.R.toLowerCase() === R);
          return h('li', {}, r ? runnerName(r) : R, button(t('guardians.remove_mandatory'), { kind: 'quiet', onClick: () => s.removeMandatory(R) }));
        })));
        mBlock.push(note(t('guardians.mandatory_trade'), 'warn', { 'data-trade': 'mandatory' }));
      }
      if (s.needsAck) {
        const ack = input({ 'data-k': 'ack', autocomplete: 'off', spellcheck: 'false' });
        ack.value = s.ack;
        ack.addEventListener('input', () => { s.ack = ack.value; next.disabled = !s.guardiansValid(phrase); });
        mBlock.push(field({ label: t('guardians.ack_prompt', { phrase }), control: ack }).el);
      }
      body.push(h('section', { class: 'dms-guardians__mandatory-block' }, ...mBlock));
    }
  }

  // how closely they watch
  if (cfg) {
    const presets = cfg.heartbeat_presets_blocks;
    const hb = radioGroup<string>(t('heartbeat.title'), 'heartbeat', presets.map((p) => ({ value: String(p), label: heartbeatLabel(p, blockSeconds) })), String(s.heartbeat),
      (val) => s.setHeartbeat(Number(val)));
    const tip = input({ type: 'number', min: 0.1, step: 0.1, 'data-k': 'tip', inputmode: 'decimal' });
    tip.value = String(s.tip);
    tip.addEventListener('change', () => { const x = Number(tip.value); if (Number.isFinite(x) && x >= 0.1) s.setTip(x); else tip.value = String(s.tip); });
    body.push(h('section', { class: 'dms-guardians__watch' }, hb,
      q ? h('p', { class: 'dms-soft', 'data-tradeoff': '' }, t('heartbeat.tradeoff', { delay: formatDuration(q.detectionDelay) })) : null,
      h('details', { class: 'dms-advanced' }, h('summary', {}, t('guardians.advanced')),
        field({ label: t('heartbeat.tip_label'), hint: t('heartbeat.tip_note'), control: tip }).el)));
  }
  body.push(h('p', { class: 'dms-soft dms-guardians__limits' }, t('guardians.limits', { t: s.t ?? 1 })));

  return h('div', { class: 'dms-write__with-panel' },
    sheet({ title: t('guardians.title'), level: 1, class: 'dms-write__sheet' }, ...body, actions(back, next)),
    costPanel(q));
}

// ---- price ---------------------------------------------------------------------------------------------------------

function row(label: string, amount: string, attrs: Record<string, string> = {}): HTMLElement {
  return h('div', { class: 'dms-price__row', ...attrs }, h('dt', {}, label), h('dd', { class: 'dms-mono' }, amount));
}

export function priceStep(v: StepView): HTMLElement {
  const s = v.s;
  const cfg = s.config;
  const q = s.quote();
  if (!s.organiser.lock && !s.organiser.error && !s.organiser.loading) void s.loadOrganiser();
  const parts: (HTMLElement | null)[] = [];
  if (q && cfg) {
    const months = termMonths(s.termSeconds());
    parts.push(h('p', { class: 'dms-price__monthly dms-mono', 'data-cost': 'monthly' }, t('price.monthly', { amount: formatCkb(q.monthly, undefined, { unit: false }) })));
    parts.push(h('dl', { class: 'dms-price' },
      row(t('price.spent_now'), formatCkb(q.spentNow), { 'data-cost': 'now' }),
      row(t('price.spent_term', { months }), formatCkb(q.spentOverTerm), { 'data-cost': 'term' }),
      row(t('price.parked'), formatCkb(q.parked), { 'data-cost': 'parked' }),
      row(t('price.line.organiser'), formatCkb(cfg.organiser_fee_ckb), { 'data-cost': 'organiser' })));
    parts.push(h('p', { class: 'dms-soft' }, t('price.organiser_note')));
    parts.push(h('details', { class: 'dms-advanced' }, h('summary', {}, t('price.assumptions')),
      h('dl', { class: 'dms-price dms-price--lines' }, ...q.lines.filter((l) => l.id !== 'organiser_fee').map((l) =>
        row(`${t(l.key, { months })} (${t(l.group === 'parked' ? 'price.parked' : 'price.spent')})`, formatCkb(l.ckb)))),
      h('p', {}, t('price.assumptions_text', { seconds: q.blockSeconds, runs: q.runs })),
      h('p', {}, t('price.detection', { delay: formatDuration(q.detectionDelay) }))));
    parts.push(h('p', { class: 'dms-soft' }, t('price.cancel_free')));
  } else {
    parts.push(note(t('app.loading')));
  }

  const back = linkButton(t('action.back'), '#/write/guardians', { kind: 'quiet' });
  const fee = s.feeError();
  const phrase = t('guardians.ack_phrase');
  let primary: HTMLElement | null = null;
  if (s.organiser.loading || (!s.organiser.lock && !s.organiser.error)) {
    parts.push(note(t('app.loading')));
  } else if (fee) {
    parts.push(note(t('price.config_error', { message: fee }), 'error', { 'data-config-error': '' }));
  } else if (!s.lettersValid() || !s.recipientsValid() || !s.guardiansValid(phrase)) {
    parts.push(note(t('price.incomplete'), 'warn'));
  } else if (!(v.app.walletConnected?.() ?? false)) {
    parts.push(note(t('wallet.needed')));
    primary = button(t('wallet.connect'), { kind: 'primary', onClick: () => { void v.app.connectWallet?.().then(() => v.repaint()); } });
  } else {
    primary = button(t('price.next'), { kind: 'primary', class: 'dms-price__create', onClick: () => { void s.create(phrase); v.go('create'); } });
    parts.push(note(t('wallet.sign_prompt')));
  }
  return sheet({ title: t('price.title'), level: 1, class: 'dms-write__sheet' }, ...parts, actions(back, primary));
}
