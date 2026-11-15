// Accessibility helpers (SPEC.md §8): the WCAG 2.x contrast ratio, the colour tokens read from tokens.css, the
// list of text/background pairs the components use (checked by `ui_contrast_tokens`), and a focus trap.

export type Theme = 'light' | 'dark';
export type TokenName = 'paper' | 'sheet' | 'ink' | 'ink-soft' | 'line' | 'seal' | 'seal-ink' | 'gold' | 'ok' | 'warn' | 'danger';
export type Palette = Record<TokenName, string>;

export const TOKEN_NAMES: readonly TokenName[] = ['paper', 'sheet', 'ink', 'ink-soft', 'line', 'seal', 'seal-ink', 'gold', 'ok', 'warn', 'danger'];

/** `#RGB` or `#RRGGBB` → [r, g, b] in 0..255. */
export function parseHex(hex: string): [number, number, number] {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) throw new RangeError(`not a hex colour: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colours, 1..21. */
export function contrast(fg: string, bg: string): number {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** AA: 4.5:1 for body text, 3:1 for large text (≥ 24 px, or ≥ 18.66 px bold) and for non-text (focus ring, ring stroke). */
export const AA_TEXT = 4.5;
export const AA_LARGE = 3;

/**
 * Reads the light and dark palettes from tokens.css: light from the first `:root {…}` block, dark from
 * `:root[data-theme="dark"] {…}` (the `prefers-color-scheme` block repeats the same values).
 */
export function parseTokens(css: string): Record<Theme, Palette> {
  const block = (re: RegExp): string => {
    const m = re.exec(css);
    if (!m) throw new Error(`tokens.css: block ${re} not found`);
    return m[1]!;
  };
  const read = (body: string): Palette => {
    const out = {} as Palette;
    for (const name of TOKEN_NAMES) {
      const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,6})\\s*;`).exec(body);
      if (!m) throw new Error(`tokens.css: --${name} missing`);
      out[name] = m[1]!;
    }
    return out;
  };
  return { light: read(block(/:root\s*\{([^}]*)\}/)), dark: read(block(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/)) };
}

export interface ColourPair {
  fg: TokenName;
  bg: TokenName;
  /** large text or non-text graphics: 3:1 suffices */
  large?: boolean;
  /** where the pair is used */
  use: string;
}

/** Every foreground/background pair the components and the shell use (components.css, base.css). */
export const COLOUR_PAIRS: readonly ColourPair[] = [
  { fg: 'ink', bg: 'paper', use: 'body text' },
  { fg: 'ink', bg: 'sheet', use: 'sheet, dialog, field, toast, secondary button' },
  { fg: 'ink-soft', bg: 'paper', use: 'hints, footer, greyed network badge' },
  { fg: 'ink-soft', bg: 'sheet', use: 'field hint, stepper upcoming step, ring caption' },
  { fg: 'seal-ink', bg: 'seal', use: 'primary button, current stepper step, seal monogram' },
  { fg: 'seal', bg: 'paper', use: 'quiet button, links' },
  { fg: 'seal', bg: 'sheet', use: 'quiet button on a sheet' },
  { fg: 'danger', bg: 'sheet', use: 'field error, danger toast' },
  { fg: 'danger', bg: 'paper', use: 'error text on the background' },
  { fg: 'ok', bg: 'sheet', use: 'confirmed state, ok toast' },
  { fg: 'ok', bg: 'paper', use: 'testnet badge' },
  { fg: 'warn', bg: 'sheet', use: 'last 10 % in the ring caption' },
  { fg: 'seal-ink', bg: 'warn', use: 'drill ribbon' },
  { fg: 'gold', bg: 'sheet', large: true, use: 'ring stroke, constellation points, focus ring on sheets' },
  { fg: 'gold', bg: 'paper', large: true, use: 'focus ring on the background' },
  { fg: 'ink', bg: 'sheet', large: true, use: 'ring number' },
];

// ---- focus trap (dialog) --------------------------------------------------------------------------------------

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusables(root: Element): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((e) => !e.hasAttribute('hidden') && e.getAttribute('aria-hidden') !== 'true');
}

/** Keeps Tab / Shift+Tab inside `root`. Returns the function that removes the trap. */
export function trapFocus(root: HTMLElement): () => void {
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key !== 'Tab') return;
    const items = focusables(root);
    if (items.length === 0) { ev.preventDefault(); root.focus(); return; }
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = root.ownerDocument.activeElement;
    if (ev.shiftKey && (active === first || !root.contains(active))) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && (active === last || !root.contains(active))) { ev.preventDefault(); first.focus(); }
  };
  root.addEventListener('keydown', onKey);
  return () => root.removeEventListener('keydown', onKey);
}

/** `prefers-reduced-motion: reduce` (false where matchMedia is missing). */
export function prefersReducedMotion(win: { matchMedia?: (q: string) => { matches: boolean } } | undefined = globalThis as never): boolean {
  try { return !!win?.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}
