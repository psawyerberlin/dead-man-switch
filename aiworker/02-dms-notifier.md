# Spec 02 — the messenger service (`dms-notifier`)

**Branch:** `aiworker/dms-notifier`. **Acceptance:** `acceptance/aiworker-dms-notifier/`.
**Normative:** `SPEC.md` §3.2, §3.3, §3.4, §4.2, §4.4, §5, §6, §7. **Depends on:** `@crt/client` built in
`.refs/crt/client`; spec 01 only for the shared vectors (`spec/vectors/keys.json`).

`notifier/` is its own npm package (Node 22, TypeScript strict, ESM), independent of `app/`, with `@crt/client` as a file
dependency (`"@crt/client": "file:../.refs/crt/client"`, built as for `app/`): it re-implements the
two small primitives it needs (`linkKey`, `decryptLink`) and proves them against the same vectors. Everything
that touches the outside world sits behind an interface so the tests run offline:

```ts
interface Clock { now(): number }                       // unix seconds
interface Chain {                                       // real one over @crt/client, fake one in tests
  switchState(network, T): Promise<{ state: 'pending'|'committed'|'armed'|'released'|'cancelled'|'absent',
    deadline?: number, medianTime: number, releases: number, t: number, I?: string, descriptorHash?: string }>
  recoverK(network, descriptor, envelopes): Promise<Uint8Array>   // CRT recoverOnline
}
interface Mailer { send(msg: { to: string, subject: string, text: string, html: string, headers: Record<string,string> }): Promise<void> }
```

## Phase 1 — package, store, configuration

* `notifier/package.json`: scripts `build` (tsc to `dist/`), `start` (`node dist/main.js`), `test` (`node --test`
  through `tsx`, TAP output), `typecheck`, `lint`. Runtime dependencies only those of `SPEC.md` §9.
* `notifier/src/env.ts`: reads and validates the variables of `SPEC.md` §5.5; `notifier/.env.example` with every
  variable and a comment (no values that look like secrets).
* `notifier/src/store.ts` over `node:sqlite`: tables `claims`, `switches` (record JSON and personal fields
  encrypted with AES-256-GCM under `NOTIFIER_DATA_KEY`, one random nonce per value), `addresses` (per switch:
  role owner/recipient, index, confirmation state, confirm and stop tokens as SHA-256 hashes), `outbox`
  (unique `(network, T, kind, address_id, step)`), `events` (timeline shown to the owner), `never` (HMAC of
  addresses that chose "never"), `tombstones`. Schema migrations by version number.
* `notifier/src/crypto.ts`: `linkKey`, `decryptLink` (`SPEC.md` §4.2), `sha256`, `hmac`, `seal/open` for data at
  rest.
* `notifier/src/i18n/{en,fr,de}.json` with identical keys; the subjects and bodies of every email of §3.3, §3.4,
  §5.3 and the confirm/stop pages.

Tests: `store_encrypts_at_rest` (the database file contains no email address, name or link of the fixtures),
`crypto_matches_vectors` (link cases of `../spec/vectors/keys.json`), `i18n_same_keys_in_all_languages`,
`env_rejects_missing_key`.

## Phase 2 — the API

`notifier/src/api.ts` on `node:http` (no framework), mounted at `/api/v1`, JSON in and out, body limit 256 KB,
exactly the routes of `SPEC.md` §5.2:

* `POST /claim`: validates `network` (one of `NETWORKS`), `T` and `admin_hash` (32-byte hex); stores the claim;
  409 when `T` is claimed or has a tombstone; claims whose `T` is not live on chain 2 h after the claim expire.
* `PUT /switch/:network/:T`: bearer `A`, `sha256(A)` must equal the claim's `admin_hash`; validates the record
  (`SPEC.md` §4.4: ≤ `MAX_RECIPIENTS` = 10, indices 1..10 unique, languages en/fr/de, emails syntactically valid,
  links `{nonce 12 bytes, ciphertext ≤ 2048 + 16 bytes}` or null, `drill` only on testnet); asks the chain:
  state `armed`, `I` and descriptor hash match (`verifyNodes`); stores; queues the owner's confirmation email and,
  for recipients with `tell_now` (forced on for drills), the "told now" emails (§3.3.1). Replacing a record keeps
  the confirmation state of unchanged addresses.
