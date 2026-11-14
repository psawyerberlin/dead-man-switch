# dead-man-switch

**A letter that opens only if you stop checking in.** Website: [dead-man-switch.chainsolution.net](https://dead-man-switch.chainsolution.net)
(English, français, Deutsch).

The reference application of [CRT (CKB Revocable Timelock)](https://github.com/psawyerberlin/ckb-revocable-timelock).
A person writes a letter — text and files — encrypted in the browser. Independent CSR runners ("guardians") hold
the key pieces; the Nervos CKB chain publishes them if the owner misses a check-in by more than 24 hours. Checking
in moves the deadline (one wallet signature). Cancelling destroys the key material forever and is free. The
recipients hold one file from day one — the **vault** — useless until release and complete after it, openable
offline in any browser, in twenty years.

No server, no account, nothing stored anywhere but in the vault (secret, with the recipients) and on the chain
(public, no secrets).

**Status:** application specification 1.0 complete; implementation through the AI worker specs in `aiworker/`;
testnet first, mainnet when CRT's mainnet deployment is enabled.

## Repository layout

| Path | Contents | Status |
|---|---|---|
| `SPEC.md` | the application specification (flows, formats, i18n, security) | 1.0 |
| `AIWORKER.md`, `aiworker/` | build specs for the AI worker | done |
| `acceptance/` | acceptance tests per spec (protected) | done |
| `app/src/i18n/` | translations en / fr / de (the maintainer's; fixed vocabulary in SPEC §2) | done |
| `app/` | Vite + TypeScript application (core, opener, UI) | specs 01–02 |
| `config/` | per-network configuration (organiser fee and address, defaults, limits) | needs the operator address |
| `site/` | the multilingual website — deploy root; `site/app/` receives the app build | done |
| `test/e2e/` | devnet scenario against CRT | spec 03 |
| `docs/` | formats, app, manual steps | specs 01–03 |

## How it relates to CRT

CRT does the hard part: per-switch keys generated and held inside CSR runners' sandboxes, published on chain by a
lock script that refuses early or fake releases, deleted on cancel by the runner's host. This application adds:
the letter bundle format and its encryption, the vault (a CRT recovery kit with the encrypted letter and an opener
inside), the three flows (write, check in, open), three languages, and a service fee output for the operator. It
never sees a letter: encryption, sealing and opening happen in the user's browser or in the vault file itself.

## Licence

MIT.
