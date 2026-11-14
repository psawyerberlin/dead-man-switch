# dead-man-switch — Application Specification

**Version 1.0. Status: normative for the first release.** The application is the reference consumer of
[CRT (CKB Revocable Timelock)](https://github.com/psawyerberlin/ckb-revocable-timelock) and follows its
`SPEC.md` v0.2. Where this document says "CRT §n" it points there.

## 1. What it does

A person writes a letter — text and files — that must reach chosen people **only if that person stops checking
in**. The letter is encrypted in the browser. CRT holds the key with independent node operators and publishes it
on the Nervos CKB chain if the check-in deadline passes by more than 24 hours. Checking in moves the deadline.
Cancelling destroys the key material forever. The recipients hold one file, the **vault**, from day one; it is
useless until release and complete after it.

Nothing is stored on any server: not the letter, not the key, not the recipients. The web app is static. The only
state is on the CKB chain (public, as CRT defines) and in the vault file (secret, in the recipients' hands).

Languages: English, French, German — the app and the vault.

## 2. Roles and vocabulary (user-facing words, fixed across the three languages)

| Word | Meaning | en / fr / de |
|---|---|---|
| **Letter** | the plaintext: a text and up to N files | letter / lettre / Brief |
| **Vault** | the single HTML file given to recipients (CRT recovery kit + encrypted letter + opener) | vault / coffre / Tresor |
| **Check-in** | the owner's action that moves the deadline (CRT renew) | check in / signaler sa présence / sich melden |
| **Deadline** | the date after which, plus 24 h of grace, the letter opens | deadline / échéance / Frist |
| **Guardians** | the CSR runners holding the key shares (CRT nodes) | guardians / gardiens / Wächter |
| **Open** | what a recipient does with the vault after release | open / ouvrir / öffnen |
| **Cancel** | destroy the switch; the letter can never open | cancel / annuler / widerrufen |

The app never shows "Alive Cell", "Node Cell", "job", "heartbeat", "descriptor" to the owner; those words appear
only on the technical details panel and in the vault's certificate.

## 3. Flows

### 3.1 Write (owner)

1. **Connect a wallet** (JoyID through CCC; any CCC signer). Network testnet until CRT's mainnet deployment is
   enabled. Show the balance and, on testnet, the faucet link.
2. **Write the letter**: a text (Markdown allowed, rendered in the vault with a safe subset) and files (drag and
   drop; total ≤ 25 MB after encryption; images, PDFs, anything). Everything stays in memory.
3. **Choose the check-in rhythm**: every 1, 3, 6 or 12 months (custom allowed). The first deadline = now +
   rhythm. Plain-language consequence shown: "If you have not checked in by <date>, the letter opens on <date +
   24 h>." Terms over 5 years in one step are not offered (CRT §10); the rhythm keeps terms short by design.
4. **Choose the guardians**: default 5-of-8 from the CRT runner directory (CRT §9), with the concentration summary;
   advanced panel to change `t`, `n`, add the owner's own runner as mandatory (2-of-3 recommended per CRT §7.3;
   1-of-1 only after typing "I understand" in the UI language).
5. **See the price**: CRT §11 instantiated for the chosen rhythm and guardians: spent (tips, organiser fee) vs
   parked (cells, back at the end). Organiser fee default **50 CKB** to the application operator's address from
   `config/<network>.json`; shown as its own line; zero on cancel.
6. **Create**: sign the CRT Create transaction. Then the app waits for the guardians' commits (progress per
   guardian, typically minutes), verifies hard-fail (CRT §8.3; a failure stops with the rule number and no
   override), builds the descriptor, signs **Arm**.
7. **Seal**: generate `K` (32 random bytes), encrypt the letter bundle (§4.1), `wrapKey` (CRT §7.2), build the
   vault (§4.2), download it. The owner must tick "I have saved the vault and I understand that only this file can
   open the letter" before leaving. Offer a second download and a printable certificate page (from the vault).
8. **Hand over**: a screen that explains, in plain words, how to give the vault to the recipients now (email it,
   store it with them, a USB stick) and that it cannot be opened before the deadline.

### 3.2 Check in, cancel, change (owner)

**My switches** lists the owner's switches (local list keyed by `T`, plus "add by T"; CRT `readSwitch`). For each:
countdown to the deadline in **chain median time**, guardians' health (both headroom figures, in plain words:
"3 guardians may fail before the letter is lost"), buttons:

* **Check in** — one signature (CRT `buildRenew`: deadline = now + rhythm, new heartbeat jobs). Shows the overlap
  cost when checking in early (CRT §6, O-10).
* **Change guardians** — CRT rewrap; produces a **new vault** that must replace the old one with every recipient
  (the app says so three times: before, during, after).
