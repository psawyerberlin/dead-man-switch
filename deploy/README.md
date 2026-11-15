# Deployment on the VPS

## Layout

- Repository: `~/src/dead-man-switch` (`git clone https://github.com/psawyerberlin/dead-man-switch.git ~/src/dead-man-switch`, plus CRT in
  `.refs/crt` for the notifier image: `git clone --depth 1 https://github.com/psawyerberlin/ckb-revocable-timelock.git ~/src/dead-man-switch/.refs/crt`).
  `site/` (including the built `site/app/`, committed) is served as it is: there is no build step on the server.
- The web server's compose file mounts the site read-only:
  `- ~/src/dead-man-switch/site:/sites/dead-man-switch:ro`
- The notifier is its own compose project in `~/src/dead-man-switch/notifier`
  (`docker compose -f ~/src/dead-man-switch/notifier/compose.yaml up -d --build`). Env file `~/dms-notifier.env`
  (from `notifier/.env.example`), data `~/dms-notifier-data`. It joins the web server's Docker network, so the
  Caddy block reaches it as `dms-notifier:8787`.
- The Caddy block is `deploy/Caddyfile.snippet`; append it to the web server's Caddyfile.

## Validate the Caddyfile

Validate inside the running `vericell-caddy-1`: the Caddyfile's first site address is `{$CADDY_DOMAIN}`, which a
throwaway container leaves empty (the block then reads as global options and fails with "unrecognized global option").

```sh
docker cp ~/vericell/packages/web/Caddyfile vericell-caddy-1:/tmp/Caddyfile.new && \
  docker exec vericell-caddy-1 caddy validate --config /tmp/Caddyfile.new --adapter caddyfile
cd ~/vericell && docker compose up -d --build caddy
```

The Caddyfile is baked into the `vericell` web image, so a change needs the rebuild of the `caddy` service; the
Vericell and csr-monitor site blocks stay untouched.

## Update

```sh
git -C ~/src/dead-man-switch pull -q
# only when notifier/ changed:
git -C ~/src/dead-man-switch/.refs/crt pull -q
cd ~/src/dead-man-switch && DMS_NOTIFIER_ENV=$HOME/dms-notifier.env DMS_NOTIFIER_DATA=$HOME/dms-notifier-data \
  WEB_NETWORK=vericell_default docker compose -f notifier/compose.yaml up -d --build
```

## Mail

The messenger sends through a Strato mailbox, `dead-man-switch_noreply@chainsolution.psawyer.de`, at
`smtp.strato.de:465` (implicit TLS). DNS of `chainsolution.psawyer.de`, already in place:

- SPF: `v=spf1 redirect=_spf.strato.com`
- DKIM: selectors `strato-dkim-0002` (RSA) and `strato-dkim-0003` (Ed25519), published by Strato
- DMARC, `_dmarc.chainsolution.psawyer.de`: `v=DMARC1; p=quarantine; adkim=r; aspf=r`

Check: send a mail through the messenger to a Gmail address, open it, "Show original": SPF, DKIM and DMARC must
all say PASS. The password lives only in `~/dms-notifier.env`.

## Backup of the notifier data

All state is `~/dms-notifier-data/notifier.db` (SQLite). Stop the container (`docker stop dms-notifier`) or use
`sqlite3 notifier.db ".backup notifier-backup.db"`, copy the file. Keep `NOTIFIER_DATA_KEY` somewhere else than
the backup: the database is useless without it, and a lost key cannot be recovered.
