# Spec 02 — the app: write, check in, open (`dms-ui`)

**Branch:** `aiworker/dms-ui`. **Acceptance:** `acceptance/aiworker-dms-ui/`.
**Normative:** `SPEC.md` §2, §3, §5, §6. **Depends on:** spec 01.

## Phase 1 — shell

`app/src/ui/`: hash router (`#/write`, `#/mine`, `#/open`, `#/about`), header with language switch (en / fr / de,
remembered), network badge (testnet; mainnet greyed with the `SPEC.md` §3.4 text), wallet connect/disconnect
through CCC (JoyID connector first; the CCC connector UI is allowed), balance, faucet link on testnet. Styles:
import `site/assets/site.css` and extend; no UI framework; keyboard navigable; `prefers-color-scheme` and
`prefers-reduced-motion` respected; every form control labelled; focus visible.

## Phase 2 — Write (`SPEC.md` §3.1)

Screens as routes under `#/write/<step>`: letter → rhythm → guardians → price → create → seal → hand over. State
in memory only (a page reload before Seal loses the letter; say so once at the top of the letter screen). Rules
that tests check:

* the consequence sentence on the rhythm screen uses the exact i18n key `rhythm.consequence` with the two dates;
* the rhythm screen offers `rhythms_days` first when the list is not empty (testnet: "1 day"), then the month presets;
* the guardians screen lists only CRT runners (`fetchRunners` with the vendored runner list as `crtList`,
  `selectRunners` with `requireCrt: true` and `requireDepositedValid` from config), limits `n` to
  `n_min`..min(`n_max`, candidates), clamps the defaults to that range, and shows how many guardians are available
  (`ui_guardians_clamped`: with one candidate on testnet the default is 1-of-1 and n cannot be raised);
* the guardians screen shows the concentration summary and the "harder to steal, easier to lose" sentence
  (`guardians.mandatory_trade`) when a mandatory guardian is added; `1-of-1` requires the typed acknowledgement
  (`guardians.ack_phrase` in the UI language);
* the guardians screen also carries the **check interval** presets (`heartbeat.title`, `heartbeat.tradeoff` with the
  detection delay) and the tip per check in the advanced panel, and a **live cost panel** (`price.ts`) that updates on
  every change (`ui_cost_panel_live`: moving from daily to weekly lowers the monthly figure);
* the price screen has the organiser fee as its own line, editable down to 0, and a per-month figure;
* Create → progress per guardian (reads Node Cells) → hard-fail verification → Arm → Seal (download; the "I have
  saved the vault" checkbox gates the Next button) → Hand over (the three sentences of §3.1.8 and the `.ics`).

## Phase 3 — My switches and Open (`SPEC.md` §3.2, §3.3)

* `#/mine`: list (local, keyed by `T`; "add by T"), per switch the countdown in chain median time, headroom in
  plain words (`mine.headroom_sentence` with plurals), **Check in**, **Change guardians**, **Cancel**, **Reclaim**,
  **Download vault again** (disabled with the explanation when the letter is not in memory). Cancel: one button,
  one dialog with the consequence sentence, one signature. A test asserts Cancel is reachable in ≤ 2 clicks from
  the list and that its button is not smaller than Check in.
* `#/open`: drop zone for a vault file (and `?T=` for status only) → runs the opener bundle in the page.

## Phase 4 — quality and build

`npm run build` → `site/app/` (base `/app/`). Tests: screens render in the three languages (snapshot of key
strings, not of markup); no hard-coded strings (`SPEC.md` §5 heuristic, test `i18n_no_hardcoded_strings`); the
built app makes no request outside the configured RPC, monitor and wallet origins (grep `site/app/`); the quote on
the price screen equals `price.quote`. Fixed test names: `ui_renders_three_languages`, `i18n_no_hardcoded_strings`,
`ui_cancel_two_clicks`, `ui_price_matches_quote`, `ui_mainnet_disabled`, `ui_seal_checkbox_gates_next`, `ui_cost_panel_live`. `docs/app.md`,
`CHANGELOG.md`.

## Acceptance

```sh
node --test acceptance/aiworker-dms-ui/
node acceptance/aiworker-dms-ui/named.mjs
```
