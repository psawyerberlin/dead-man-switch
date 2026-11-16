# dead-man-switch — Application Specification

**Version 2.0. Status: normative for the first release.** The application is the reference consumer of
[CRT (CKB Revocable Timelock)](https://github.com/psawyerberlin/ckb-revocable-timelock) and follows its
`SPEC.md` v0.2. Where this document says "CRT §n" it points there. Version 2.0 adds recipients with their own
letters, the notifier (reminders and delivery by email), the guided cloud handover, the fire drill, the owner
archive and the visual design; it replaces 1.0 entirely.

## 1. What it does

A person (the **owner**) writes letters — text and files — that must reach chosen people (the **recipients**)
**only if the owner stops checking in**. Everything is encrypted in the owner's browser. CRT holds the key with
independent node operators (the **guardians**) and publishes it on the Nervos CKB chain if the check-in deadline
passes by more than 24 hours. Checking in moves the deadline. Cancelling destroys the key material forever.

Each recipient gets one file, their **vault**: it contains only the letter meant for them. The owner stores each
vault where that recipient can reach it (any cloud, a NAS, a USB stick) and may give the app the share link. The
optional **notifier** on the operator's server reminds the owner before each deadline, raises an alarm during
the 24 h grace, and, after release, emails each recipient the link to their vault. The notifier never holds the
key before release and never sees a letter.

The owner pays everything from their own wallet (JoyID through CCC); the operator of the site receives a fixed
organiser fee per switch. The web app is static; the only server part is the notifier.

Languages: English, French, German — the app, the vaults and the emails.

## 2. Roles and vocabulary (user-facing words, fixed across the three languages)

| Word | Meaning | en / fr / de |
|---|---|---|
| **Letter** | the plaintext for one recipient: a text and files | letter / lettre / Brief |
| **Vault** | the single HTML file for one recipient (CRT recovery kit + their encrypted letter + opener) | vault / coffre / Tresor |
| **Recipient** | a person who receives a letter (1–10 per switch) | recipient / destinataire / Empfänger |
| **Check-in** | the owner's action that moves the deadline (CRT renew) | check in / signaler sa présence / sich melden |
| **Deadline** | the date after which, plus 24 h of grace, the letters open | deadline / échéance / Frist |
| **Guardians** | the CSR runners holding the key shares (CRT nodes) | guardians / gardiens / Wächter |
| **Open** | what a recipient does with the vault after release | open / ouvrir / öffnen |
| **Cancel** | destroy the switch; the letters can never open | cancel / annuler / widerrufen |
| **Messenger** | the notifier, as the owner and recipients see it | messenger / messager / Bote |
| **Fire drill** | a short rehearsal on testnet | fire drill / exercice / Probealarm |
| **Owner code** | the secret that lets the owner change the messenger settings | owner code / code propriétaire / Eigentümer-Code |

The app never shows "Alive Cell", "Node Cell", "job", "heartbeat", "descriptor" to the owner; those words appear
only on the technical details panel and in the vault's certificate.

## 3. Flows

### 3.1 Write (owner)

The Write flow is a stepper drawn as the journey of a letter: **Letters → Recipients → Rhythm → Guardians →
Price → Seal → Hand over**. State lives in memory; a reload before Seal loses everything (said once, at the top).

1. **Connect a wallet** (JoyID through CCC; any CCC signer). Network testnet until CRT's mainnet deployment is
   enabled. Show the balance and, on testnet, the faucet link.
2. **Letters.** One shared letter for everyone, or one per recipient, or a shared letter plus a personal note per
   recipient (the bundle of §4.1 then carries both). Markdown text (rendered in the vault with a safe subset) and
   files (drag and drop). Each vault ≤ `max_vault_bytes` after encryption, checked live. **Templates** can be
   inserted (§3.6). Everything stays in memory.
3. **Recipients** (1–`max_recipients`, default 10): name (shown in their vault and emails), language (en/fr/de,
   default the owner's), optional email, optional "tell them now" (§3.3.1). The email is only given to the
   messenger; it never enters a vault or the chain.
4. **Rhythm**: every 1, 3, 6 or 12 months (custom allowed, ≥ 1 day). The first deadline = now + rhythm.
   Plain-language consequence: "If you have not checked in by <date>, the letters open on <date + 24 h>." Terms
   over 5 years in one step are not offered (CRT §10). The fire drill has its own rhythms (§3.4).
5. **Guardians and how closely they watch**: default `default_t`-of-`default_n` (5-of-8 on mainnet) from the CRT
   runner directory (CRT §9). Candidates are only runners that run CRT: `fetchRunners` with the vendored
   `<network>-runners.json` as `crtList`, then `selectRunners` with `requireCrt: true` and `requireDepositedValid`
   from config. `n` is limited to `n_min`..`n_max` of the network (mainnet 3–16, testnet 1–16) and to the number of
   candidates; the defaults are clamped to what is available, and the screen says how many guardians exist.
   Concentration summary; the owner's own runner as mandatory (2-of-3 recommended per CRT §7.3; 1-of-1 only after
   typing the acknowledgement phrase in the UI language); the **guardian check interval** (CRT `HEARTBEAT`, §6.2)
   as presets *every 3 hours / every 12 hours / daily / weekly* with the trade ("a guardian that disappears is
   noticed within {delay}; checking more often costs more") and the tip per check in the advanced panel. One
   screen, with a **live cost panel**.
6. **Price**: CRT's cost estimator (CRT §11.1) for the chosen settings — spent now, spent over the term, **per
   month**, parked (back at the end) — assumptions expandable; the same figures, frozen, are what the owner signs
   for. Organiser fee (`organiser_fee_ckb` to `organiser_address` of `config/<network>.json`) as its own line;
   zero on cancel. The messenger is free. Check in and Change guardians show the same estimate before signing.
7. **Create**: the app builds the CRT Create transaction, which yields `T` and `I` before sending. If the owner
   enabled the messenger, the app first **claims** `T` at the notifier (§5.2) with the hash of a fresh owner code;
   then it asks for the signature and sends. It waits for the guardians' commits (progress per guardian, typically
   minutes), verifies hard-fail (CRT §8.3; a failure stops with the rule number and no override), builds the
   descriptor, signs **Arm**.
8. **Seal**: generate `K` (32 random bytes), derive the per-recipient keys (§4.2), encrypt each recipient's bundle,
   `wrapKey` (CRT §7.2), build one vault per recipient (§4.3). The **seal moment** is the visual centre of the app
   (§8): a wax seal is pressed onto each letter. Then: download each vault (or all as one `.zip` built in the
   browser), show the **owner code** once (copy / print, stored in this browser too), offer the **owner archive**
   (§3.5, off by default), the printable **paper backup** per recipient (§3.7) and the calendar file. The owner
   must tick "I have saved the vaults and I understand that only these files can open the letters" before leaving.
9. **Hand over** (guided, §3.3.2): for each recipient, a card with their vault, the tutorial for the chosen place,
   and a field for the share link. Links are encrypted with keys derived from `K` (§4.2) and sent with the email
   addresses to the messenger (§5.2). `K` and the letters are then dropped from memory, unless the owner archive is
   kept open in this session.

### 3.2 My switches (owner)

`#/mine` lists the owner's switches (local list keyed by network and `T`, "add by T", and "restore from owner
code"). Each switch is a **card**:

* **Countdown ring**: the arc is the time left in the current rhythm; centre: "opens in 23 days" in chain median
  time; colour turns amber in the last 10 % and red during the grace.
* **Health in plain words**: "3 guardians may fail before the letters are lost" (both headroom figures, CRT §8).
* **Timeline**: created, each check-in (from the chain: renew transactions of the switch), next deadline,
  messenger events (reminders sent, recipients confirmed) when the owner code is present.
* **Recipients**: name, language, "confirmed ✓ / not asked / waiting", link set or not.
* Buttons:
  * **Check in** — one signature (CRT `buildRenew`: deadline = now + rhythm, new heartbeat jobs). Shows the
    overlap cost when checking in early (CRT §6, O-10). Allowed during the grace (until a guardian has released).
  * **Away until…** — a check-in with a chosen date instead of the rhythm (date picker; earliest tomorrow, latest
    5 years; same cost display). For travel or a hospital stay.
  * **Messenger settings** — change the owner's email, reminder choices, recipients' emails, "tell them now";
    needs the owner code. Links and letters can only change with the owner archive (§3.5).
  * **Change guardians** — CRT rewrap; needs `K`, hence the owner archive or a fresh Write; produces **new
    vaults** that must replace the old ones with every recipient (said before, during, after).
  * **Cancel** — one signature, one confirmation dialog with the consequence ("the letters can never be opened;
    the vaults become useless; the parked CKB comes back"). Never more clicks than Create. No fee. The messenger
    deletes the switch's data (§5.4).
  * **Reclaim** — after release or cancel, take the parked CKB back.

**Check in from the phone.** Every reminder email carries a link
`<app_url>/app/#/checkin?network=<n>&T=<T>&rhythm=<ISO 8601 duration>`: a one-screen page with the switch
summary read from the chain and one large button; JoyID connects inline (passkey). The page checks that the
connected wallet is the owner (lock hash = the owner lock hash of the Node Cells) and otherwise explains.

Reminders also come as a calendar file (`.ics`, VALARM 14 days and 2 days before the deadline) at Seal and at
every check-in, and as a copy-paste text, for owners who do not use the messenger.

### 3.3 Recipients

#### 3.3.1 Told now (optional, per recipient)

When "tell them now" is on, the messenger sends one email right after Hand over, in the recipient's language:
"<sender> has named you as the recipient of a sealed letter. Nothing to do now. If the letter is ever released you
will get an email with a link. Please confirm that this address may receive it." with **Confirm** and **Stop**
links. The owner sees the confirmation in My switches. The email contains no link to the vault and nothing about
the letter.

#### 3.3.2 Hand over — guided, no integration

The app does not connect to any cloud. For each vault the owner picks where it goes, and the app shows a short
tutorial (three to six steps, in the UI language) for: Google Drive, Microsoft OneDrive, Dropbox, Apple iCloud
Drive, Synology (Drive / QuickConnect), Nextcloud, GMX / WEB.DE Cloud, Proton Drive, "my own server", USB stick
or paper. Each tutorial covers: upload the file, share it with the recipient's account (preferred) or create a
link anyone can open, paste the link here. Facts the tutorial states once: the vault cannot be opened before
release, so an open link is safe until then; after release anyone with the link and the vault can read the
letter, so a link restricted to the recipient's account is better; keep the file where it will still exist in
years (not a trial account). The link (https only, ≤ 2048 characters) is optional; without it the release email
says "open the vault <sender> gave you".

The link is **never** put on the chain. It is encrypted in the browser with a key derived from `K` (§4.2) and
stored only by the messenger. Before release nobody — including the operator — can read it.

#### 3.3.3 Release email

After release (≥ `t` guardians have published, CRT §6), the messenger recovers `K` from the chain (it holds the
descriptor and the envelopes, §5.3), decrypts each recipient's link and sends, in the recipient's language:
"<sender>'s letter for you can now be opened." with the link, the open page `<app_url>/app/#/open` and the
three-line instruction (download the vault, open it in a browser or drop it on the page, follow the screen).
Confirmed recipients get it; unconfirmed recipients get exactly this one email and nothing else. The owner gets a
copy of the delivery report (who was emailed, no links).

#### 3.3.4 Open

The recipient double-clicks the vault (any browser, online or offline) **or** drops it onto
`dead-man-switch.chainsolution.net/app/#/open`. Both run the same code (the vault's own). Screens, in the vault's
language with a language switch:

1. **Integrity**: descriptor hash recomputed → MATCH / MISMATCH banner (CRT §8.2). Online: also compared against
   the Node Cells.
2. **Status**: "Sealed by <sender> for <recipient> on <date>. Opens if <sender> has not checked in by <deadline>."
   Online: reads the chain — *not yet* (current deadline, guardians' health), *released* (how many guardians have
   published), or *cancelled* ("<sender> cancelled this on <date>; the letter cannot be opened").
3. **Open**: when ≥ `t` releases are readable (online, or pasted offline), recover `K`, derive the recipient key,
   decrypt, render the text (safe Markdown) and list the files with download buttons (object URLs, nothing leaves
   the page). A wrong release value is named by guardian (commitment check). A missing margin is explained
   ("2 of 5 guardians have published; 3 are needed").
4. **Print / save**: the letter as a printable page; the files as downloads. No upload anywhere.

`#/open/demo` opens a built-in **practice vault** (sample letter, a key embedded in the page, no chain) so a
recipient can see today what opening will look like. It is labelled as practice on every screen.

### 3.4 Fire drill (testnet only)

A rehearsal of the whole flow with the real guardians on testnet, for the owner and the recipients. Entry:
"Try a fire drill" on the home screen and in My switches; hidden on mainnet.

* Deadline in **30 minutes to 48 hours** (presets 30 min, 1 h, 3 h, 12 h, 24 h, 48 h; custom within the range;
  CRT allows terms ≥ 30 min on testnet and devnet). A drill runs on CRT's **testnet rehearsal deployment**
  (`deployments/testnet-drill.json`, contracts built with a 10-minute grace; its own node lock and CRT service, which a
  runner enables next to the normal one). So the letters open at the deadline + 10 minutes, plus at most one guardian
  check (50 blocks ≈ 9 min, the drill's check interval; CRT allows 50 on test networks). The screen shows both dates.
  The vault carries the grace (`grace_seconds`), the messenger finds the switch under either deployment.
* Guardians: as §3.1.5 on testnet (1-of-1 allowed without acknowledgement on a drill).
* Everything is marked: a diagonal amber "Fire drill — testnet" ribbon on every screen, `drill-` in vault file
  names, "[Drill]" / "[Exercice]" / "[Probealarm]" in email subjects, a banner inside the vault.
* The messenger runs the drill like a real switch but with drill reminders: at 50 % of the term and at the
  deadline, and grace alarms at deadline, +12 h, +20 h. Recipients of a drill must confirm first (§3.3.1 is forced
  on); unconfirmed recipients get no drill email.
* **Drill report** (`#/drill/report?T=`): the timeline of what happened (created, reminders, grace alarms,
  release, emails sent) and a checklist for a real switch ("did everyone find the email? could everyone open the
  vault?"). Drill data is deleted by the messenger 7 days after release or cancel.

### 3.5 Owner archive (optional)

Off by default. A file `owner-archive-<T first 8 hex>.dmsa` that holds `K`, the letters, the recipients and the
links, encrypted with a passphrase the owner chooses (§4.5). With it the owner can later: download the vaults
again, change letters or links (new vaults), change guardians (CRT rewrap), add a recipient. Warning shown before
it is created, in one sentence: "Anyone with this file and the passphrase can read your letters before the
deadline." Passphrase strength is estimated live; below the threshold the button stays disabled.

### 3.6 Templates

Starting points the owner can insert into a letter (all optional, editable, in the three languages):
*digital legacy checklist* (accounts, password manager, devices, subscriptions), *practical wishes*, *where the
documents are*, *crypto assets* (wallets, where the recovery material is; with the sentence "after release, whoever
holds this vault can read it"), *a personal letter* (a few opening prompts). Templates are text with headings;
nothing is filled in automatically.

### 3.7 Paper backup

Per recipient, a printable cover sheet: "A sealed letter from <sender> for <recipient>", the switch id `T`, the
date sealed, a QR code to the recipient's link (or to `<app_url>/app/#/open` without a link), and the three-line
instruction. Followed by the CRT certificate page of the vault. Printing happens in the browser.

### 3.8 What the app refuses

Creating a switch without the owner having saved the vaults; a mandatory 1-of-1 guardian without the typed
acknowledgement (real switches); any verification override; running on mainnet while
`deployments/mainnet.json.enabled` is false; a fire drill on mainnet or outside 30 min–48 h; letters above the size
limit (≤ `max_vault_bytes` encrypted per vault, checked before Seal); more than `max_recipients` recipients; an
organiser fee below the occupied capacity of the organiser address's output (the config is then invalid and the
app says so instead of building a transaction CRT would reject).

## 4. Formats

All byte strings in JSON are `0x`-hex unless named `_b64` (standard base64). `u8(r)` is one byte.

### 4.1 Letter bundle (plaintext, one per recipient, then encrypted as a whole)

```json
{ "version": 2, "language": "fr", "created_at": 1763000000, "sender_label": "Patrick",
  "recipient": { "index": 1, "name": "Anna" }, "drill": false,
  "text_markdown": "…", "note_markdown": "…",
  "files": [ { "name": "will.pdf", "mime": "application/pdf", "size": 120394, "data_b64": "…" } ] }
```

`note_markdown` is the personal note (may be empty). UTF-8 JSON.

### 4.2 Keys

`K` is CRT's 32-byte secret. Per recipient `r` (1–10):

* `K_letter(r) = HKDF-SHA256(ikm = K, salt = I, info = "DMS-v2/letter" ‖ u8(r), 32)`
* `K_link(r)   = HKDF-SHA256(ikm = K, salt = I, info = "DMS-v2/link"   ‖ u8(r), 32)`

Letter: `AES-256-GCM(K_letter(r), nonce = 12 random bytes, aad = "DMS-v2" ‖ I ‖ u8(r))`.
Link: `AES-256-GCM(K_link(r), nonce = 12 random bytes, aad = "DMS-v2/link" ‖ I ‖ u8(r))`, plaintext the UTF-8 URL.
`I` is the CRT switch identity, so a ciphertext cannot be moved to another switch or another recipient. Test
vectors: `spec/vectors/keys.json`.

### 4.3 Vault = CRT kit + application payload (one per recipient)

Produced by CRT's `generateKit({descriptor, envelopes, application, kitVersion: KIT_VERSION, deadline})` with
CRT's `KitApplication` shape `{ name, version, payload, script }` (`version` is a string; the DMS fields live in
`payload`, exposed by the kit as `window.CRT_KIT.application.payload`):

```json
"application": { "name": "dead-man-switch", "version": "2",
  "payload": { "network": "testnet", "language": "fr", "sender_label": "Patrick",
    "recipient": { "index": 1, "name": "Anna" }, "drill": false, "created_at": 1763000000,
    "cipher": "AES-256-GCM", "nonce": "0x…", "ciphertext_b64": "…", "size": 123456,
    "app_url": "https://dead-man-switch.chainsolution.net" },
  "script": "<the DMS opener>" }
```

The opener (passed as `application.script`; self-contained: Markdown renderer, i18n strings of the three
languages, file download logic, no network except CRT's own chain reads; it must not contain `</script`, which
`generateKit` refuses) registers `window.crtApplication = { onKey(K) }`. A vault contains **only** its recipient's
ciphertext. File name: `vault-<sender>-for-<recipient>-<T first 8 hex>.html` (ASCII-folded, `[a-z0-9-]`), with the
prefix `drill-` for a drill. Deterministic for the same inputs (CRT §8.2).

### 4.4 Messenger record (what the browser sends to the notifier)

```json
{ "version": 1, "network": "testnet", "T": "0x…", "I": "0x…", "drill": false,
  "sender_label": "Patrick", "rhythm": "P3M",
  "descriptor": { … }, "envelopes": [ … ],
  "owner": { "email": "owner@example.org", "language": "de", "reminders": true },
  "recipients": [ { "index": 1, "name": "Anna", "language": "fr", "email": "anna@example.org",
                    "tell_now": true, "link": { "nonce": "0x…", "ciphertext": "0x…" } } ] }
```

`descriptor` and `envelopes` are the CRT kit inputs (useless before release). `link` may be `null`. The record
never contains `K`, a letter, or a link in clear. The owner code `A` is 32 random bytes shown as
`dms1-<network>-<T first 8 hex>-<A base64url>`; the notifier stores only `SHA-256(A)`.

### 4.5 Owner archive

```json
{ "format": "dms-owner-archive", "version": 1, "kdf": "scrypt", "N": 131072, "r": 8, "p": 1,
  "salt": "0x… (16 bytes)", "nonce": "0x… (12 bytes)", "ciphertext_b64": "…" }
```

Key = scrypt(passphrase, salt, N, r, p, 32); `AES-256-GCM(key, nonce, aad = "DMS-v2/archive")` over the UTF-8 JSON
`{ network, T, I, K, sender_label, rhythm, letters: [bundles of §4.1], recipients: [{index, name, language, email,
link}] }`.

### 4.6 Configuration

`config/<network>.json`, fetched at runtime by the app from `/app/config/<network>.json` (a copy made by
`scripts/sync-config.sh`, so changing the fee is: edit the file, run the script, commit, `git pull` on the VPS):

| Key | testnet | mainnet | Meaning |
|---|---|---|---|
| `enabled` | true | false | network usable |
| `organiser_fee_ckb` | 70 | 70 | fee per Create; must be ≥ the occupied capacity of the organiser output (61 CKB for a secp256k1 address, 63 for JoyID) |
| `organiser_address` | `ckt1…` | `ckb1…` | the operator's address; placeholder fails the build |
| `default_t`, `default_n` | 1, 1 | 5, 8 | guardian defaults before clamping |
| `n_min`, `n_max` | 1, 16 | 3, 16 | guardian range |
| `require_deposited_valid` | false | true | runner filter (CRT §9) |
| `rhythms_months` | [1, 3, 6, 12] | same | rhythm presets |
| `drill` | `{ "min_minutes": 30, "max_hours": 48, "presets_minutes": [30, 60, 180, 720, 1440, 2880], "heartbeat_blocks": 1000 }` | `null` | fire drill |
| `heartbeat_presets_blocks` | [1000, 4000, 8000, 56000] | same | check interval presets |
| `default_heartbeat_blocks`, `default_heartbeat_tip_ckb` | 8000, 0.5 | same | defaults |
| `max_vault_bytes` | 26 214 400 | same | per vault, encrypted |
| `max_recipients` | 10 | 10 | |
| `notifier_url` | `/api/v1` | `/api/v1` | messenger API (same origin); `null` disables the messenger |
| `crt_deployment_url`, `crt_runners_url` | `/app/deployments/testnet.json`, `…/testnet-runners.json` | mainnet files | vendored CRT files; a missing runner list is `[]` |
| `faucet_url` | `https://faucet.nervos.org/` | — | testnet only |
| `app_url` | `https://dead-man-switch.chainsolution.net` | same | |
| `operator_contact` | `https://psawyer.de` | same | shown on the privacy page |

## 5. The notifier ("messenger")

A small Node 22 TypeScript service in `notifier/`, deployed as a container next to the web server on the VPS and
reached at `/api/v1` on the app's origin. It is optional for owners and holds as little as possible.

### 5.1 What it knows

| Data | Before release | After release |
|---|---|---|
| Owner email, recipients' names and emails | yes (encrypted at rest with the server key) | yes, until deletion |
| Descriptor, envelopes | yes (useless without released keys) | yes |
| Links | only ciphertext | decrypts them to send the emails |
| `K` | never | recovers it from the chain, keeps it only in memory while sending |
| Letters, vaults | never | never |

### 5.2 API (JSON, `/api/v1`)

| Method and path | Auth | Purpose |
|---|---|---|
| `POST /claim` `{network, T, admin_hash}` | none | reserve `T` before Create is sent; 409 if claimed; a claim whose `T` is not live on chain within 2 h expires |
| `PUT /switch/:network/:T` record of §4.4 | `Authorization: Bearer <A>` | create or replace; checked against the chain: switch armed, descriptor hash equals the Node Cells' (CRT `verifyNodes`), `I` matches; triggers the "told now" emails and the owner's confirmation email |
| `GET /switch/:network/:T` | Bearer | the record without decrypting anything, plus confirmation states and the event timeline |
| `PATCH /switch/:network/:T` | Bearer | change emails, languages, reminders, `tell_now` |
| `DELETE /switch/:network/:T` | Bearer | delete everything now |
| `GET /confirm/:token`, `GET /stop/:token` | token in the email | confirm an address for one switch; stop all emails to it for that switch, or (button on the page) for every switch |
| `GET /health` | none | `{ok, networks: {testnet: {tip, lag_s}}}` |

All mail-visible pages are small server-rendered HTML in the address's language, no scripts. Rate limits: 30
requests per minute per IP; 5 claims per hour per IP; at most 3 confirmation emails per address per 7 days across
all switches; `max_recipients` per switch. Addresses that chose "never" are kept only as an HMAC.

### 5.3 Watcher

Every 5 minutes per network, for each active record, the watcher reads the switch (`readSwitch`, chain median
time) and decides, with an **outbox** (unique per record, kind, address, step) so that a restart never sends twice:

* **Reminders to the owner** (if confirmed): 14 days, 3 days and 1 day before the deadline; for terms ≤ 2 days
  (drills) at 50 % of the term and at the deadline. A check-in moves the deadline; the next reminders follow it.
* **Grace alarms**: at the deadline, +12 h, +20 h, +23 h: "Your letters open in N hours. Check in now:" with the
  phone check-in link. Not sent after a guardian has released.
* **Release**: when ≥ `t` releases are readable, `recoverOnline` (CRT) → `K` → for each recipient `K_link(r)` →
  decrypt the link → the release email (§3.3.3); then the owner's delivery report. `K` is zeroed after the loop.
* **Cancelled**: one email to the owner ("cancelled; the messenger deleted the data"), then the record is deleted.
* Retention: delivered records 30 days after the last email, drills 7 days, then deleted; a tombstone
  (`network`, `T`, final state, dates) remains so a second `PUT` is refused.

### 5.4 Email

SMTP through `nodemailer` (implicit TLS on 465 or STARTTLS on 587), sender `MAIL_FROM` = `dead-man-switch <dead-man-switch_noreply@chainsolution.psawyer.de>` (a Strato mailbox; Strato refuses a sender address other than the authenticated mailbox, so the notifier refuses to start when the address in `MAIL_FROM` differs from `SMTP_USER`). Plain text plus
a simple HTML part, the three languages, no remote images, no tracking, a stop link in every email.
`List-Unsubscribe` header. Subject prefix for drills (§3.4). Templates are code, tested in the three languages.

### 5.5 Operation

Configuration by environment (`notifier/.env.example`, the real file lives outside the repository):
`NOTIFIER_DATA_KEY` (32 bytes hex, encrypts personal data at rest), `SMTP_HOST` (`smtp.strato.de`), `SMTP_PORT` (465), `SMTP_USER`, `SMTP_PASS` (separate variables, so nothing needs URL-encoding), `MAIL_FROM`, `APP_URL`,
`RPC_TESTNET`, `RPC_MAINNET`, `NETWORKS` (`testnet` now). Storage: SQLite through `node:sqlite` in `/data`. Logs:
JSON lines, never an email address, a name, a link or a token (a test greps the logs of the test run). Container:
`notifier/Dockerfile` (node:22-slim, non-root), `notifier/compose.yaml` (service `dms-notifier`, port 8787 inside
the web server's Docker network, volume for `/data`).

## 6. Internationalisation

* `app/src/i18n/{en,fr,de}.json`, flat keys, ICU-style plurals (`{count, plural, one {…} other {…}}`), loaded at
  build time. The same files are bundled into the vault opener; the notifier has its own
  `notifier/src/i18n/{en,fr,de}.json` for emails and its pages.
* Language = `?lang=` → `localStorage` → `navigator.languages` → `en`. Switch in the header; remembered;
  `<html lang>` follows. Each recipient has their own language for vault and emails.
* Dates and numbers through `Intl` with the active locale; CKB amounts with thin-space thousands separators; the
  chain's median time labelled "chain time" when it differs from the wall clock by more than 10 minutes.
* Every user-facing string is a key; a test fails on hard-coded strings in `app/src/**/*.ts` outside the i18n
  files (heuristic in the acceptance tests). The three files of each set have identical key sets.
* The vocabulary of §2 is fixed; the maintainer's translations take precedence over any machine translation; keys
  the worker adds are listed in `DECISIONS.md` for review.

## 7. Security and privacy

* Plaintext letters, `K`, bundles and vaults exist only in the browser's memory and in the downloaded files (and,
  if chosen, in the passphrase-encrypted owner archive).
* No telemetry, no analytics, no third-party scripts, no fonts from a CDN (fonts are self-hosted). CSP: see
  `deploy/README.md`.
* The operator receives the organiser fee as an ordinary output and, through the messenger, the email addresses
  the owner chose to give. The operator cannot read, delay, open or cancel a letter, and cannot read a link before
  release.
* Spam and abuse: claims require the switch to appear on chain; recipients' first email asks for confirmation;
  per-address limits; "never" list; drills only email confirmed addresses.
* Privacy page `#/privacy` (three languages): what the messenger stores, for how long, how to delete it (Cancel,
  or `DELETE`, or the stop link), the operator's contact (`config` key `operator_contact`).
* Everything CRT §12 lists as not defended against is shown once, in the owner's language, on the guardian screen
  (short) and on the site's FAQ (long).

## 8. Look and feel

The app deals with death, loss and trust. It is **calm, warm and exact**: a letter, a seal, a promise; never
fear, urgency theatre or dark patterns.

* **Metaphor**: paper and ink. Screens are sheets on a warm background; the Write flow is a letter on its way
  (stepper with small icons: pen, people, calendar, shield, coin, seal, hand); the switch card is an envelope with
  a countdown ring as its stamp.
* **Colour tokens** (CSS custom properties in `app/src/ui/tokens.css`; dark mode through `prefers-color-scheme`
  and a toggle):

  | Token | Light | Dark | Use |
  |---|---|---|---|
  | `--paper` | `#F7F3EA` | `#14171F` | background |
  | `--sheet` | `#FFFDF8` | `#1C2030` | cards, dialogs |
  | `--ink` | `#1C2333` | `#ECE6D8` | text |
  | `--ink-soft` | `#4A5468` | `#B4AE9F` | secondary text |
  | `--line` | `#E2D9C6` | `#2C3246` | borders |
  | `--seal` | `#9E2B25` | `#E0675E` | primary actions, the wax seal |
  | `--seal-ink` | `#FFFFFF` | `#14171F` | text on `--seal` |
  | `--gold` | `#8A6A2C` | `#D2B26B` | accents, the ring |
  | `--ok` | `#2F6B4F` | `#7FC6A1` | healthy, confirmed |
  | `--warn` | `#8F5A0B` | `#E8B25A` | last 10 %, drill ribbon |
  | `--danger` | `#9E2B25` | `#F08A80` | grace, cancel |

  Every text/background pair used must reach WCAG AA (4.5:1, 3:1 for large text); a test computes the ratios.
* **Type**: headings in a self-hosted serif (Fraunces or Source Serif 4, OFL, variable, woff2, from an npm
  `@fontsource` package copied at build time), body in the system UI stack, `T` and amounts in a monospace stack.
  Scale 1.25; body 17 px; line length ≤ 70 ch for letters.
* **Space and shape**: 8 px grid, radius 14 px on sheets, 999 px on buttons, soft two-layer shadows; generous white
  space; one primary action per screen.
* **Signature moments**: the **seal** (an original SVG wax seal with a monogram, pressed with a short scale and
  blur animation, 600 ms, skipped under `prefers-reduced-motion`); the **countdown ring**; the **guardian
  constellation** (guardians as points on a soft circle, lines to the letter; a missing guardian fades); the
  **check-in** confirmation (the ring refills).
* **Illustrations**: a small set of original line drawings (letter, envelope, keys, people, calendar), stroke
  `--ink-soft`, no stock art, no faces.
* **Mobile first**: the check-in page and My switches work one-handed at 360 px; touch targets ≥ 44 px.
* **Accessibility**: keyboard everywhere, visible focus (2 px `--gold` ring), every control labelled, progress in
  `aria-live`, no information by colour alone (ring has text, states have icons).
* **Copy**: short sentences, second person, no jargon outside the details panel; the same voice in the three
  languages.

## 9. Components

| Directory | Contents |
|---|---|
| `app/` | Vite + TypeScript, no UI framework; `src/core` (bundle, keys, links, vault, archive, config, price, calendar, qr, templates, messenger client), `src/ui` (screens, tokens), `src/i18n`, `src/opener` (appended to vaults; also built standalone for tests) |
| `notifier/` | the messenger service (§5), its tests, Dockerfile and compose file |
| `site/` | the explainer website in three languages (deploy root; `site/app/` receives the build and is committed: the VPS serves `site/` from a `git pull`) |
| `config/` | per-network application configuration (§4.6) |
| `deploy/` | Caddy snippet, CSP, deployment notes for the VPS |
| `spec/vectors/` | test vectors (keys) |
| `test/` | end-to-end tests (devnet via CRT's `scripts/devnet-e2e.sh`) |
| `aiworker/`, `acceptance/` | build specs and their acceptance tests |

Runtime dependencies allowed in `app/`: `@crt/client` (from the CRT repository, built from `.refs/crt`, commit
recorded), `@ckb-ccc/core` and CCC's JoyID connector, `@noble/*`, a small sanitising Markdown renderer (`marked` +
`DOMPurify`, or `micromark` + a safe schema), `qrcode-generator`, `fflate` (the `.zip` of vaults). In `notifier/`:
`@crt/client`, `@ckb-ccc/core`, `@noble/*`, `nodemailer`. Each choice recorded in `DECISIONS.md`.
