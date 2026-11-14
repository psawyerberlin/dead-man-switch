# AI worker run — dead-man-switch end-to-end, packaging, the manual step

You are an autonomous coding agent working alone in the repository `psawyerberlin/dead-man-switch`. Nobody will answer questions;
decide, record, continue. Do not stop before every phase below is done or recorded as blocked.

## Start

1. `cd` into the repository root. Read, in this order and completely: `AIWORKER.md`, `SPEC.md`,
   `aiworker/03-dms-e2e.md`, `site/DEPLOY.md`, and `../ckb-revocable-timelock/scripts/devnet-e2e.sh`, then `DECISIONS.md` (a previous run may have left notes for you).
2. Create the branch `aiworker/dms-e2e` from the current `main` (if it exists already, continue on it).
3. Run the acceptance command once before writing any code, to see what is expected:

```sh
node --test acceptance/aiworker-dms-e2e/
```

## Do

Work through the phases of `aiworker/03-dms-e2e.md` in order:

1. Phase 1 — `test/e2e/scenario.mjs`: letter with two files → create 2-of-3 → seal → check in → release → open the vault from `file://` in headless Chromium → bytes equal; second switch cancelled → vault shows cancelled; PASS/FAIL table into `DECISIONS.md`.
2. Phase 2 — `scripts/build-site.sh` (build, copy, external-reference check, tarball), `connect-src` list in `site/DEPLOY.md`, config completeness with the `FILL_ME` guard.
3. Phase 3 — `docs/manual-steps.md`: at most organiser address, build, upload.

After each phase: quality gates of `AIWORKER.md` §3.4, the acceptance command above, a commit
(`type(scope): summary`), and a bullet per decision in `DECISIONS.md` under a `## dms-e2e` section (newest spec
first in the file).

## Rules that override everything else

- Protected paths (`AIWORKER.md` §3.2) are never edited: `acceptance/**`, `SPEC.md`, `AIWORKER.md`, `aiworker/**`
  and the others listed there. A test you disagree with is implemented as written and the disagreement is noted.
- No manual steps. Anything only a human can do goes into `docs/manual-steps.md` as exact commands, and you continue.
- No secrets, no funded keys, no tokens in the repository.
- Never fake a passing test. A blocked phase stays red and is explained in `DECISIONS.md`.
- The devnet comes from the CRT repository; do not create a second one.

## Finish

Push the branch and open one pull request against `main` using `.github/pull_request_template.md`: phases done,
the acceptance output (last 30 lines), the `DECISIONS.md` section, and any `SPEC.md` change you propose as a
diff in the body. Then stop.