* `GET`, `PATCH`, `DELETE` as specified; `GET` returns states and the event timeline, never personal data of
  other switches; `PATCH` accepts only the fields of `SPEC.md` §5.2.
* `GET /confirm/:token`, `GET /stop/:token`: small HTML pages in the address's language, no scripts, a
  "never contact me again" form button (POST) on the stop page.
* `GET /health`.
* Rate limits in memory per IP (`X-Forwarded-For` from the reverse proxy only when `TRUST_PROXY=1`).
* Errors: `{error: code, message}` with codes `bad_request`, `unauthorized`, `conflict`, `not_on_chain`,
  `mismatch`, `rate_limited`, `too_large`.

Tests (fake chain, fake mailer, temporary database): `api_claim_then_put`, `api_rejects_wrong_admin_token`,
`api_rejects_duplicate_claim`, `api_claim_expires`, `api_put_checks_chain` (unknown `T` → `not_on_chain`; wrong
descriptor hash → `mismatch`), `api_rejects_eleven_recipients`, `api_rate_limits`, `api_get_hides_other_switches`,
`confirm_and_stop_tokens`, `never_list_blocks_future_mail`.

## Phase 3 — the watcher and the emails

`notifier/src/watcher.ts`: `tick(network)` runs every 5 minutes (`setInterval` in `main.ts`, the clock injected),
implements `SPEC.md` §5.3 exactly, writes `events` and sends through the **outbox** (a send is recorded before the
mailer is called and marked done after; a crash between both is retried once, never more). `notifier/src/mail.ts`
renders the emails of §3.3.1, §3.3.3, §3.4, §5.3 and §5.4 from the i18n files: plain text and HTML, stop link,
`List-Unsubscribe`, drill prefix, the phone check-in link of `SPEC.md` §3.2 in every reminder and alarm.
`notifier/src/log.ts`: JSON lines with a redaction pass that replaces anything shaped like an email, a URL of a
link, a token or 64-hex secret by `[redacted]`.

Tests: `watcher_sends_reminders_once` (14 d / 3 d / 1 d, a restart does not resend), `watcher_reminders_follow_checkin`
(a later deadline reschedules), `watcher_drill_reminders` (50 % and deadline; subject prefix in the three
languages), `watcher_grace_alarms` (deadline, +12 h, +20 h, +23 h; none after a release),
`watcher_release_decrypts_link_and_mails` (fake `recoverK` returns the vector `K`; the email carries the decrypted
link of the vector; `K` buffer is zeroed after the tick), `watcher_release_unconfirmed_one_mail`,
`watcher_drill_skips_unconfirmed`, `watcher_cancel_deletes_record`, `watcher_retention_and_tombstone`,
`mail_three_languages`, `logs_redact_personal_data` (the log output of the whole test run contains no fixture
email, name, link or token).

## Phase 4 — container and docs

* `notifier/Dockerfile`: `node:22-slim`, `npm ci --omit=dev` after a build stage, runs as the `node` user,
  `EXPOSE 8787`, `HEALTHCHECK` on `/api/v1/health`, data in `/data`.
* `notifier/compose.yaml`: service `dms-notifier`, `env_file: ${DMS_NOTIFIER_ENV:-~/dms-notifier.env}`, volume
  `${DMS_NOTIFIER_DATA:-~/dms-notifier-data}:/data`, no published port, joins the external network named by
  `${WEB_NETWORK:-vericell_default}` (the web server's Docker network), `restart: unless-stopped`.
* `docs/notifier.md`: what it stores and why (the table of `SPEC.md` §5.1, referenced not copied), the API, the
  environment, backup of `/data`, how to rotate `NOTIFIER_DATA_KEY` (a `scripts/rotate-key.mjs` that re-encrypts
  in place), how to read the logs; `CHANGELOG.md`.

## Acceptance

```sh
node --test acceptance/aiworker-dms-notifier/
node acceptance/aiworker-dms-notifier/named.mjs
```
