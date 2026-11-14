# Spec 01 — core: letter bundle, vault, opener (`dms-core`)

**Branch:** `aiworker/dms-core`. **Acceptance:** `acceptance/aiworker-dms-core/`.
**Normative:** `SPEC.md` §4, §5, §6, §7. **Depends on:** `@crt/client` built in `.refs/crt/client`.

## Phase 1 — project

`app/` Vite + TypeScript (strict), ESM, no UI framework. `package.json` scripts: `dev`, `build` (also copies
`dist/` to `../site/app/`), `test`, `typecheck`, `lint` (eslint with the recommended TS rules; one config file).
Runtime dependencies only those of `SPEC.md` §7. `app/src/config.ts` loads `config/<network>.json` and the
vendored CRT deployment (`app/public/deployments/<network>.json`, copied by a script from
`.refs/crt/deployments/` with the source commit in `app/public/deployments/SOURCE`).

## Phase 2 — `app/src/core/`

| Module | Exports | Tests (names fixed) |
|---|---|---|
| `bundle.ts` | `encodeBundle(letter)`, `decodeBundle(bytes)`, `encryptBundle(K, I, letter, rng) → {nonce, ciphertext}`, `decryptBundle(K, I, nonce, ciphertext)`; AES-256-GCM, `aad = "DMS-v1" ‖ I`; size check against `max_vault_bytes` | `bundle_roundtrip`, `bundle_wrong_identity_fails`, `bundle_size_limit` |
| `vault.ts` | `buildVault({descriptor, envelopes, letterCipher, meta, language}) → string` using `@crt/client` `generateKit` with the application payload of `SPEC.md` §4.2 and the opener script of phase 3 appended; `vaultFileName(senderLabel, T)`; `parseVault(html) → {descriptor, envelopes, application}` (reads the kit's JSON blocks) | `vault_deterministic`, `vault_self_contained`, `vault_roundtrip_parse`, `vault_filename` |
| `calendar.ts` | `icsForDeadline({T, deadline, language}) → string` with two VALARMs (−14 d, −2 d), summary in the language | `ics_has_two_alarms` |
| `i18n.ts` | `t(key, params)`, `setLanguage`, `detectLanguage(query, storage, navigatorLanguages)`, `formatCkb`, `formatDate`; loads the three JSON files statically | `i18n_same_keys_in_all_languages`, `i18n_detect_order`, `i18n_plural_forms` |
| `price.ts` | `quote(config, crtDeployment, {n, t, rhythmMonths, heartbeatBlocks, heartbeatTip}) → {spentNow, spentOverTerm, monthly, parked, lines[], detectionDelay}` — a thin wrapper over `@crt/client`'s `estimateCost` (CRT §11.1) plus the organiser fee from `config` and fiat formatting; `HEARTBEAT_PRESETS` from `config` | `quote_matches_crt_defaults` (8 / 12 months / daily → 1 530 ± 2 % spent, 4 440 ± 2 % parked), `quote_heartbeat_presets` (presets give strictly decreasing tip lines) |

## Phase 3 — the opener (`app/src/opener/`)

The script appended to every vault. Built by Vite as a **separate single-file IIFE bundle**
(`app/dist/opener.js`, inlined by `vault.ts` at vault build time), no imports at runtime, < 250 KB minified
including the three languages and the Markdown renderer. Behaviour per `SPEC.md` §3.3:

* registers `window.crtApplication = { onKey }` before the CRT kit code runs recovery; renders its own UI into
  the kit's `<div id="crt-application">` (CRT §8.2);
* language: vault's `application.language`, switchable; all strings from the i18n JSON;
* status rendering (integrity, sealed by / opens if, online chain status) through `window.CRT_KIT.api`
  (`readSwitch`, `collectReleases`, `recover`; CRT §8.2) — the opener never duplicates chain or recovery code;
* on `onKey(K)`: decrypt, render Markdown through the sanitiser (allow headings, emphasis, lists, links with
  `rel="noopener"` and `http(s)`/`mailto` only, code; no images from the network, no raw HTML), list files with
  size and a download button each (`URL.createObjectURL`), print stylesheet;
* errors: wrong key length, decryption failure, bundle version unknown — each a plain sentence in the language,
  no stack traces.

Tests: `opener_registers_hook`, `opener_renders_letter_in_three_languages` (jsdom or happy-dom), `opener_markdown_is_sanitised`
(a `<script>` and an `<img onerror>` in the text do not execute / render), `opener_file_download_links`.

## Phase 4 — docs

`docs/formats.md` (bundle, vault, ics; reference `SPEC.md` §4 rather than copy), `app/README.md` (scripts, how to
build the opener alone), `CHANGELOG.md`.

## Acceptance

```sh
node --test acceptance/aiworker-dms-core/
node acceptance/aiworker-dms-core/named.mjs
```
