# dead-man-switch app

TypeScript + Vite, no UI framework. `@crt/client` is a file dependency built from `.refs/crt/client`
(`scripts/vendor-crt.sh`).

## Scripts
- `npm run dev` — Vite dev server.
- `npm run build` — typecheck, build the app, build the opener, copy to `site/`.
- `npm run build:opener` — build only the opener (see below).
- `npm test` — vitest (offline). `npm run typecheck`, `npm run lint`.

## Building the opener alone
`OPENER=1 vite build` (`npm run build:opener`) writes `dist/opener.js`, a single IIFE with Markdown renderer, sanitiser
and the three languages. `vite.config.ts` also exposes `buildOpener()` (used by tests) and a `virtual:dms-opener`
module, so the app embeds the opener in every vault.

## Changing the fee
Edit `organiser_fee_ckb` in `config/<network>.json` (≥ the output's occupied capacity), run `scripts/sync-config.sh`
from the repository root, commit, then `git pull` on the server. No rebuild is needed: the app fetches
`/app/config/<network>.json` at runtime. See `SPEC.md` §4.6.
