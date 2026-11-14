# AI worker run — dead-man-switch core: bundle, vault, opener

You are an autonomous coding agent working alone in the repository `psawyerberlin/dead-man-switch`. Nobody will answer questions;
decide, record, continue. Do not stop before every phase below is done or recorded as blocked.

## Start

1. `cd` into the repository root. Read, in this order and completely: `AIWORKER.md`, `SPEC.md`,
   `aiworker/01-dms-core.md`, `app/src/i18n/en.json` (and fr, de), `config/testnet.json`, and in `../ckb-revocable-timelock`: `SPEC.md` §6.2, §7, §8, §11.1, `client/README.md`, `docs/developers.md`, then `DECISIONS.md` (a previous run may have left notes for you).
2. Create the branch `aiworker/dms-core` from the current `main` (if it exists already, continue on it).
3. Run the acceptance command once before writing any code, to see what is expected:

```sh
node --test acceptance/aiworker-dms-core/
node acceptance/aiworker-dms-core/named.mjs
```

## Do

Work through the phases of `aiworker/01-dms-core.md` in order:

1. Phase 1 — `app/` Vite + TypeScript project, scripts, `config.ts`, vendored CRT deployment with `SOURCE`.
2. Phase 2 — `app/src/core/`: `bundle.ts` (AES-256-GCM, aad `DMS-v1 ‖ I`), `vault.ts` (CRT `generateKit` + opener), `calendar.ts`, `i18n.ts`, **`price.ts` over `@crt/client` `estimateCost` with the heartbeat presets from `config`**; the fixed test names.
3. Phase 3 — `app/src/opener/`: single-file IIFE < 250 KB, three languages, `window.crtApplication.onKey`, `window.CRT_KIT.api`, sanitised Markdown, file downloads; tests.
4. Phase 4 — `docs/formats.md`, `app/README.md`, CHANGELOG.

After each phase: quality gates of `AIWORKER.md` §3.4, the acceptance command above, a commit
(`type(scope): summary`), and a bullet per decision in `DECISIONS.md` under a `## dms-core` section (newest spec
first in the file).

## Rules that override everything else

- Protected paths (`AIWORKER.md` §3.2) are never edited: `acceptance/**`, `SPEC.md`, `AIWORKER.md`, `aiworker/**`
  and the others listed there. A test you disagree with is implemented as written and the disagreement is noted.
- No manual steps. Anything only a human can do goes into `docs/manual-steps.md` as exact commands, and you continue.
- No secrets, no funded keys, no tokens in the repository.
- Never fake a passing test. A blocked phase stays red and is explained in `DECISIONS.md`.
- `@crt/client` is a file dependency on `../ckb-revocable-timelock/client`; record the commit you built against.
- Translations are protected: you may add keys to all three files at once, never change existing values.

## Finish

Push the branch and open one pull request against `main` using `.github/pull_request_template.md`: phases done,
the acceptance output (last 30 lines), the `DECISIONS.md` section, and any `SPEC.md` change you propose as a
diff in the body. Then stop.
