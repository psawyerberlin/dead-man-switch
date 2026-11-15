# Manual steps

The only place where a human has to do something. Paths are those of the repository root
(`/srv/aiworker/projects/dms-e2e` here, `~/src/dead-man-switch` on the VPS).

1. **Organiser address.** In `config/testnet.json` set `organiser_address` to your testnet address (`ckt1…`); later
   the same in `config/mainnet.json` (`ckb1…`, then `"enabled": true` once CRT's mainnet deployment is enabled).
   Check `organiser_fee_ckb` (70): it must cover the occupied capacity of the address's lock plus 8 CKB (a
   secp256k1 address needs 61 CKB, a JoyID or multisig lock more); the app refuses a smaller fee.
2. **Build and commit the site.**
   ```sh
   cd /srv/aiworker/projects/dms-e2e
   bash scripts/build-site.sh
   git add site/app && git commit -m "site: build" && git push
   ```
   The script refuses to finish while the address is a placeholder. The site is served from git, not uploaded.
3. **Devnet scenario.**
   ```sh
   cd /srv/aiworker/projects/dms-e2e/test/e2e && npm ci && cd ../..
   node test/e2e/scenario.mjs
   ```
   Paste the PASS/FAIL output into `DECISIONS.md` (section "dms-e2e, devnet run").
4. **VPS.**
   ```sh
   git clone git@github.com:psawyerberlin/dead-man-switch.git ~/src/dead-man-switch
   cp ~/src/dead-man-switch/notifier/.env.example ~/dms-notifier.env
   chmod 600 ~/dms-notifier.env
   openssl rand -hex 32        # paste as NOTIFIER_DATA_KEY in ~/dms-notifier.env
   ```
   Edit `~/dms-notifier.env`: `SMTP_USER` and `MAIL_FROM` are the Strato mailbox
   `dead-man-switch_noreply@chainsolution.psawyer.de`; type its password as `SMTP_PASS` yourself. Then:
   ```sh
   docker compose -f ~/src/dead-man-switch/notifier/compose.yaml up -d --build
   ```
   Add the block of `~/src/dead-man-switch/deploy/Caddyfile.snippet` to the web server's Caddyfile and the line
   `- ~/src/dead-man-switch/site:/sites/dead-man-switch:ro` to its compose file, validate
   (`docker run --rm -v <your Caddyfile>:/etc/caddy/Caddyfile:ro caddy:2 caddy validate --config /etc/caddy/Caddyfile`,
   see `deploy/README.md`) and rebuild the web server. The mail DNS of `chainsolution.psawyer.de` is already done
   (SPF Strato standard, DKIM by Strato, DMARC `p=quarantine`; verified 2026-11-15 with SPF, DKIM and DMARC pass at Gmail).
5. **Fire drill on testnet** with a JoyID wallet in the deployed app: one recipient who confirms, then a second
   drill that is cancelled. Record T, dates and PASS/FAIL in `docs/testing.md`.
6. **Updates.** `git -C ~/src/dead-man-switch pull -q`, and
   `docker compose -f ~/src/dead-man-switch/notifier/compose.yaml up -d --build dms-notifier` when `notifier/` changed.

Nothing else.
