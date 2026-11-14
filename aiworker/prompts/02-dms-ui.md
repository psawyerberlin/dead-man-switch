# AI worker run — dead-man-switch app: write, check in, open

You are an autonomous coding agent working alone in the repository `psawyerberlin/dead-man-switch`. Nobody will answer questions;
decide, record, continue. Do not stop before every phase below is done or recorded as blocked.

## Start

1. `cd` into the repository root. Read, in this order and completely: `AIWORKER.md`, `SPEC.md`,
   `aiworker/02-dms-ui.md`, all three `app/src/i18n/*.json`, `site/assets/site.css`, `site/en/index.html`, then `DECISIONS.md` (a previous run may have left notes for you).
2. Create the branch `aiworker/dms-ui` from the current `main` (if it exists already, continue on it).
3. Run the acceptance command once before writing any code, to see what is expected:

```sh
node --test acceptance/aiworker-dms-ui/
node acceptance/aiworker-dms-ui/named.mjs
```

## Do

Work through the phases of `aiworker/02-dms-ui.md` in order:

1. Phase 1 — shell: hash router, language switch, network badge, CCC/JoyID wallet.
2. Phase 2 — Write flow: letter → rhythm → **guardians with check-interval presets, tip, and the live cost panel** → price (per-month figure, organiser line) → create → seal → hand over.
3. Phase 3 — My switches (check in with overlap note, change guardians, cancel in ≤ 2 clicks, reclaim, vault again) and Open (drop zone running the opener).
4. Phase 4 — build into `site/app/`, the named tests including `ui_cost_panel_live`, no hard-coded strings, no external requests, `docs/app.md`, CHANGELOG.

After each phase: quality gates of `AIWORKER.md` §3.4, the acceptance command above, a commit
(`type(scope): summary`), and a bullet per decision in `DECISIONS.md` under a `## dms-ui` section (newest spec
first in the file).

## Rules that override everything else

- Protected paths (`AIWORKER.md` §3.2) are never edited: `acceptance/**`, `SPEC.md`, `AIWORKER.md`, `aiworker/**`
  and the others listed there. A test you disagree with is implemented as written and the disagreement is noted.
- No manual steps. Anything only a human can do goes into `docs/manual-steps.md` as exact commands, and you continue.
- No secrets, no funded keys, no tokens in the repository.
- Never fake a passing test. A blocked phase stays red and is explained in `DECISIONS.md`.
- Every user-facing string is an i18n key; the acceptance heuristic fails on literals with two capitalised words.
- The Cancel button is never visually smaller than Check in.

## Finish

Push the branch and open one pull request against `main` using `.github/pull_request_template.md`: phases done,
the acceptance output (last 30 lines), the `DECISIONS.md` section, and any `SPEC.md` change you propose as a
diff in the body. Then stop.
