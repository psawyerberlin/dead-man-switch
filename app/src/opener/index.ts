// Entry of the single-file opener bundle (IIFE, `OPENER=1 vite build` → `dist/opener.js`), inlined into every vault
// as CRT's `application.script`. Evaluated after the kit's own script and before any recovery can run.
import { installOpener } from './opener';

installOpener(window);
