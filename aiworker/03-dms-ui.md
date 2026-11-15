# Spec 03 — the app: design, write, my switches, open, drill (`dms-ui`)

**Branch:** `aiworker/dms-ui`. **Acceptance:** `acceptance/aiworker-dms-ui/`.
**Normative:** `SPEC.md` §2, §3, §6, §7, §8. **Depends on:** specs 01 and 02 (the messenger API of `SPEC.md`
§5.2; the UI talks to it through `app/src/core/messenger.ts` and is tested against a fake).

The look is part of the deliverable: `SPEC.md` §8 is normative, not decoration. Build the design system first,
then every screen from it.

## Phase 1 — shell and design system

* `app/src/ui/tokens.css`: the colour tokens of `SPEC.md` §8 (light and dark), spacing (8 px grid), radii,
  shadows, type scale; a theme toggle (system / light / dark, remembered).
* Fonts: a variable serif (Fraunces or Source Serif 4) from an `@fontsource-variable/*` **dev** dependency,
  copied as woff2 into the build by Vite; `font-display: swap`; system UI stack for body; monospace stack for ids.
* `app/src/ui/components/`: `button` (primary in `--seal`, secondary, quiet; 44 px min), `sheet`, `field` (label,
  hint, error), `stepper` (the seven Write steps with original line icons), `ring` (SVG countdown ring with text
  inside), `seal` (original SVG wax seal with a monogram and the press animation of `SPEC.md` §8; static under
  `prefers-reduced-motion`), `constellation` (guardians around the letter), `ribbon` (the drill ribbon),
  `dialog` (focus-trapped), `toast` (`aria-live`).
* `app/src/ui/illustrations/`: five original line drawings (letter, envelope, keys, people, calendar) as inline SVG
  using `currentColor`.
* Shell: hash router (`#/`, `#/write`, `#/mine`, `#/checkin`, `#/open`, `#/open/demo`, `#/drill`,
  `#/drill/report`, `#/guide`, `#/privacy`, `#/about`), header with the language switch (en / fr / de, remembered),
  theme toggle, network badge (testnet; mainnet greyed with the `SPEC.md` §3.8 text), wallet connect/disconnect
  through CCC (JoyID connector first), balance, faucet link on testnet. Home `#/`: one sentence of what the app
  does, three entries (write a letter, my switches, try a fire drill on testnet) and the practice-vault link for
  recipients.
* `app/src/ui/a11y.ts`: `contrast(fg, bg)` (WCAG formula) used by the test `ui_contrast_tokens` over every
  text/background pair the components use, in both themes.

## Phase 2 — Write (`SPEC.md` §3.1, §3.3.2, §3.5–§3.7)

Routes `#/write/<step>`: letters → recipients → rhythm → guardians → price → create → seal → handover, with the
stepper always visible. Rules the tests check:

* letters: shared / per recipient / shared + note; live size per vault against `max_vault_bytes`; the template
  picker inserts `templateText(id, language)`;
* recipients: 1..`max_recipients` (`ui_recipients_max_ten`: the eleventh cannot be added), name, language, optional
  email, "tell them now";
* the rhythm screen uses `rhythm.consequence` with the two dates;
* guardians: only CRT runners (`fetchRunners` with the vendored list as `crtList`, `selectRunners` with
  `requireCrt: true` and `requireDepositedValid` from config), `n` limited to `n_min`..min(`n_max`, candidates),
  defaults clamped, count shown (`ui_guardians_clamped`: with one candidate on testnet the default is 1-of-1 and n
  cannot be raised); the constellation; the concentration summary; `guardians.mandatory_trade` when a mandatory
  guardian is added; 1-of-1 needs `guardians.ack_phrase` typed (real switches); check-interval presets
  (`heartbeat.title`, `heartbeat.tradeoff` with the detection delay), tip in the advanced panel, the **live cost
  panel** (`ui_cost_panel_live`: daily → weekly lowers the monthly figure);
* price: organiser fee as its own line (read from config, not editable by the owner), per-month figure; an
  invalid fee config (`organiserFeeCheck`) shows the config error instead of the Create button
  (`ui_fee_below_capacity_refused`);
* create: when the messenger is on, `claim` is called **before** the Create signature with the new owner code's
  hash (`ui_claim_before_create`: the fake messenger sees the claim before the fake signer is asked); progress per
  guardian; hard-fail verification; Arm;
