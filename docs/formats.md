# Formats

The normative definitions are in [`SPEC.md`](../SPEC.md) §4; this page says where each is implemented and how to check it.
Byte strings in JSON are `0x`-hex unless named `_b64`.

| Format | SPEC | Code | Tests / vectors |
|---|---|---|---|
| Letter bundle (one per recipient, encrypted as a whole) | §4.1 | `app/src/core/bundle.ts` | `bundle_*` tests |
| Keys `K_letter(r)`, `K_link(r)` (HKDF-SHA256 from `K`, salt `I`) | §4.2 | `app/src/core/keys.ts`, `aead.ts` | `spec/vectors/keys.json` |
| Vault (CRT kit + application payload, one per recipient) | §4.3 | `app/src/core/vault.ts`, opener in `app/src/opener/` | `vault_*` tests |
| Messenger record and owner code | §4.4 | `app/src/core/messenger.ts` | `record_has_no_secrets`, `owner_code_roundtrip` |
| Owner archive (scrypt + AES-256-GCM) | §4.5 | `app/src/core/archive.ts` | `archive_*` tests |
| Calendar file (`.ics`, two alarms) | §3.1 | `app/src/core/calendar.ts` | `ics_has_two_alarms`, `checkin_history_from_fixture` |
| Configuration | §4.6 | `config/<network>.json`, `app/src/core/config.ts` | |

## Bundle
UTF-8 JSON, `version: 2`, with `language`, `sender_label`, `recipient {index, name}`, `drill`, `text_markdown`,
`note_markdown` and `files[] {name, mime, size, data_b64}`. Encrypted with `K_letter(r)`, AES-256-GCM, random 12-byte
nonce, AAD `"DMS-v2" ‖ I ‖ u8(r)`. The total encrypted size is limited by `max_vault_bytes`.

## Keys
`K_letter(r)` and `K_link(r)` use HKDF info `"DMS-v2/letter" ‖ u8(r)` and `"DMS-v2/link" ‖ u8(r)`. Because `I` is the salt and
part of the AAD, a ciphertext cannot be moved to another switch or recipient. The link ciphertext (AAD `"DMS-v2/link" ‖ I ‖ u8(r)`)
hides the vault URL from the messenger until release.

## Vault
A CRT kit built with `generateKit`; the opener is `application.script` and the DMS fields are `application.payload`
(network, language, sender, recipient, nonce, `ciphertext_b64`, `app_url`). Deterministic for the same inputs. It contains
only its recipient's ciphertext. File name `[drill-]vault-<sender>-for-<recipient>-<T first 8 hex>.html`. The opener
contains no `</script` and no network access except CRT's chain reads.

## Record
Sent to the messenger: descriptor and envelopes (useless before release), owner and recipient contact data, per-recipient
encrypted link. Never `K`, a letter, or a link in clear. The owner code `dms1-<network>-<T first 8 hex>-<A base64url>`
is stored by the notifier only as `SHA-256(A)`.

## Archive
JSON `{format: "dms-owner-archive", version: 1, kdf: "scrypt", N, r, p, salt, nonce, ciphertext_b64}`; key from
scrypt(passphrase), AAD `"DMS-v2/archive"`. A wrong passphrase fails authentication.

## ics
A calendar file with the owner's check-in deadline and two alarms (a reminder before, and one at the deadline), generated
locally in the browser; see `app/src/core/calendar.ts`.
