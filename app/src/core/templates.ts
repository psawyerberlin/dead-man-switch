// Letter templates (SPEC.md §3.6): text with headings, in the three languages, nothing filled in.
import type { Language } from './bundle';
import { translate } from './i18n';

export const TEMPLATES = ['legacy_checklist', 'practical_wishes', 'documents', 'crypto_assets', 'personal_letter'] as const;
export type TemplateId = (typeof TEMPLATES)[number];

export interface TemplateText { id: TemplateId; title: string; body: string }

/** From the i18n keys `template.<id>.title` and `template.<id>.body`. */
export function templateText(id: TemplateId, language: Language): TemplateText {
  if (!(TEMPLATES as readonly string[]).includes(id)) throw new RangeError(`unknown template ${String(id)}`);
  return { id, title: translate(language, `template.${id}.title`), body: translate(language, `template.${id}.body`) };
}