* seal: the seal moment per recipient (`ui_seal_reduced_motion`: no animation class under reduced motion);
  download per vault and as `.zip`; the owner code shown once with copy and print (`ui_owner_code_shown_once`:
  after leaving the screen it is only in localStorage, never rendered again without a click on "show"); owner
  archive with passphrase strength; paper backup per recipient (`qrSvg`); calendar file; the saved checkbox
  gates Next (`ui_seal_checkbox_gates_next`);
* handover: one card per recipient with their vault, the place picker and its tutorial from `#/guide`, the link
  field (https only), then `put` of the record (`buildRecord`), then `K` and the letters are dropped from memory
  unless the archive is open.

`#/guide` and `#/guide/<place>`: the tutorials of `SPEC.md` §3.3.2 for the ten places, three to six steps each,
in the three languages (`ui_handover_guides_three_languages`: every place has the same number of steps in en,
fr and de and no empty step).

## Phase 3 — My switches, check-in, open, drill, privacy

* `#/mine`: cards per `SPEC.md` §3.2 — ring, health sentence (`mine.headroom_sentence` with plurals), timeline
  (`checkinHistory` plus messenger events), recipients with confirmation states, buttons **Check in**, **Away
  until…**, **Messenger settings**, **Change guardians** (needs the archive; otherwise the explanation),
  **Cancel**, **Reclaim**, **Download vaults again** (archive or same session). Cancel: one button, one dialog
  with `cancel.consequence`, one signature, then `remove` at the messenger (`ui_cancel_two_clicks`: reachable in
  ≤ 2 clicks from the list, button not smaller than Check in). "Add by T" and "restore from owner code".
* `#/checkin?network=&T=&rhythm=`: the one-screen phone page (`ui_checkin_deeplink`: parses the three
  parameters, shows the new deadline = chain time + rhythm, refuses a wallet that is not the owner with
  `checkin.not_owner`).
* Away until: date picker, earliest tomorrow, latest 5 years (`ui_away_until`: the Renew deadline equals the chosen
  date at 12:00 local time converted to unix seconds).
* `#/open`: drop zone for a vault file (and `?T=` for status only) → runs the opener bundle in the page.
  `#/open/demo`: the practice vault built at build time from a fixed sample letter in the three languages.
* `#/drill`: the Write flow in drill mode — testnet only (`ui_drill_hidden_on_mainnet`), presets and custom term
  bounded by `drillBounds` (`ui_drill_bounds`: 29 min and 49 h are refused, 30 min and 48 h accepted), check
  interval fixed to `drill.heartbeat_blocks`, both dates of `drillOpensAt` shown, ribbon on every drill screen,
  "tell them now" forced on. `#/drill/report?T=`: timeline and checklist of `SPEC.md` §3.4.
* `#/privacy`: the text of `SPEC.md` §7 in the three languages with `operator_contact`.

## Phase 4 — quality and build

`npm run build` → `site/app/` (base `/app/`), followed by `scripts/vendor-crt.sh` and `scripts/sync-config.sh`
outputs in `site/app/deployments/` and `site/app/config/`. Tests: screens render in the three languages (snapshot
of key strings, not of markup); no hard-coded strings (`i18n_no_hardcoded_strings`); the built app makes no
request outside its own origin, the configured RPC, monitor and wallet origins (grep `site/app/`); the quote on the
price screen equals `price.quote`; mainnet disabled. Fixed test names: `ui_renders_three_languages`,
`i18n_no_hardcoded_strings`, `ui_cancel_two_clicks`, `ui_price_matches_quote`, `ui_mainnet_disabled`,
`ui_seal_checkbox_gates_next`, `ui_cost_panel_live`, `ui_guardians_clamped`, `ui_recipients_max_ten`,
`ui_fee_below_capacity_refused`, `ui_claim_before_create`, `ui_seal_reduced_motion`, `ui_owner_code_shown_once`,
`ui_handover_guides_three_languages`, `ui_checkin_deeplink`, `ui_away_until`, `ui_drill_bounds`,
`ui_drill_hidden_on_mainnet`, `ui_contrast_tokens`. `docs/app.md` (screens, design system, how to add a language
string), `CHANGELOG.md`.

## Acceptance

```sh
node --test acceptance/aiworker-dms-ui/
node acceptance/aiworker-dms-ui/named.mjs
```
