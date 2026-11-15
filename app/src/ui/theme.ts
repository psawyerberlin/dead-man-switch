// Theme toggle (SPEC.md §8): system / light / dark, remembered in localStorage. "system" removes the attribute
// and lets `prefers-color-scheme` decide (tokens.css).
import { t } from '../core/i18n';
import { h, nextId } from './dom';

export type ThemeChoice = 'system' | 'light' | 'dark';
export const THEMES: readonly ThemeChoice[] = ['system', 'light', 'dark'];
export const THEME_STORAGE_KEY = 'dms.theme';

interface StorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void }

const isTheme = (v: unknown): v is ThemeChoice => typeof v === 'string' && (THEMES as readonly string[]).includes(v);

export function loadTheme(storage: Pick<StorageLike, 'getItem'> | null | undefined): ThemeChoice {
  try {
    const v = storage?.getItem(THEME_STORAGE_KEY);
    return isTheme(v) ? v : 'system';
  } catch { return 'system'; }
}

export function applyTheme(choice: ThemeChoice, root: HTMLElement = document.documentElement): void {
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
}

export function saveTheme(choice: ThemeChoice, storage: StorageLike | null | undefined): void {
  try { storage?.setItem(THEME_STORAGE_KEY, choice); } catch { /* private mode: not remembered */ }
}

const storage = (): StorageLike | null => { try { return globalThis.localStorage ?? null; } catch { return null; } };

/** The header control: a labelled select (system / light / dark). */
export function themeToggle(): HTMLElement {
  const id = nextId('theme');
  const current = loadTheme(storage());
  const sel = h('select', { id, class: 'dms-header__select' }, ...THEMES.map((v) => h('option', { value: v }, t(`theme.${v}`))));
  sel.value = current;
  sel.addEventListener('change', () => {
    const v = sel.value as ThemeChoice;
    applyTheme(v);
    saveTheme(v, storage());
  });
  return h('div', { class: 'dms-header__control' }, h('label', { for: id, class: 'dms-header__label' }, t('theme.label')), sel);
}
