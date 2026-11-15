// Small form controls of the Write steps: radio groups, checkboxes, number steppers, the size meter.
import { h, nextId, type Child } from '../dom';

export interface Choice<V extends string> { value: V; label: string; hint?: string }

/** A `fieldset` of radios; `onChange` gets the chosen value. */
export function radioGroup<V extends string>(legend: string, name: string, choices: Choice<V>[], value: V | null, onChange: (v: V) => void,
  extra: Partial<Record<V, Child>> = {}): HTMLFieldSetElement {
  const group = nextId(name);
  return h('fieldset', { class: 'dms-choices' }, h('legend', { class: 'dms-field__label' }, legend),
    ...choices.map((c) => {
      const id = nextId(name);
      const input = h('input', { type: 'radio', name: group, id, value: c.value, 'data-k': `${name}:${c.value}` });
      input.checked = c.value === value;
      input.addEventListener('change', () => { if (input.checked) onChange(c.value); });
      return h('div', { class: 'dms-choice' }, input, h('label', { for: id }, c.label),
        c.hint ? h('p', { class: 'dms-field__hint' }, c.hint) : null, extra[c.value] ?? null);
    }));
}

export function checkbox(label: string, checked: boolean, onChange: (v: boolean, el: HTMLInputElement) => void, attrs: Record<string, string | boolean> = {}): HTMLElement {
  const id = nextId('check');
  const input = h('input', { type: 'checkbox', id, ...attrs });
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked, input));
  return h('div', { class: 'dms-check' }, input, h('label', { for: id }, label));
}

export function note(text: string, kind: 'soft' | 'warn' | 'error' | 'ok' = 'soft', attrs: Record<string, string> = {}): HTMLElement {
  return h('p', { class: `dms-note dms-note--${kind}`, role: kind === 'error' ? 'alert' : undefined, ...attrs }, text);
}

export function actions(...children: Child[]): HTMLElement {
  return h('div', { class: 'dms-actions dms-write__actions' }, ...children);
}
