# Decisions log (AI worker)

Newest spec first. One `##` section per spec, one bullet per decision (`AIWORKER.md` §5).

## dms-ui, phase 1 (shell and design system)

- 2026-11-15 — Files: `app/index.html` + `app/src/main.ts` (entry), `src/ui/tokens.css` (the §8 colours written once per
  theme as `#RRGGBB`, 8 px spacing `--s-*`, radii, two shadows, type scale 1.25 from 17 px, `--touch: 44px`, `--t-seal:
  600ms`), `src/ui/base.css`, `src/ui/components.css`, `src/ui/dom.ts` (`h`/`s` helpers, text only through
  textContent), `src/ui/a11y.ts`, `src/ui/theme.ts`, `src/ui/router.ts`, `src/ui/network.ts`, `src/ui/wallet.ts`,
  `src/ui/header.ts`, `src/ui/shell.ts`, `src/ui/screens/{home,placeholder}.ts`, `src/ui/components/*`,
  `src/ui/illustrations/*`. Tests in `app/test/ui.test.ts` (jsdom per file), including `ui_contrast_tokens`.
- Dark mode: `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])` plus `:root[data-theme="dark"]`, so the
  toggle (system / light / dark, `localStorage` key `dms.theme`) can force either. `public/theme-init.js` applies the
  remembered theme before the first paint; a file, not an inline script, so the CSP can forbid inline scripts.
- Font: Fraunces (`@fontsource-variable/fraunces`, dev dependency, OFL), imported as `wght.css` from `main.ts`; Vite copies
  its woff2 files into `assets/` (`font-display: swap` comes with fontsource). All three subsets ship (the browser loads
  only what `unicode-range` needs). The opener keeps a system serif (no font files in vaults).
- `ui_contrast_tokens` reads the palettes from `tokens.css` (`parseTokens`), checks them against the §8 table, checks
  every pair of `COLOUR_PAIRS` (a11y.ts) in both themes (4.5:1, 3:1 for the ring stroke / focus ring), and checks that
  every CSS rule setting both `color` and `background` to tokens uses a listed pair. All pass; the tightest is `--gold`
  on `--paper` in light (4.54, used only for non-text). The drill ribbon is `--seal-ink` on `--warn` (5.78 / 9.34).
  Text is never set on `--line`. Disabled controls do not use opacity (that would break the ratios); the greyed
  mainnet badge is `--ink-soft`, dashed and struck through.
- Stepper: seven steps `letters, recipients, rhythm, guardians, price, seal, handover` with original icons pen, people,
  calendar, shield, coin, seal, hand. The route `#/write/create` (phase 2) shows the `seal` step as current: creating the
  switch is the first half of sealing. Done steps become links back; on narrow screens only the current step's name is
  shown (all names stay in the accessibility tree).
- Seal: original procedural wax outline (`waxPath`, three sine wobbles), embossed rims and rays, monogram = first letters
  of the first and last word of the sender's name. `press()` adds `dms-seal--pressing` for 600 ms; under
  `prefers-reduced-motion` it adds nothing and returns false (and the CSS disables the animation as well).
- Dialog: a plain `role="dialog" aria-modal` element (not `<dialog>`, which jsdom does not fully support), focus trap
  (`trapFocus` in a11y.ts), Escape / backdrop / × close it unless `dismissible: false`, focus returns to the opener.
  Toasts: one polite `role=status` region, errors in a separate assertive region and stay until closed.
- Router: fixed hash routes plus `#/write/<step>` and `#/guide/<place>` (parameter `[a-z0-9_-]+`); trailing slash
  ignored; anything else is a not-found screen. On a route change focus moves to `<main>` and `document.title` follows
  the screen's `<h1>`. Routes of phases 2–3 render a placeholder sheet (title + `shell.coming_soon`); the drill routes
  already show the ribbon, `#/write` the stepper.
- Network: testnet always; mainnet becomes selectable only if `config/mainnet.json` validates and has `enabled: true`.
  Otherwise its badge is greyed, `aria-disabled`, and described by `app.network.mainnet_disabled` (§3.8 text).
