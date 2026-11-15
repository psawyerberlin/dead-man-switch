# Changelog

## Unreleased

- dms-ui: quality and build: tests for three languages, no hard-coded strings, price equals quote, mainnet disabled;
  `npm run build` writes `site/app/` (base `/app/`) with vendored deployments and synced config; `docs/app.md`.
- dms-ui: the Write flow (letters, recipients and messenger, rhythm, guardians with the live cost panel, price with
  the organiser fee check, create with claim before signature and hard-fail verification, seal with downloads, owner
  code, owner archive, paper backup and calendar file, hand over to the messenger) and the handover guides for ten places.
- dms-ui: design system (tokens light/dark, self-hosted Fraunces, components, illustrations), app shell with hash
  router, language and theme switches, network badge, JoyID wallet through CCC, home screen.
- dms-notifier: the messenger service (store, API, watcher, emails), container (`notifier/Dockerfile`, `notifier/compose.yaml`),
  key rotation script and documentation (`docs/notifier.md`).
- dms-core: configuration, keys, per-recipient letters and links, vaults, owner archive, messenger client, QR,
  templates, the single-file opener, and the formats documentation (`docs/formats.md`, `app/README.md`).
- Application specification 2.0 (recipients, messenger, fire drill, owner archive, design), AI worker specs 01–04 with
  acceptance tests, key vectors, translations en/fr/de, website.
