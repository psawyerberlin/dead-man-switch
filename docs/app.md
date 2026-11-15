# The app (`app/`)

TypeScript + Vite, no UI framework, no analytics, no external fonts or CDNs. `npm run build` (in `app/`) vendors CRT's
deployments (`scripts/vendor-crt.sh`), syncs `config/*.json` (`scripts/sync-config.sh`), typechecks, builds the app and the
opener, copies `dist/` to `site/app/` (base `/app/`) and vendors/syncs again into `site/app/deployments/` and `site/app/config/`.
`npm test` runs vitest; the repository's acceptance runs `node --test acceptance/aiworker-dms-ui/`.

## Screens (hash routes)

| Route | Screen |
| --- | --- |
| `#/` | home: one sentence, Write / My switches / Fire drill, practice vault |
| `#/write/<step>` | letters, recipients, rhythm, guardians, price, create, seal, handover |
| `#/mine` | My switches: ring, check in, away until, cancel, timeline, messenger settings, owner archive |
| `#/checkin?network=&T=&rhythm=` | phone check-in deep link |
| `#/open`, `#/open/demo` | open a vault (sandboxed iframe), practice vault |
| `#/drill`, `#/drill/<step>`, `#/drill/report` | fire drill (testnet only) |
| `#/guide/<place>` | handover guides for the ten places |
| `#/privacy`, `#/about` | privacy statement, about |

Mainnet is disabled until `config/mainnet.json` has `enabled: true`; the drill is then hidden everywhere.

## Design system

Tokens in `src/ui/tokens.css` (light and dark, contrast pairs checked by `ui_contrast_tokens`), components in
`src/ui/components/`, line illustrations in `src/ui/illustrations/`, self-hosted Fraunces (`@fontsource-variable/fraunces`).
Every state is conveyed by text as well as colour; motion respects `prefers-reduced-motion`.

## Adding or changing a string

1. Add the key to `src/i18n/en.json`, `fr.json` and `de.json` (the three files must have the same keys; `i18n_no_hardcoded_strings`).
2. Use `t('your.key', { param })` in code; never write user-facing text in a `.ts` file.
3. Run `npm test`. Vocabulary is fixed by `SPEC.md` §2.

## Tests

Fixed names are listed in `aiworker/03-dms-ui.md` Phase 4 (`ui_*`, `i18n_no_hardcoded_strings`). The built app must
reference no origin outside its own, the configured RPC, monitor and wallet (`acceptance/aiworker-dms-ui/wiring.test.mjs`).
