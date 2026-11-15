# Spec 01 — core: letters, keys, vaults, opener (`dms-core`)

**Branch:** `aiworker/dms-core`. **Acceptance:** `acceptance/aiworker-dms-core/`.
**Normative:** `SPEC.md` §3.5–§3.7, §4, §6, §7, §9. **Depends on:** `@crt/client` built in `.refs/crt/client`.

Everything here is pure TypeScript usable in the browser and in Node (the notifier and the e2e scenario import
it). No DOM in `app/src/core` except where a module says so.

## Phase 1 — project and configuration

`app/` Vite + TypeScript (strict), ESM, no UI framework. `package.json` scripts: `dev`, `build` (also copies
`dist/` to `../site/app/`), `test`, `typecheck`, `lint` (eslint with the recommended TS rules; one config file).
Runtime dependencies only those of `SPEC.md` §9.

* `scripts/vendor-crt.sh`: copies `.refs/crt/deployments/<network>.json` and `<network>-runners.json` to
  `app/public/deployments/` (a missing runner list is written as `[]`; the list may be a bare array or
  `{"runners": [...]}` and is normalised to the array), and writes the CRT commit to `app/public/deployments/SOURCE`.
* `scripts/sync-config.sh`: copies `config/*.json` to `app/public/config/` and, when `site/app/` exists, to
  `site/app/config/` (so a fee change needs no rebuild, `SPEC.md` §4.6).
