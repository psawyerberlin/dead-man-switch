// The Write flow (SPEC.md §3.1): routes `#/write/<step>` — letters → recipients → rhythm → guardians → price →
// create → seal → handover — with the stepper always visible. Each step is a sheet built from the session; a session
// change repaints the step and keeps the focus on the control that had it (`data-k`).
import { t } from '../../core/i18n';
import { linkButton } from '../components/button';
import { sheet } from '../components/sheet';
import { stepOf, stepper, type StepId } from '../components/stepper';
import { h, mount } from '../dom';
import { lettersStep, recipientsStep, rhythmStep } from './steps-plan';
import { guardiansStep, priceStep } from './steps-guardians';
import { createStep, handoverStep, sealStep } from './steps-seal';
import type { StepView, WriteApp } from './view';

export const WRITE_STEPS = ['letters', 'recipients', 'rhythm', 'guardians', 'price', 'create', 'seal', 'handover'] as const;
export type WriteStep = (typeof WRITE_STEPS)[number];
export const isWriteStep = (v: unknown): v is WriteStep => typeof v === 'string' && (WRITE_STEPS as readonly string[]).includes(v);

let screens = 0;

const BUILDERS: Record<WriteStep, (v: StepView) => HTMLElement> = {
  letters: lettersStep, recipients: recipientsStep, rhythm: rhythmStep, guardians: guardiansStep, price: priceStep,
  create: createStep, seal: sealStep, handover: handoverStep,
};

/** The step is reachable: after Create the planning steps are closed, and the later ones need what comes before. */
function blocked(step: WriteStep, app: WriteApp): boolean {
  const s = app.session;
  if (s.created && ['letters', 'recipients', 'rhythm', 'guardians', 'price'].includes(step)) return true;
  if (step === 'seal') return s.status.phase !== 'done';
  if (step === 'handover') return !s.vaults || !s.saved;
  return false;
}

function blockedSheet(step: WriteStep, app: WriteApp): HTMLElement {
  const s = app.session;
  const resume = s.handedOver ? null : s.vaults && s.saved ? 'handover' : s.status.phase === 'done' ? 'seal' : s.created ? 'create' : 'letters';
  return sheet({ title: t(`write.title.${step}`), level: 1 },
    h('p', {}, t(s.created ? 'write.closed' : 'write.not_yet')),
    h('div', { class: 'dms-actions' }, resume ? linkButton(t('write.resume'), `#/write/${resume}`, { kind: 'primary' }) : linkButton(t('handover.done'), '#/mine', { kind: 'primary' })));
}

export function writeScreen(param: string | null, app: WriteApp): HTMLElement {
  const step: WriteStep = isWriteStep(param) ? param : 'letters';
  const s = app.session;
  const screen = ++screens;
  const root = h('div', { class: 'dms-screen dms-write', 'data-write-step': step });
  const navigate = app.navigate ?? ((hash: string) => { globalThis.location.hash = hash; });
  let seen = false;
  const view: StepView = {
    app, s, screen,
    go: (next) => navigate(`#/write/${next}`),
    repaint: () => paint(),
  };
  const hrefFor = (id: StepId): string | null => (s.created ? null : `#/write/${id}`);
  const paint = (): void => {
    if (root.isConnected) seen = true;
    else if (seen) { unsubscribe(); return; }
    const active = root.ownerDocument.activeElement;
    const key = active && root.contains(active) ? active.getAttribute('data-k') : null;
    mount(root, stepper({ current: stepOf(step), hrefFor }), blocked(step, app) ? blockedSheet(step, app) : BUILDERS[step](view));
    if (key) root.querySelector<HTMLElement>(`[data-k="${key.replace(/["\\]/g, "\\$&")}"]`)?.focus();
  };
  const unsubscribe = s.onChange(paint);
  paint();
  return root;
}
