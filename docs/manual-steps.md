# Manual steps

The only place where a human has to do something. pswsl: `~/work/dead-man-switch`. VPS (`deploy@ubuntu`,
31.70.74.15): `~/src/dead-man-switch`, web server = Docker Compose project `~/vericell`, container
`vericell-caddy-1`, Caddyfile baked into its image from `~/vericell/packages/web/Caddyfile`.

1. **Organiser address and the site build.** Done on 2026-11-15: `organiser_address` set in `config/testnet.json` and
   `config/mainnet.json` (secp256k1 addresses, minimum 61 CKB), `organiser_fee_ckb` 70; `scripts/build-site.sh` run and
   `site/app/` committed. After a change to `app/` or `config/`, run `bash scripts/build-site.sh` again and commit
   `site/app/`. Merge `aiworker/dms-e2e` into `main` (pull request on GitHub); the VPS serves `main`.
2. **Deploy on the VPS** (as `deploy`):
   ```sh
   git clone https://github.com/psawyerberlin/dead-man-switch.git ~/src/dead-man-switch
   git clone --depth 1 https://github.com/psawyerberlin/ckb-revocable-timelock.git ~/src/dead-man-switch/.refs/crt
   install -m 600 ~/src/dead-man-switch/notifier/.env.example ~/dms-notifier.env
   mkdir -p ~/dms-notifier-data && sudo chown 1000:1000 ~/dms-notifier-data
   sed -i "s/^NOTIFIER_DATA_KEY=.*/NOTIFIER_DATA_KEY=$(openssl rand -hex 32)/" ~/dms-notifier.env
   nano ~/dms-notifier.env        # type the Strato password after SMTP_PASS=
   docker network ls --format '{{.Name}}' | grep -i vericell     # the web server's network, normally vericell_default
   cd ~/src/dead-man-switch && DMS_NOTIFIER_ENV=$HOME/dms-notifier.env DMS_NOTIFIER_DATA=$HOME/dms-notifier-data \
     WEB_NETWORK=vericell_default docker compose -f notifier/compose.yaml up -d --build
   ```
   Then append `deploy/Caddyfile.snippet` to `~/vericell/packages/web/Caddyfile`, add the mount line
   `- ~/src/dead-man-switch/site:/sites/dead-man-switch:ro` to the caddy service in `~/vericell` after the
   stats-export line, validate in a throwaway container and rebuild only Caddy (see `deploy/README.md`):
   ```sh
   docker run --rm -v ~/vericell/packages/web/Caddyfile:/etc/caddy/Caddyfile:ro caddy:2 caddy validate --config /etc/caddy/Caddyfile
   cd ~/vericell && docker compose up -d --build caddy
   ```
   The mail DNS of `chainsolution.psawyer.de` is already done (SPF Strato standard, DKIM by Strato, DMARC
   `p=quarantine`; verified 2026-11-15 with SPF, DKIM and DMARC pass at Gmail). Keep a copy of `NOTIFIER_DATA_KEY`
   outside the VPS (password manager): the database is useless without it.
3. **Devnet scenario** on pswsl (needs the CRT devnet prerequisites of CRT's `docs/testing.md` and a Chromium:
   `npx playwright-core install chromium` in `test/e2e`):
   ```sh
   cd ~/work/dead-man-switch && (cd test/e2e && npm ci) && node test/e2e/scenario.mjs
   ```
   Paste the PASS/FAIL output into `DECISIONS.md` (section "dms-e2e, devnet run").
4. **Fire drill on testnet** with a JoyID wallet in the deployed app: one recipient who confirms, then a second
   drill that is cancelled. Record T, dates and PASS/FAIL in `docs/testing.md`.
5. **Updates.** `git -C ~/src/dead-man-switch pull -q`; when `notifier/` changed, also
   `git -C ~/src/dead-man-switch/.refs/crt pull -q` and the `docker compose … up -d --build` line of step 2.

Nothing else.