* `app/src/core/config.ts`: `loadConfig(network, fetchFn)` fetches `/app/config/<network>.json`, validates every
  key of `SPEC.md` §4.6 (types and ranges) and returns a typed object; `organiserFeeCheck(config, lock)` throws
  `ConfigError` when the fee is below the occupied capacity of the organiser output (`8 + lock.occupiedSize` CKB,
  the same rule as CRT's `buildCreate`) or when the address is a placeholder; `loadCrtFiles(config, fetchFn)`
  returns the parsed deployment and runner list.

## Phase 2 — `app/src/core/`

| Module | Exports | Tests (names fixed) |
|---|---|---|
| `keys.ts` | `letterKey(K, I, r)`, `linkKey(K, I, r)` — HKDF-SHA256 per `SPEC.md` §4.2 through `@noble/hashes` | `keys_match_vectors` (all cases of `spec/vectors/keys.json`) |
| `bundle.ts` | `encodeBundle(letter)`, `decodeBundle(bytes)`, `encryptBundle(K, I, r, bundle, rng) → {nonce, ciphertext}`, `decryptBundle(K, I, r, nonce, ciphertext)`; AES-256-GCM through WebCrypto, aad `"DMS-v2" ‖ I ‖ u8(r)`; size check against `max_vault_bytes`; `version` 2 only | `bundle_roundtrip`, `bundle_matches_vectors`, `bundle_wrong_identity_fails`, `bundle_wrong_recipient_fails`, `bundle_size_limit` |
| `links.ts` | `encryptLink(K, I, r, url, rng)`, `decryptLink(K, I, r, sealed)`; https only, ≤ 2048 characters | `link_roundtrip`, `link_matches_vectors`, `link_rejects_non_https` |
| `vault.ts` | `buildVault({descriptor, envelopes, deadline, recipient, sealed, meta}) → string` using `@crt/client` `generateKit` with `application = {name: "dead-man-switch", version: "2", payload, script}` exactly as `SPEC.md` §4.3 (the phase 3 opener as `script`); `vaultFileName(senderLabel, recipientName, T, drill)`; `parseVault(html) → {descriptor, envelopes, application}` (reads the kit's JSON blocks; DMS fields from `application.payload`); `zipVaults(files) → Uint8Array` (`fflate`) | `vault_deterministic`, `vault_self_contained`, `vault_roundtrip_parse`, `vault_filename`, `vault_contains_only_own_letter` (a 3-recipient switch: each vault holds exactly one ciphertext and only its recipient's name) |
| `messenger.ts` | `newOwnerCode(network, T, rng) → {code, A, adminHash}`, `parseOwnerCode(code)`, `buildRecord({…}) → record` per `SPEC.md` §4.4, and a small typed client `MessengerClient(baseUrl, fetchFn)` with `claim`, `put`, `get`, `patch`, `remove` | `record_has_no_secrets` (no `K`, no letter text, no clear link in the JSON of a record), `owner_code_roundtrip` |
| `archive.ts` | `sealArchive(contents, passphrase, rng)`, `openArchive(file, passphrase)` per `SPEC.md` §4.5 (`@noble/hashes` scrypt); `passphraseStrength(p) → 0..4` (length and character classes; a dictionary is not required) | `archive_roundtrip`, `archive_wrong_passphrase` |
| `calendar.ts` | `icsForDeadline({T, deadline, language, drill}) → string` with two VALARMs (−14 d, −2 d; for terms ≤ 2 days −50 % and 0), summary in the language | `ics_has_two_alarms` |
| `i18n.ts` | `t(key, params)`, `setLanguage`, `detectLanguage(query, storage, navigatorLanguages)`, `formatCkb`, `formatDate`, `formatDuration`; loads the three JSON files statically | `i18n_same_keys_in_all_languages`, `i18n_detect_order`, `i18n_plural_forms` |
| `price.ts` | `quote(config, crtDeployment, {n, t, termSeconds, heartbeatBlocks, heartbeatTip}) → {spentNow, spentOverTerm, monthly, parked, lines[], detectionDelay}` — a thin wrapper over `@crt/client`'s `estimateCost` (CRT §11.1) plus the organiser fee; the messenger costs nothing | `quote_matches_crt_defaults` (8 / 12 months / daily with the organiser fee set to 50 CKB as in CRT §11 → 1 530 ± 2 % spent, 4 440 ± 2 % parked), `quote_heartbeat_presets` (presets give strictly decreasing tip lines) |
| `drill.ts` | `drillBounds(config) → {minSeconds, maxSeconds, presets}`, `validateDrillTerm(config, seconds)`, `drillOpensAt(deadline, heartbeatBlocks) → {earliest, latest}` (deadline + 24 h, + one check interval) | `drill_bounds`, `drill_refused_on_mainnet` |
| `qr.ts` | `qrSvg(text) → string` (`qrcode-generator`, error correction M, SVG with `currentColor`) | `qr_encodes_link` (decode is not needed: assert version, module count and a stable hash for a fixed input) |
| `templates.ts` | `TEMPLATES` ids `legacy_checklist`, `practical_wishes`, `documents`, `crypto_assets`, `personal_letter`; `templateText(id, language)` from i18n keys `template.<id>.title` and `template.<id>.body` | `templates_three_languages` |
| `chain.ts` | thin helpers over `@crt/client`: `switchSummary(T, ctx)` (state, deadline in chain median time, headroom, owner lock hash), `checkinHistory(T, ctx)` (renew transactions of the switch through the indexer's `get_transactions`; add the RPC call here if `@crt/client` has none) | `checkin_history_from_fixture` (a recorded RPC fixture under `app/test/fixtures/`) |

## Phase 3 — the opener (`app/src/opener/`)

The script passed as `application.script` to every vault. Built by Vite as a **separate single-file IIFE bundle**
(`app/dist/opener.js`, inlined by `vault.ts` at vault build time), no imports at runtime, < 300 KB minified
including the three languages and the Markdown renderer. Behaviour per `SPEC.md` §3.3.4:

* registers `window.crtApplication = { onKey }` before the CRT kit code runs recovery; renders its own UI into
  the kit's `<div id="crt-application">` (CRT §8.2), styled with the tokens of `SPEC.md` §8 (inline CSS, the
  serif as a system fallback inside vaults so the file stays small);
* language: `application.payload.language`, switchable; all strings from the i18n JSON;
* status rendering (integrity, sealed by / for / opens if, online chain status) through `window.CRT_KIT.api`
  (`readSwitch`, `collectReleases`, `recover`; CRT §8.2) — the opener never duplicates chain or recovery code;
* on `onKey(K)`: derive `letterKey(K, I, r)`, decrypt, render text and personal note as Markdown through the
  sanitiser (headings, emphasis, lists, links with `rel="noopener"` and `http(s)`/`mailto` only, code; no
  images from the network, no raw HTML), list files with size and a download button each
  (`URL.createObjectURL`), print stylesheet; a drill vault shows the drill banner;
* the practice mode used by `#/open/demo`: `window.DMS_PRACTICE = true` makes the opener show the practice label and
  accept a key embedded in the page;
* errors: wrong key length, decryption failure, bundle version unknown — each a plain sentence in the language,
  no stack traces.

Tests: `opener_registers_hook`, `opener_renders_letter_in_three_languages` (jsdom or happy-dom),
`opener_markdown_is_sanitised` (a `<script>` and an `<img onerror>` in the text do not execute / render),
`opener_file_download_links`, `opener_uses_recipient_key` (the vault of recipient 2 does not open with recipient
1's derived key), `opener_contains_no_script_close` (the bundle has no `</script`).

## Phase 4 — docs

`docs/formats.md` (bundle, keys, vault, record, archive, ics; reference `SPEC.md` §4 rather than copy),
`app/README.md` (scripts, how to build the opener alone, how to change the fee: `scripts/sync-config.sh`),
`CHANGELOG.md`.

## Acceptance

```sh
node --test acceptance/aiworker-dms-core/
node acceptance/aiworker-dms-core/named.mjs
```
