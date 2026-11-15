# dead-man-switch

**A letter that opens only if you stop checking in.** Website: [dead-man-switch.chainsolution.net](https://dead-man-switch.chainsolution.net)
(English, français, Deutsch).

The reference application of [CRT (CKB Revocable Timelock)](https://github.com/psawyerberlin/ckb-revocable-timelock).
A person writes letters — text and files — for up to ten recipients, encrypted in the browser. Independent CSR
runners ("guardians") hold the key pieces; the Nervos CKB chain publishes them if the owner misses a check-in by more
than 24 hours. Checking in moves the deadline (one wallet signature, also from the phone). Cancelling destroys the
key material forever and is free. Each recipient has one file from day one — their **vault**, with only their letter —
useless until release and complete after it, openable offline in any browser, in twenty years. A fire drill on testnet
lets owner and recipients rehearse.

The optional **messenger** on the operator's server reminds the owner before each deadline, raises alarms during the
grace period and, after release, emails each recipient the link to their vault. Before release it holds only encrypted
links; it never sees a letter. Without it, nothing is stored anywhere but in the vaults and on the chain.

**Status:** application specification 2.0 complete; implementation through the AI worker specs in `aiworker/`;
testnet first, mainnet when CRT's mainnet deployment is enabled.

## Repository layout

| Path | Contents | Status |
|---|---|---|
| `SPEC.md` | the application specification (flows, formats, messenger, i18n, security, design) | 2.0 |
| `AIWORKER.md`, `aiworker/` | build specs for the AI worker | done |
| `acceptance/` | acceptance tests per spec (protected) | done |
| `app/src/i18n/` | translations en / fr / de (the maintainer's; fixed vocabulary in SPEC §2) | done |
| `app/` | Vite + TypeScript application (core, opener, UI) | specs 01, 03 |
| `notifier/` | the messenger service (Node, SQLite, SMTP) | spec 02 |
| `deploy/` | Caddy snippet and VPS notes | spec 04 |
| `spec/vectors/` | key derivation test vectors | done |
| `config/` | per-network configuration (organiser fee and address, defaults, limits) | needs the operator address |
| `site/` | the multilingual website — deploy root; `site/app/` receives the app build | done |
| `test/e2e/` | devnet scenario against CRT and the messenger | spec 04 |
| `docs/` | formats, app, notifier, manual steps | specs 01–04 |

## How it relates to CRT

CRT does the hard part: per-switch keys generated and held inside CSR runners' sandboxes, published on chain by a
lock script that refuses early or fake releases, deleted on cancel by the runner's host. This application adds:
per-recipient letters and their encryption, the vaults (CRT recovery kits with one encrypted letter and an opener
inside), the flows (write, check in, open, fire drill), the messenger, three languages, and a service fee output for
the operator. Encryption, sealing and opening happen in the user's browser or in the vault file itself.

## Licence

MIT.