- Wallet: CCC with JoyID's CKB signer (`@ckb-ccc/joy-id` 1.2.6, same CCC core 1.23.0; JoyID is the only connector
  shipped, so "JoyID first" means connect goes straight to it). Both CCC modules are dynamically imported (own chunk),
  so tests, shell and opener never load them. `Wallet` keeps status / address / balance, restores a remembered JoyID
  session silently at start, and survives the header being rebuilt on a language change. The faucet link (testnet
  `faucet_url`) is shown next to the wallet. The CCC client uses CCC's public endpoints for now; phase 2 passes the
  CRT deployment's RPC URL through `cccDriver`'s `rpcUrl`.
- Open for phase 4: the built CCC/JoyID chunk contains library URLs outside the acceptance allow-list
  (`cota.nervina.dev` = JoyID sub-key aggregator, `testnet/mainnet.ckbapp.dev` = CCC fallback RPCs, and documentation
  links to `api.ckbccc.com` and `nervosnetwork.github.io` in error messages). They must be dealt with when the build is
  finished (explicit RPC URLs, and a build step for the strings that are never requested).
- `npm run build` was run so that `site/app/` holds the shell and the font files (it replaces the "not deployed yet"
  placeholder page).
- CRT reference clone `.refs/crt` at commit 8572f1f.
- i18n keys added (en, fr, de; for the maintainer's review): `app.network.label`, `app.network.mainnet`, `theme.label`,
  `theme.system`, `theme.light`, `theme.dark`, `wallet.connecting`, `wallet.connected`, `wallet.error`,
  `wallet.balance_unknown`, `nav.label`, `nav.guide`, `nav.home`, `shell.skip`, `shell.coming_soon`, `shell.not_found`,
  `shell.footer_note`, `home.lead`, `home.write_note`, `home.mine_note`, `home.drill_note`, `home.recipient_title`,
  `home.recipient_note`, `step.letters`, `step.recipients`, `step.rhythm`, `step.guardians`, `step.price`, `step.seal`,
  `step.handover`, `stepper.label`, `stepper.status`, `stepper.done`, `seal.monogram_label`, `constellation.label`,
  `constellation.missing`, `constellation.mandatory`, `toast.region`, `ring.label`, `guide.title`.

## dms-notifier, maintainer review (2026-11-15)

- Address-HMAC key moved into a `meta` table (schema 2), sealed under `NOTIFIER_DATA_KEY`, with the v1 value. Before,
  it was derived from the data key, so `rotate-key.mjs` invalidated the never list (people who chose "never" would be
  emailed again) and every stop link already sent. Rotation now re-seals only that key; tests
  `rotate_keeps_never_list_and_stop_links`, `rotate_refuses_wrong_old_key_and_changes_nothing`,
  `v1_database_keeps_its_address_hmacs`. A wrong data key is now refused when the store opens.
- Dockerfile: builds `@crt/client` in its own stage (no Node on the VPS), copies `notifier/.npmrc` (without it `npm ci`
  on npm 10 rejects the lockfile), loads CRT's `deployments/` instead of the app's `config/` (which made startup fail),
  no `|| true` around the build. Runtime stage reproduced by hand: starts, `/api/v1/health` answers.
- eslint: Node globals (`globals` dev dependency); `npm run lint` was failing on `scripts/rotate-key.mjs`.

## dms-notifier, phase 4 (container and docs)

- 2026-11-15 — The image is built from the repository root (`context: ..`) because `@crt/client` is a file dependency in `.refs/crt/client` (must be built beforehand); it is copied to `/.refs/crt/client` in both stages so `../.refs` resolves from `/src/notifier` and `/app`. `config/*.json` become `/app/deployments`.
- `scripts/rotate-key.mjs` lives in `notifier/scripts/`, is self-contained (no build needed) and runs in one transaction. The never list holds only HMACs, so it cannot be re-keyed: entries are kept but stop matching; the script and docs say so.
- Compose joins the external network under the service-local name `web`, named by `${WEB_NETWORK:-vericell_default}`.

## dms-notifier, phase 3 (the watcher and the emails)

- 2026-11-15 — Files: `src/watcher.ts` (`createWatcher` → `tick(network)`, `status()` for `/health`), `src/log.ts` (JSON lines, `redact`, `setLogSink` for tests), `src/chain.ts` (`CrtChain` over `@crt/client`: `readSwitch`, `recoverOnline`, tip header), `src/main.ts` (env → store → API + watcher; one tick at start, then every 5 min, never two at once; `expireClaims` runs with each tick; SIGTERM closes cleanly), the watcher's emails and `SmtpMailer` (nodemailer) in `src/mail.ts`. Tests in `test/watcher.test.ts`.
- Outbox: each send is found or recorded first, then `markAttempt`, send, `markDone`. A row that was attempted but never marked done (a crash, or an SMTP error) is retried on the next tick, and only once (`attempts < 2`). The step carries the deadline (`14d@<deadline>`, `half@…`, `12h@…`), so after a check-in the reminders follow the new deadline and a restart never sends anything twice. The API's confirmation emails that did not finish are retried by the watcher once they are more than one tick old, so a request still in flight is never sent twice.
- Decisions use the chain's median time (`SwitchState.medianTime`; the clock only if that is 0). If several reminder steps are already due (the service was down), only the latest is sent. The term is the record's `rhythm` (years count as 365 d, months as 30 d). A drill, or any term ≤ 2 days, gets reminders at 50 % and at the deadline instead of 14/3/1 days. Drills get grace alarms at +0/+12/+20 h; real switches also get one at +23 h. Alarms stop once any guardian has released (`releases > 0`).
- The owner gets reminders and alarms only when the address is confirmed, `owner.reminders` is on, and the address is not stopped or on the never list. `reminders: false` turns off alarms as well, because the owner opted out of the messenger's warnings (they may use the calendar file).
- Release: needs ≥ `piecesNeeded(descriptor.access_tree)` releases (`t` for a threshold tree, the sum over the groups for an xor tree, as in the opener), with `SwitchState.t` as the fallback. The real chain cannot know `t` without the descriptor and returns 0. A link that does not decrypt, or is not https, gives the no-link email and a `link_unreadable` event. `K.fill(0)` runs in a `finally`. The owner's report (names plus sent / not sent, never links) goes out after every recipient's send has settled; then the switch state becomes `delivered` and the chain is not read for it again. A failed recovery writes one `recover_failed` event and is tried again on every tick.
- Who gets the release email: confirmed recipients, plus unconfirmed ones that are not stopped and not on the never list (one email, since recipients get nothing else unless they confirmed). A drill sends it to confirmed recipients only. Skipped recipients get a `release_skipped` event (written once, using a done outbox row as the marker).
- Cancel: the owner email first (if confirmed), then `deleteSwitch` with tombstone `cancelled`, also for drills. §5.3 ("then the record is deleted") wins over §3.4's 7 days. A failed send keeps the record for its one retry. A stored switch the chain reports as `absent` on two consecutive reads is treated as cancelled, so one flaky indexer answer deletes nothing. `inconsistent` Node Cells are a read error (logged, skipped).
- Retention: a `delivered` record is deleted 30 days after max(last email, release); a drill 7 days after its release. The tombstone (`delivered`, created, ended) then refuses a new claim or PUT.
- Stop links: the stop token is now derived (HMAC under the server key over address id, switch, role, index and address HMAC; only its SHA-256 is stored), so every email to an address, including the phase 2 confirmation emails, carries the same working stop link. Confirm tokens stay random.
- Dates in emails: `Intl.DateTimeFormat(lang, {dateStyle: long, timeStyle: short, timeZone: UTC})` plus "UTC". The phone check-in link `<APP_URL>/app/#/checkin?network=&T=&rhythm=` is in every reminder and alarm.
- Logs: switches are logged as `0x` plus 8 hex digits; addresses as `owner` or `recipient N`; names never. `redact` then removes anything shaped like an email, a URL, a 64-hex value, an owner code or a 43-character base64url token. The API logs unexpected errors. `LOG_LEVEL` is optional.
- New optional env `CRT_DEPLOYMENTS_DIR` (default `deployments`; `.env.example` suggests `/app/deployments` for the container, phase 4) for CRT's `<network>.json`. `Chain` gets an optional `tip(network)` for `/health`. `api.ts` gets a `ROUTES` table (for the 404 message, and so the acceptance test finds the route paths).
- i18n keys added (for the maintainer's review): `reminder_subject_one`, `alarm_subject_one`, `report_line_sent`, `report_line_not_sent`, `deadline_utc` (en, fr, de).

## dms-notifier, phase 2 (the API)

- 2026-11-15 — Files: `src/api.ts` (`createApi`/`createServer`, routes, rate limiter, pages), `src/interfaces.ts` (`Clock`, `Chain`, `Mailer`, `SwitchState`), `src/record.ts` (strict validation of the §4.4 record and the PATCH body), `src/i18n.ts` (`t()`, JSON imported with `with { type: 'json' }`), and a first `src/mail.ts` with the two confirmation emails (owner, "told now") plus `compose()` (text + HTML, stop link, `List-Unsubscribe`, drill prefix); phase 3 adds the watcher's emails there.
- Descriptor check: the API computes `descriptorHash(record.descriptor)` with `@crt/client` (it loads from `dist/` in Node) and compares it, and `I`, with what `Chain.switchState` returns from the Node Cells (the real `Chain`, phase 3, fills it through `verifyNodes`). Only state `armed` is accepted; anything else is `not_on_chain`; a chain read error is 502 `not_on_chain`.
- Status codes: claim 201, PUT 201 (new) / 200 (replaced), 400 `bad_request`, 401 `unauthorized`, 409 `conflict`, 422 `not_on_chain`/`mismatch`, 429 `rate_limited` (+ `Retry-After`), 413 `too_large`. Unknown routes, wrong methods and "no record yet" use `bad_request` with 404/405, since the code list is fixed.
- Bearer `A` is accepted as the full owner code `dms1-<network>-<T8>-<A base64url>`, the bare base64url, or 32-byte hex; `SHA-256(A)` is compared in constant time with the claim's `admin_hash` (stored as lower-case hex without `0x`). The claim stays as the authorisation of the switch; `T`/`I` are normalised to lower-case `0x` hex.
- Claim expiry: a claim older than 2 h without a record is deleted when the chain says `absent` (pending/committed count as live); done lazily on `POST /claim` and `PUT`, and by `api.expireClaims()` for the watcher.
- `DELETE` removes everything and leaves a tombstone with state `deleted`, so the `T` cannot be claimed or PUT again by anyone.
- The record is strict: unknown fields are refused (so `K` or a clear link cannot be stored by mistake); ≥ 1 recipient; names and `sender_label` 1–100 characters without control characters; emails by a conservative syntax check (no CR/LF); `rhythm` an ISO 8601 duration; `tell_now` forced on for drills (also in PATCH). PATCH accepts only `owner.{email,language,reminders}` and `recipients[].{index,email,language,tell_now}`.
- Confirmation emails are sent right after PUT/PATCH for addresses in state `none` (owner always, recipients with `tell_now`): outbox row first (kind `owner_confirm`/`told_now`, step = 16 hex of the address HMAC so a changed email is asked again and an unchanged one never twice), then new confirm/stop tokens (32 random bytes base64url, only SHA-256 stored), send, mark done. A failed send stays pending for the watcher. Skipped for "never"/stopped addresses and beyond 3 confirmation emails per address per 7 days (event `confirm_skipped`, detail without personal data).
- Pages: `GET /confirm/:token` → confirmed; `GET /stop/:token` → stopped for this switch, with a POST form to the same URL that adds the address HMAC to `never`. Language of the address; unknown tokens get a 404 page in the `Accept-Language` language. CSP `default-src 'none'`, no scripts, `noindex`.
- Rate limits in memory (sliding window): 30 requests/min per IP for every route except `/health`, 5 claims/hour per IP. With `TRUST_PROXY=1` the right-most `X-Forwarded-For` entry (the one the reverse proxy appended) is the client IP.
- `/health` returns `{ok, networks: {<n>: {tip, lag_s}}}` from an optional `status()` provider (the watcher supplies it in phase 3); `null`s until then.
- No new i18n keys: the owner's confirmation email reuses `told_now_confirm` ("Confirm: {url}").

## dms-notifier, phase 1 (package, store, configuration)

- 2026-11-15 — `notifier/` is its own ESM package; runtime deps only `@crt/client` (file dependency on `.refs/crt/client`, `install-links=true`) and `nodemailer`. Crypto uses `node:crypto` (HKDF, AES-256-GCM, HMAC), so no `@noble/*` is needed.
- Tests run as `node --import tsx --test --test-reporter=tap test/*.test.ts`; imports use `.ts` extensions (`rewriteRelativeImportExtensions`, build via `tsconfig.build.json`).
- Store: schema version in `PRAGMA user_version`, migrations in an array. The record JSON, emails and names are sealed (`v1.` + base64 of nonce ‖ ct ‖ tag, AAD = network/T/field, so values cannot be swapped between rows). Tokens are SHA-256 hashes; addresses are looked up by HMAC (key derived from `NOTIFIER_DATA_KEY`), also used for the `never` list and the 3-confirmations-per-7-days count. Language and confirmation state are stored in clear (not personal). `events.detail` must hold no personal data.
- Outbox: `enqueue` records before sending and returns `undefined` for a duplicate key; rows are retried while `attempts < 2` (one retry after a crash, never more). Address id 0 is used for owner-less steps.
- `syncAddresses` keeps id, tokens and confirmation for an unchanged (role, index, email); a changed email resets them. The owner is stored as role `owner`, index 0.
- `env.ts`: also reads optional `PORT` (8787), `DATA_DIR` (/data), `TRUST_PROXY`; `RPC_<NETWORK>` is required for each network in `NETWORKS`; 465 → implicit TLS, 587 → STARTTLS required; `MAIL_FROM` address must equal `SMTP_USER` (case-insensitive).
- i18n: flat keys with `{placeholder}`s, identical keys and placeholders in en/fr/de. The strings cover owner confirmation, told-now, reminder (also drill), alarm, release, delivery report, cancel and the confirm/stop/never pages. Keys for the maintainer's review of translations: all of them (machine-written).
- `src/api.ts`, `watcher.ts`, `mail.ts`, `log.ts`, `main.ts` belong to phases 2–3 and are not created yet; `acceptance/.../wiring.test.mjs` fails until then.

## dms-core, phase 4 (documentation)

- 2026-11-15 — `docs/formats.md` links SPEC §4 to code and tests instead of copying it; `app/README.md` and CHANGELOG added.

## dms-core, phase 3 (the opener)

- 2026-11-15 — Files: `app/src/opener/index.ts` (IIFE entry), `opener.ts` (`installOpener(window)`: hook, UI, decrypt),
  `markdown.ts` (marked + DOMPurify), `styles.ts` (inline CSS). The opener imports only `core/aead`, `core/bundle`,
  `core/bytes`, `core/i18n`, `core/keys` (no `@crt/client`): built bundle ≈ 153 KB minified with the three languages.
- Build: `OPENER=1 vite build` (`npm run build:opener`) writes `app/dist/opener.js` as the phase says (phase 1 used
  `dist-opener/`); `emptyOutDir: false`, and `npm run build` runs it after the app build, which empties `dist/`.
  `vite.config.ts` also exports `buildOpener()` (in-memory build, used by the tests) and a `virtual:dms-opener`
  plugin, so the app can `import opener from 'virtual:dms-opener'` and call `setOpenerScript` (types in
  `src/opener/virtual.d.ts`). The default vault script stays the phase 2 stub until the UI does that.
- A final-chunk plugin rewrites `</script` → `<\/script` and `<!--` → `\x3C!--` (DOMPurify's source contains `<!-->`,
  which would put an inline `<script>` into the HTML parser's escaped state). Both rewrites are equivalent in JS
  strings and regular expressions; the test asserts neither appears.
- `window.crtApplication = { onKey }` is set synchronously when the script is evaluated; the UI mounts on
  `DOMContentLoaded` (after the kit's own `wire`, which ran its self-verification), moves `#crt-application` to the
  top of `<body>` and leaves the kit's certificate and tools below (a note says the certificate is not needed).
  `onKey` never throws (the kit's `recover` would then report a failure over the opener's own message); it resolves
  to `true`/`false`. It accepts bytes or `0x` hex.
- Integrity is read from the kit's `#crt-verify` banner (class `match`/`mismatch`); online, `readSwitch` adds the
  chain comparison (`descriptorHashMatches`). The opener reads the chain once on open (not in practice mode) and on
  "Check the chain". The "opens if … by <deadline>" date is the chain's deadline when known, otherwise the deadline
  printed on the kit's certificate (the `Deadline` row; the payload of §4.3 has no deadline field).
- Status order: `released ≥ needed` → released (+ "Open the letter" = `CRT_KIT.api.recover()`, the kit then calls
  `onKey`); Alive Cell gone → cancelled (the chain read gives no cancel date, so `open.status.cancelled_undated`); some
  released → `open.short`; else not yet. Pieces needed: `t` of a threshold tree, the sum of the groups' `t` for an
  xor tree. A failed recovery with CRT's `RecoveryError.report` names each guardian whose piece is wrong
  (`bad-privkey`, `commitment-mismatch`; label from the descriptor, else `R` shortened) and explains the margin.
- Practice: `window.DMS_PRACTICE = true` shows `open.practice` on the screen, skips the chain, and opens with
  `window.DMS_PRACTICE_KEY` (hex or bytes) or the text of an element `#dms-practice-key`.
- Markdown: raw HTML tokens are rendered as escaped text, images as their alt text; DOMPurify (own instance per
  window) allows headings, paragraphs, emphasis, lists, links, code, blockquotes, tables and disabled task-list
  check boxes; URIs `http(s):`/`mailto:` only; links get `rel="noopener noreferrer" target="_blank"`.
- Files: one object URL per file at opening (`Blob` of the decoded bytes); HTML/SVG/XML/JS MIME types are downloaded
  as `application/octet-stream`; the `download` name is the last path segment without control characters. Sizes
  through `formatBytes` (new in `core/i18n.ts`, `Intl` units, no strings). Print: once open, `@media print` shows
  the letter alone (overriding the kit's rule that hides `#crt-application`).
- Errors are i18n sentences only: `open.error.key_length`, `open.error.decrypt` (wrong key, wrong recipient, altered
  data, invalid bundle), `open.error.version`, `open.error.not_vault`, `open.error.recover`, `error.rpc`.
- Tests: the six fixed names, plus `opener_chain_status_and_recovery` and `opener_bundle_runs_in_vault` (the built
  bundle inside a real vault in JSDOM with scripts enabled: the kit runs, the hook is registered, the letter opens).
  `test/jsdom.d.ts` declares the few jsdom types used (`@types/jsdom` is not installed).
- i18n keys added (for review by the maintainer): `app.language_name` (English / Français / Deutsch),
  `open.drill_banner`, `open.integrity.pending`, `open.integrity.chain_match`, `open.integrity.chain_mismatch`,
  `open.status.cancelled_undated`, `open.check`, `open.recover`, `open.paste_button`, `open.practice_open`,
  `open.note`, `open.no_files`, `open.certificate_note`, `open.error.key_length`, `open.error.recover`,
  `open.error.not_vault` (en, fr, de).

## dms-core, phase 2 (core modules)

- 2026-11-15 — `@crt/client` resolves at runtime (Vite/vitest alias) to CRT's TypeScript sources `client/src/index.ts`:
  the built `dist/src/chain/deployment.js` imports `../../vendor/csr-job.mjs`, which `tsc` does not copy into `dist/`,
  so the dist entry cannot load. Types still come from `dist/src/index.d.ts` (`tsconfig.json` `paths`).
- vitest uses the `tap` reporter: every test is printed as `ok n - <name>`, which is what
  `acceptance/aiworker-dms-core/named.mjs` reads (the default reporter prints only file names).
- Byte helpers live in `core/bytes.ts` and AES-GCM in `core/aead.ts` (no import of `@crt/client` in the crypto path,
  so the phase 3 opener stays small). `K`, `I` are accepted as bytes or `0x` hex.
- `encryptBundle` takes a `Letter` or its encoded bytes (the vector plaintext `{"version":2}` is not a full letter) and
  an optional `{maxBytes}` (default 26 214 400, the config's `max_vault_bytes`); the limit applies to the ciphertext
  (plaintext + 16-byte tag) and is checked before encrypting. `decryptBundle` returns the bundle bytes;
  `openBundle` = decrypt + `decodeBundle` + check that the bundle is addressed to `r`. Only `version` 2 decodes.
- `encodeBundle` writes the fields in the fixed order of SPEC §4.1, so the same letter gives the same bytes.
- Links: absolute `https://` URL with a host, ≤ 2048 characters, no whitespace or control characters; checked on
  encryption and again after decryption. Sealed links are `{nonce, ciphertext}` `0x` hex as in the record (§4.4).
- `buildVault` takes `script` optionally; without it the script set by `setOpenerScript` is used (phase 3 sets the
  built opener). Until then the default is a one-line `window.crtApplication` stub. `payload.size` = ciphertext bytes.
- `vaultFileName`: lower case, `ß→ss`, `æ→ae`, `œ→oe`, `ø→o`, then NFKD without marks, other runs → `-`, each part
  at most 40 characters; an empty part becomes `sender` / `recipient`. `zipVaults` uses a fixed mtime (2020-01-01)
  so the zip is deterministic too.
- Messenger: the bearer token is `A` in base64url (as in the owner code); `adminHash` = `0x` hex SHA-256(A).
  `buildRecord` copies only the fields of §4.4 (whatever else the caller passes, e.g. `K` or letters, is dropped),
  checks `T`/`I` against the descriptor, `rhythm` as an ISO 8601 duration, emails syntactically (empty = `null`),
  and requires links to be sealed. `MessengerClient` throws `MessengerError` carrying the HTTP status (409 on claim).
- Archive: `scryptAsync` (non-blocking), passphrase NFC-normalised; `openArchive` accepts the JSON text or object and
  refuses scrypt parameters other than `r = 8, p = 1, 2^14 ≤ N ≤ 2^20` (a crafted file cannot exhaust memory).
  `passphraseStrength`: < 8 characters → 0; 8–11 → 1, 12–15 → 2, 16–19 → 3, ≥ 20 → 4; +1 with ≥ 3 character classes;
  −2 for very few distinct characters, −1 for short repeated patterns. `ARCHIVE_MIN_STRENGTH = 3` for the UI.
- Calendar: `icsForDeadline` takes optional `termSeconds` (the ≤ 2-day rule needs the term), `appUrl` and `now`
  (DTSTAMP, for deterministic tests). The event links to `<app_url>/app/#/checkin?T=`; the description prints the
  deadline in UTC. Drill summaries get the `drill.subject_prefix`.
- i18n: `translate(lang, key, params)` next to `t(key, params)` (vaults, calendar and templates need an explicit
  language); missing keys fall back to English, then to the key. Supported syntax: `{x}`, `plural` (with `=n`,
  CLDR categories through `Intl.PluralRules`, `#`), `select`. Storage key `dms.language`. Numbers use thin-space
  grouping; `formatCkb` takes CKB as a number or shannons as a bigint and appends ` CKB`.
  `formatDuration`: days from 2 days (or whole days), then hours, then minutes.
- Price: `quote` uses CRT's default keygen tip (1 CKB) and max fee (0.002 CKB); `heartbeatTip` is in CKB; block time
  from the deployment's `block_seconds` when present, else CRT's 10.8 s. Each line carries an i18n `key`.
- Drill: `drillOpensAt(deadline, heartbeatBlocks, blockSeconds = 10.8)`: earliest = deadline + 24 h, latest = + one
  check interval (1000 blocks ≈ 3 h). `drillBounds` refuses mainnet even when a config object carries drill settings.
- QR: byte mode over the UTF-8 bytes (the library's default truncates each UTF-16 unit to one byte), error correction
  M, automatic version, 4-module quiet zone, one `<path fill="currentColor">`.
- Chain: `switchSummary` adds the tip's median time (`get_blockchain_info`) and `secondsLeft`; `checkinHistory` reads
  `get_transactions` (node-lock prefix `T`, grouped) — `@crt/client` has no call for it — then each transaction and
  its header; an entry is listed when the Node Cells' deadline increases (first one = `create`, later = `checkin`),
  so runner commits, Arm, releases and rewraps are not counted. The RPC fixture `app/test/fixtures/checkin-rpc.json`
  is synthetic (generated, no node reachable here); `test/fixtures/descriptor.json` is CRT's descriptor vector.
- i18n keys added (for review by the maintainer): `unit.hours`, `unit.minutes`, `ics.alarm_half`,
  `ics.alarm_deadline`, `drill.subject_prefix` (`[Drill]` / `[Exercice]` / `[Probealarm]`, as in SPEC §3.4), and
  `template.<id>.title` / `template.<id>.body` for `legacy_checklist`, `practical_wishes`, `documents`,
  `crypto_assets`, `personal_letter` (en, fr, de).

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