* **Cancel** — one signature, one confirmation dialog that states the consequence ("the letter can never be
  opened; the vault becomes useless; the parked CKB comes back"). Never more clicks than Create. No fee.
* **Reclaim** — after release or cancel, take the parked CKB back.
* **Download vault again** — only possible while the app still has the letter in memory (same session); otherwise
  explain that the vault cannot be regenerated without the letter, and offer "Change guardians" which produces a new one.

Reminders: the app cannot email. It offers a calendar file (`.ics`, VALARM 14 days and 2 days before the deadline)
at Seal and at every Check in, and a copy-paste reminder text. No server, no mailing list.

### 3.3 Open (recipient)

The recipient double-clicks the vault (any browser, online or offline) **or** drops it onto
`dead-man-switch.chainsolution.net/#/open`. Both run the same code (the vault's own). Screens, in the vault's
language with a language switch:

1. **Integrity**: descriptor hash recomputed → MATCH / MISMATCH banner (CRT §8.2). Online: also compared against
   the Node Cells.
2. **Status**: "Sealed by <label> on <date>. Opens if the owner has not checked in by <deadline>." Online: reads
   the chain — *not yet* (with the current deadline and the guardians' health), *released* (how many guardians
   have published), or *cancelled* ("the owner cancelled this on <date>; the letter cannot be opened").
3. **Open**: when ≥ `t` releases are readable (online, or pasted offline), recover `K`, decrypt, render the text
   (safe Markdown) and list the files with download buttons (object URLs, nothing leaves the page). A wrong
   release value is named by guardian (commitment check). A missing margin is explained ("2 of 5 guardians have
   published; 3 are needed").
4. **Print / save**: the letter as a printable page; the files as downloads. No upload anywhere.

### 3.4 What the app refuses

Creating a switch without the owner having saved the vault; a mandatory 1-of-1 guardian without the typed
acknowledgement; any verification override; running on mainnet while `deployments/mainnet.json.enabled` is false;
letters above the size limit (the vault must stay openable in a browser from a file URL: ≤ 25 MB encrypted,
checked before Seal).

## 4. Formats

### 4.1 Letter bundle (plaintext, then encrypted as a whole)

```json
{ "version": 1, "language": "fr", "created_at": 1763000000, "sender_label": "Patrick",
  "text_markdown": "…", "files": [ { "name": "will.pdf", "mime": "application/pdf", "size": 120394, "data_b64": "…" } ] }
```

UTF-8 JSON → `AES-256-GCM(K, nonce = 12 random bytes, aad = "DMS-v1" ‖ I)` → `ciphertext`. `I` is the CRT switch
identity, so a ciphertext cannot be moved to another vault.

### 4.2 Vault = CRT kit + application payload

Produced by CRT's `generateKit({descriptor, envelopes, application})` with

```json
"application": { "name": "dead-man-switch", "version": 1, "language": "fr", "sender_label": "Patrick",
  "created_at": 1763000000, "cipher": "AES-256-GCM", "nonce": "0x…", "aad": "DMS-v1",
  "ciphertext_b64": "…", "size": 123456, "app_url": "https://dead-man-switch.chainsolution.net" }
```

and the DMS opener script appended (self-contained: Markdown renderer, i18n strings for the three languages,
file download logic; no network except CRT's own chain reads). The opener registers
`window.crtApplication = { onKey(K) }`. File name: `vault-<sender_label>-<T first 8 hex>.html`. Deterministic for
the same inputs (CRT §8.2).

### 4.3 Configuration

`config/<network>.json`: `organiser_fee_ckb` (50), `organiser_address` (the operator's CKB address; testnet and
mainnet differ), `default_t` (5), `default_n` (8), `rhythms_months` ([1, 3, 6, 12]), `max_vault_bytes` (26 214 400),
`crt_deployment_url` (path to CRT's `deployments/<network>.json`, vendored copy at build time),
`faucet_url` (testnet only).

## 5. Internationalisation

* `app/src/i18n/{en,fr,de}.json`, flat keys, ICU-style plurals where needed (`{count, plural, one {…} other {…}}`),
  loaded at build time (no runtime fetch). The same files are bundled into the vault opener.
* Language = `?lang=` → `localStorage` → `navigator.languages` → `en`. Switch in the header; the choice is
  remembered. `<html lang>` follows.
* Dates and numbers through `Intl` with the active locale; CKB amounts with thin-space thousands separators in
  all three languages; the chain's median time is labelled as such ("chain time") when it differs from the
  wallclock by more than 10 minutes.
* Every user-facing string is a key; a test fails on any hard-coded string in `app/src/**/*.ts(x)` outside the
  i18n files (heuristic: string literals ≥ 2 words containing a space and a letter, excluding `console`, URLs,
  selectors). The three files have identical key sets (test).
* The vocabulary of §2 is fixed; the maintainer's translations in the i18n files take precedence over any
  machine translation.

## 6. Security and privacy

* Plaintext, `K`, the bundle and the vault exist only in the browser's memory and in the downloaded file.
* No telemetry, no analytics, no third-party scripts, no fonts from a CDN. CSP in `site/DEPLOY.md`.
* The app's own transactions carry the organiser fee as an ordinary output; nothing else of the owner's goes to
  the operator. The operator cannot read, delay, open or cancel a letter.
* The vault is the secret-bearing artefact. The app says so at Seal and at Hand over, in one sentence each, in the
  owner's language.
* Everything CRT §12 lists as not defended against is shown once, in the owner's language, on the guardian screen
  (short) and in the FAQ of the site (long).

## 7. Components

| Directory | Contents |
|---|---|
| `app/` | Vite + TypeScript, no UI framework; `src/core` (bundle, vault, config), `src/ui` (screens), `src/i18n`, `src/opener` (the script appended to vaults; also built as a standalone bundle for tests) |
| `site/` | the explainer website in three languages (deploy root; `site/app/` receives the build) |
| `config/` | per-network application configuration |
| `test/` | unit and end-to-end tests (devnet via CRT's `scripts/devnet-e2e.sh`) |
| `aiworker/`, `acceptance/` | build specs and their acceptance tests |

Dependencies allowed at runtime: `@crt/client` (from the CRT repository, pinned by commit until it is published),
`@ckb-ccc/core` and the JoyID connector of CCC, `@noble/*` (through `@crt/client`), a Markdown renderer that is
small and sanitising (`marked` + `DOMPurify`, or `micromark` + a safe schema; recorded in `DECISIONS.md`).
