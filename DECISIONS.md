# Decisions log (AI worker)

Newest spec first. One `##` section per spec, one bullet per decision (`AIWORKER.md` §5).

## dms-core, phase 1 (project and configuration)

- 2026-11-15 — `app/` is Vite 6 + TypeScript strict + vitest (jsdom available for the opener tests); `@crt/client` is a
  `file:../.refs/crt/client` dependency (CRT commit 7ceca10, recorded in `app/public/deployments/SOURCE`). CRT's
  `package.json` points `main` at `dist/index.js` but `tsc` emits `dist/src/index.js`, so `tsconfig.json` (`paths`) and
  `vite.config.ts` (`alias`) map `@crt/client` to `dist/src`.
- Runtime dependencies (SPEC §9): `@ckb-ccc/core`, `@crt/client`, `@noble/hashes`, `marked` + `dompurify` (sanitising
  Markdown), `qrcode-generator`, `fflate`. JoyID connector is added by the UI project when needed.
- `vite.config.ts` builds the app by default and the opener (`OPENER=1`, IIFE, `dist-opener/`) separately; `npm run build`
  copies `dist/` to `../site/app/` through `scripts/copy-to-site.mjs`.
- `loadConfig` fetches `/app/config/<network>.json`; mainnet must have `drill: null`; `n_min ≤ default_n ≤ n_max`,
  `default_t ≤ default_n`, default heartbeat must be one of the presets. `organiserFeeCheck` takes any object with
  `occupiedSize` (CCC `Script` fits) so config.ts has no chain dependency; placeholder = not a bech32-like `ckb1`/`ckt1`
  address of the right network or containing "placeholder/replace/todo".
- `vendor-crt.sh` vendors both networks; `sync-config.sh` also creates `site/app/config/` (committed, per SPEC §4.6).
- `.refs/crt` was built with `npm ci && npm run build` in `client/`.

## (no spec run yet)

- 2026-11-15 — maintainer: SPEC.md 2.0 replaces 1.0 before any run. Recipients (1–10) with their own letters and vaults
  (per-recipient keys by HKDF from K, vectors in `spec/vectors/keys.json`); the messenger (notifier) on the VPS for
  reminders, grace alarms and release emails, holding only encrypted links before release; guided cloud handover without
  integrations; fire drill on testnet (30 min – 48 h deadline; CRT `7ceca10` allows terms ≥ 30 min on test networks;
  GRACE stays 24 h); owner archive, owner code, check-in from the phone, away mode, templates, paper backup, practice vault;
  visual design in SPEC §8. Four projects now: dms-core, dms-notifier, dms-ui, dms-e2e. Organiser fee 70 CKB (maintainer choice; the operator addresses are secp256k1, minimum 61): a
  fee output below its occupied capacity (61 CKB secp256k1, 63 JoyID) is rejected by CRT's `buildCreate`, so 50 CKB
  cannot work. i18n: maintainer strings updated to the plural (letters, vaults) and 53 keys added.
- 2026-11-15 — maintainer: specs aligned with CRT `main` 7fd2e32 before the first run. Vault `application` uses CRT's
  `KitApplication {name, version: "1", payload, script}` (DMS fields in `payload`). Guardians only from CRT runners
  (vendored `<network>-runners.json`, `requireCrt: true`); `n` per network (mainnet 3-16, testnet 1-16) clamped to the
  candidates, testnet defaults 1-of-1 (one CRT runner today). Testnet-only 1-day rhythm (`rhythms_days`). `site/app/`
  is committed and served from a `git pull` on the VPS; the manual steps add a testnet cancel/release run.
- 2026-11-14 — maintainer: SPEC.md 1.0, the specs under `aiworker/`, the acceptance tests, the three translation
  files and the website written. The vocabulary of SPEC.md §2 is fixed; translations in `app/src/i18n/` take
  precedence over any later machine translation.
