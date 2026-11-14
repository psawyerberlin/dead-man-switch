# Spec 03 — end-to-end on devnet, packaging, the manual step (`dms-e2e`)

**Branch:** `aiworker/dms-e2e`. **Acceptance:** `acceptance/aiworker-dms-e2e/`. **Depends on:** specs 01–02 and the CRT
devnet (`../ckb-revocable-timelock/scripts/devnet-e2e.sh`).

## Phase 1 — scripted scenario

`test/e2e/scenario.mjs` (Node, uses `app/src/core` through the built library and a headless browser only for the
opener): start the CRT devnet (three runners), then with a devnet key: write a letter with one text and two files
→ create (2-of-3) → wait for commits → arm → seal → write `vault.html` to `.devnet/` → **check in** once (deadline
moves, `I` unchanged, vault still valid) → advance devnet time past deadline + 24 h → open `vault.html` in headless
Chromium (`file://`) with the devnet RPC configured → assert the letter text and the two files are recovered
byte-for-byte → second switch: cancel → open the vault → assert the "cancelled" status and no decryption. Prints
PASS/FAIL per step; exit code = failures; output pasted into `DECISIONS.md`.

## Phase 2 — packaging and deployment files

* `scripts/build-site.sh`: builds `app/`, copies into `site/app/`, writes `site/app/BUILD` with the commit and the
  CRT client commit; verifies no external references (same check as the acceptance test); produces
  `dist/dead-man-switch-site-<version>.tar.gz` of `site/`.
* `site/DEPLOY.md` exists (maintainer); add the exact `connect-src` list the build needs.
* `config/testnet.json` complete except `organiser_address` (placeholder `ckt1…FILL_ME` makes the build fail with
  a clear message until replaced); `config/mainnet.json` with `"enabled": false`.

## Phase 3 — the manual step

`docs/manual-steps.md`, the only place a human is asked to do something, at most these items: set
`organiser_address` in `config/testnet.json` (and later `mainnet.json`); run `scripts/build-site.sh`; upload
`site/` to the web root of `dead-man-switch.chainsolution.net`. Nothing else.

## Acceptance

```sh
node --test acceptance/aiworker-dms-e2e/
```
