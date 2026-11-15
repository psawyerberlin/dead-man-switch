# Decisions log (AI worker)

Newest spec first. One `##` section per spec, one bullet per decision (`AIWORKER.md` §5).

## (no spec run yet)

- 2026-11-15 — maintainer: specs aligned with CRT `main` 7fd2e32 before the first run. Vault `application` uses CRT's
  `KitApplication {name, version: "1", payload, script}` (DMS fields in `payload`). Guardians only from CRT runners
  (vendored `<network>-runners.json`, `requireCrt: true`); `n` per network (mainnet 3-16, testnet 1-16) clamped to the
  candidates, testnet defaults 1-of-1 (one CRT runner today). Testnet-only 1-day rhythm (`rhythms_days`). `site/app/`
  is committed and served from a `git pull` on the VPS; the manual steps add a testnet cancel/release run.
- 2026-11-14 — maintainer: SPEC.md 1.0, the specs under `aiworker/`, the acceptance tests, the three translation
  files and the website written. The vocabulary of SPEC.md §2 is fixed; translations in `app/src/i18n/` take
  precedence over any later machine translation.
