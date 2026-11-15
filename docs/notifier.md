# The messenger (notifier)

A small optional service: it reminds the owner before each deadline, raises alarms during the 24 h grace and, after
release, emails each recipient the link to their vault. It never holds the key before release and never sees a letter.
The normative text is `SPEC.md` §5.

## What it stores and why

See the table in `SPEC.md` §5.1 (referenced, not copied). In short: addresses and names and the record are encrypted
at rest with `NOTIFIER_DATA_KEY` (AES-256-GCM); tokens are kept as SHA-256; addresses that chose "never" only as an
HMAC. The key `K` exists only in memory while the release emails are sent.

## API

`/api/v1`: `POST /claim`, `PUT|GET|PATCH|DELETE /switch/:network/:T` (Bearer `A`), `GET /confirm/:token`,
`GET /stop/:token`, `GET /health`. Details, status codes and rate limits: `SPEC.md` §5.2.

## Environment

See `notifier/.env.example` (copy it outside the repository). Required: `NOTIFIER_DATA_KEY` (64 hex characters,
`openssl rand -hex 32`), `SMTP_HOST`, `SMTP_PORT` (465 or 587), `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` (its address must
equal `SMTP_USER`), `APP_URL`, `NETWORKS` and one `RPC_<NETWORK>` each. Optional: `PORT`, `DATA_DIR`, `TRUST_PROXY`,
`CRT_DEPLOYMENTS_DIR`, `LOG_LEVEL`.

## Running

Build `@crt/client` in `.refs/crt/client` first, then from the repository root:

```sh
docker compose -f notifier/compose.yaml up -d --build
```

The container publishes no port; it joins the external Docker network `${WEB_NETWORK:-vericell_default}` and the web
server proxies `/api/` to `dms-notifier:8787`. The env file is `${DMS_NOTIFIER_ENV:-~/dms-notifier.env}`, the data
directory `${DMS_NOTIFIER_DATA:-~/dms-notifier-data}` (mounted at `/data`).

## Backup

All state is in `/data/notifier.db` (SQLite). Stop the container (or use `sqlite3 notifier.db ".backup ..."`) and copy
the directory. Keep the backup and `NOTIFIER_DATA_KEY` apart: the database is useless without the key, and the key
cannot be recovered; losing it loses the data.

## Rotating `NOTIFIER_DATA_KEY`

1. Stop the service and back up `/data`.
2. Run, with the new key from `openssl rand -hex 32`:
   `OLD_NOTIFIER_DATA_KEY=… NEW_NOTIFIER_DATA_KEY=… node notifier/scripts/rotate-key.mjs /data/notifier.db`
   (one transaction; on error nothing changes).
3. Put the new key in the env file and start the service.

The script re-encrypts records, emails and names and recomputes the address HMACs and stop-link hashes, so
existing stop links keep working. Entries of the "never" list hold only HMACs and cannot be re-keyed; they stay but no
longer match (the script warns).

## Logs

JSON lines on stdout (`docker logs dms-notifier`), level from `LOG_LEVEL`. Switches appear as `0x` plus 8 hex digits,
addresses as `owner` or `recipient N`; names, emails, URLs and tokens are never logged. The health check is
`GET /api/v1/health`.
