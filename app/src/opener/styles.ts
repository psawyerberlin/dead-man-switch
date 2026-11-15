// Inline CSS of the opener: the colour tokens of SPEC.md §8 (light and dark), a system serif for headings (no
// font files inside vaults, so the file stays small), print rules that print the letter alone once it is open.
export const OPENER_CSS = `
.dms, body.dms-body { --paper:#F7F3EA; --sheet:#FFFDF8; --ink:#1C2333; --ink-soft:#4A5468; --line:#E2D9C6;
  --seal:#9E2B25; --seal-ink:#FFFFFF; --gold:#8A6A2C; --ok:#2F6B4F; --warn:#8F5A0B; --danger:#9E2B25; }
@media (prefers-color-scheme: dark) {
  .dms, body.dms-body { --paper:#14171F; --sheet:#1C2030; --ink:#ECE6D8; --ink-soft:#B4AE9F; --line:#2C3246;
    --seal:#E0675E; --seal-ink:#14171F; --gold:#D2B26B; --ok:#7FC6A1; --warn:#E8B25A; --danger:#F08A80; }
  :root { color-scheme: dark; }
}
body.dms-body { background: var(--paper); color: var(--ink); max-width: 46rem; }
body.dms-body th, body.dms-body td { border-color: var(--line); }
body.dms-body .banner { border-color: var(--ink); }
body.dms-body .banner.mismatch { background: var(--sheet); color: var(--danger); }
body.dms-body textarea { background: var(--sheet); color: var(--ink); border: 1px solid var(--line); border-radius: 8px; }
.dms { font: 17px/1.55 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: var(--ink); margin: 0 0 40px; }
.dms h1, .dms h2, .dms h3, .dms .dms-serif { font-family: ui-serif, 'Iowan Old Style', Charter, Georgia, 'Times New Roman', serif;
  font-weight: 600; line-height: 1.2; border: 0; }
.dms h1 { font-size: 2.07rem; margin: 0 0 16px; }
.dms h2 { font-size: 1.66rem; margin: 24px 0 8px; }
.dms h3 { font-size: 1.33rem; margin: 16px 0 8px; }
.dms-head { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin: 0 0 16px; }
.dms-head .dms-name { font-size: 1.25rem; }
.dms-sheet { background: var(--sheet); border: 1px solid var(--line); border-radius: 14px; padding: 24px; margin: 0 0 16px;
  box-shadow: 0 1px 2px rgba(28,35,51,.06), 0 8px 24px rgba(28,35,51,.08); }
.dms-banner { border-radius: 14px; padding: 12px 16px; margin: 0 0 16px; font-weight: 600; border: 2px solid var(--line); }
.dms-banner.ok { border-color: var(--ok); color: var(--ok); }
.dms-banner.bad { border-color: var(--danger); color: var(--danger); }
.dms-banner.practice { border-style: dashed; border-color: var(--gold); color: var(--ink); }
.dms-banner.drill { border-color: var(--warn); color: var(--ink); }
.dms-ribbon { position: fixed; top: 24px; right: -56px; transform: rotate(45deg); background: var(--warn); color: var(--seal-ink);
  padding: 4px 64px; font-size: .8rem; font-weight: 700; z-index: 10; pointer-events: none; }
.dms-soft { color: var(--ink-soft); }
.dms-error { color: var(--danger); font-weight: 600; }
.dms-actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0 0; }
.dms button, .dms a.dms-button { font: inherit; min-height: 44px; padding: 8px 24px; border-radius: 999px; cursor: pointer;
  border: 1px solid var(--line); background: var(--sheet); color: var(--ink); text-decoration: none; display: inline-flex; align-items: center; }
.dms button.primary { background: var(--seal); color: var(--seal-ink); border-color: var(--seal); }
.dms button:disabled { opacity: .6; cursor: default; }
.dms select { font: inherit; min-height: 44px; padding: 4px 8px; border-radius: 8px; background: var(--sheet); color: var(--ink); border: 1px solid var(--line); }
.dms textarea { width: 100%; box-sizing: border-box; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: .85rem; }
.dms :focus-visible, body.dms-body :focus-visible { outline: 2px solid var(--gold); outline-offset: 2px; }
.dms-letter { max-width: 70ch; }
.dms-letter .dms-text a { color: var(--seal); }
.dms-letter pre, .dms-letter code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: .9em; }
.dms-letter pre { white-space: pre-wrap; background: var(--paper); padding: 8px; border-radius: 8px; }
.dms-letter blockquote { border-left: 3px solid var(--gold); margin: 8px 0; padding: 0 16px; color: var(--ink-soft); }
.dms-note { border-top: 1px solid var(--line); margin-top: 24px; padding-top: 8px; font-style: italic; }
.dms-files { list-style: none; padding: 0; margin: 8px 0; }
.dms-files li { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; padding: 8px 0; border-bottom: 1px solid var(--line); }
.dms-files .dms-file-name { flex: 1 1 12rem; word-break: break-all; }
.dms-mono { font-family: ui-monospace, Menlo, Consolas, monospace; }
@media print {
  body.dms-body { background: #fff; color: #000; max-width: none; }
  .dms { color: #000; }
  .dms-sheet { box-shadow: none; border: 0; padding: 0; }
  .dms-ribbon { position: static; transform: none; display: block; background: none; color: #000; padding: 0; }
  body.dms-letter-open > :not(#crt-application) { display: none !important; }
  body.dms-letter-open #crt-application { display: block !important; }
  body.dms-letter-open .dms-chrome { display: none !important; }
  .dms-actions, .dms button, .dms select { display: none !important; }
}
`;
