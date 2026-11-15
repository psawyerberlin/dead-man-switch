import { test, expect } from 'vitest';
import { TEMPLATES, templateText } from '../src/core/templates';
import { MESSAGES } from '../src/core/i18n';

test('templates_three_languages', () => {
  expect([...TEMPLATES]).toEqual(['legacy_checklist', 'practical_wishes', 'documents', 'crypto_assets', 'personal_letter']);
  for (const id of TEMPLATES) {
    const texts = (['en', 'fr', 'de'] as const).map((l) => templateText(id, l));
    for (const [i, l] of (['en', 'fr', 'de'] as const).entries()) {
      expect(MESSAGES[l][`template.${id}.title`]).toBeTruthy();
      expect(MESSAGES[l][`template.${id}.body`]).toBeTruthy();
      expect(texts[i]!.body).toMatch(/^## |\n## /); // text with headings
    }
    expect(new Set(texts.map((x) => x.title)).size).toBe(3);
    expect(new Set(texts.map((x) => x.body)).size).toBe(3);
  }
  expect(templateText('crypto_assets', 'en').body).toContain('After release, whoever holds this vault can read it');
  expect(() => templateText('nope' as never, 'en')).toThrow();
});
