# Spec 04 — end-to-end, packaging, deployment, the manual step (`dms-e2e`)

**Branch:** `aiworker/dms-e2e`. **Acceptance:** `acceptance/aiworker-dms-e2e/`. **Depends on:** specs 01–03, the
CRT devnet (`.refs/crt/scripts/devnet-e2e.sh`).

## Phase 1 — scripted scenario (written, run by the maintainer)

`test/e2e/scenario.mjs` (Node; uses `app/src/core` through the built library, the notifier as a child process with
a local SMTP sink, and a headless browser only for the opener): start the CRT devnet (three runners) and the
notifier (`NETWORKS=devnet`, SQLite in `.devnet/`, `SMTP_HOST`/`SMTP_PORT` pointing at a sink written with the `smtp-server` dev
dependency that stores messages in `.devnet/mail/`), then with a devnet key:

1. two recipients (en, de), per-recipient letters, one text and two files each, recipient 1 with a link;
2. claim → create (2-of-3) → wait for commits → arm → seal → write both vaults to `.devnet/` → `put` the record;
3. assert the "told now" email reached the sink; confirm recipient 1 through its link;
4. **check in** once (deadline moves, `I` unchanged, vaults still valid); assert the next reminder follows;
5. advance devnet time to the deadline → assert the first grace alarm; past deadline + 24 h → let the runners
   release;
6. assert the release email for recipient 1 carries the decrypted link, recipient 2 got exactly one email;
7. open each vault in headless Chromium (`file://`) with the devnet RPC → letter text and files byte-for-byte;
   vault 1 does not show recipient 2's letter;
8. second switch: claim, create, arm, seal, put, cancel → assert the vault shows "cancelled", no decryption, the
   notifier deleted the record and sent the owner's cancel email.

Prints PASS/FAIL per step; exit code = failures.

## Phase 2 — packaging and deployment files

* `scripts/build-site.sh` (`set -euo pipefail`): vendor CRT files, build `app/`, sync config, copy into
  `site/app/`, write `site/app/BUILD` (commit, CRT commit, date), refuse to finish while
  `config/testnet.json.organiser_address` is a placeholder (clear message), verify no external references (same
  check as the acceptance test), produce `dist/dead-man-switch-site-<version>.tar.gz` of `site/`.
* `deploy/Caddyfile.snippet`: the site block for `dead-man-switch.chainsolution.net` in the style of the CRT one:
  `root * /sites/dead-man-switch`, `file_server`, `handle /api/* { reverse_proxy dms-notifier:8787 }`, `encode
  zstd gzip`, security headers, the CSP (`default-src 'self'; connect-src 'self'` plus the RPC, monitor and
  `https://*.joy.id`; `frame-src https://*.joy.id`; `img-src 'self' data: blob:`; `font-src 'self'`;
  `object-src 'none'; base-uri 'none'; frame-ancestors 'none'`), `try_files` so `/en/`, `/fr/`, `/de/` and
  `/app/` resolve, cache headers (immutable for hashed assets, short for `config/`).
* `deploy/README.md`: the VPS layout (repository at `~/src/dead-man-switch`, the mount line
  `- ~/src/dead-man-switch/site:/sites/dead-man-switch:ro` in the web server's compose file, the notifier compose
  project in `~/src/dead-man-switch/notifier`), how to validate the Caddyfile in a throwaway container
  (`docker run --rm -v …:/etc/caddy/Caddyfile:ro caddy:2 caddy validate --config /etc/caddy/Caddyfile`), how to
  update (`git -C ~/src/dead-man-switch pull -q`; `docker compose -f … up -d --build dms-notifier` when
  `notifier/` changed), the mail setup as it is (Strato mailbox `dead-man-switch_noreply@chainsolution.psawyer.de`,
  `smtp.strato.de:465`; SPF `v=spf1 redirect=_spf.strato.com` on `chainsolution.psawyer.de`, DKIM selectors
  `strato-dkim-0002` (RSA) and `-0003` (Ed25519) published by Strato, `_dmarc.chainsolution.psawyer.de`
  `v=DMARC1; p=quarantine; adkim=r; aspf=r`) and how to check it (send to Gmail, "Show original"), backup of the
  notifier data.
* `config/testnet.json` complete except `organiser_address`; `config/mainnet.json` with `"enabled": false`.

## Phase 3 — the manual step

`docs/manual-steps.md`, the only place a human is asked to do something, at most these items:

1. set `organiser_address` in `config/testnet.json` (and later `mainnet.json`); check `organiser_fee_ckb` against
   the address type;
2. run `scripts/build-site.sh` and commit `site/app/` (it is served from git, not uploaded);
3. run the devnet scenario (`node test/e2e/scenario.mjs`) and paste its output into `DECISIONS.md`;
4. on the VPS: clone the repository, create `~/dms-notifier.env` from `notifier/.env.example` (Strato mailbox `dead-man-switch_noreply@chainsolution.psawyer.de`, password typed by the human,
   `NOTIFIER_DATA_KEY` from `openssl rand -hex 32`), start the notifier, add the Caddy block and mount, validate,
   rebuild Caddy (the mail DNS of `chainsolution.psawyer.de` is already done: SPF Strato standard, DKIM by Strato,
   DMARC `p=quarantine`; verified 2026-11-15 with SPF, DKIM and DMARC pass at Gmail);
5. a **fire drill** on testnet with a JoyID wallet in the deployed app (one recipient who confirms), then a second
   drill that is cancelled; record T, dates and PASS/FAIL in `docs/testing.md`;
6. deploy updates: `git -C ~/src/dead-man-switch pull -q` (and the notifier rebuild when it changed).

Nothing else.

## Acceptance

```sh
node --test acceptance/aiworker-dms-e2e/
```
