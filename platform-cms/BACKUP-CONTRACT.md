# Isolated CMS backup contract

The backup endpoint is read-only and covers this native Site's deployment-isolated CMS database and its R2 upload objects. It does not back up the original WordPress database, environment credentials, provider control plane, or static source/media assets. Retain the separately verified native source archive (including the 982 static assets) and migration SQL with each recovery set. No production/provider restore endpoint exists.

## Authentication and operational ownership

Set `CMS_BACKUP_SECRET` to a dedicated random secret of at least 40 characters. Never reuse `CMS_EXECUTION_SECRET`. Set `CMS_BACKUP_BUCKET_SCOPE=deployment-isolated` only after verifying that the native Site DB and bucket bindings belong solely to this project. The server's private configuration contains `url` (Site origin), `secret`, `scope` (`tenantId`, `siteId`) and, when required, `siteAccessToken` for the provider's service-access header. It must not be world accessible or group writable. The application environment is never exported.

Only `POST /api/backup/` is supported, with no query parameters and at most 2 KiB JSON. Sign exact UTF-8 bytes using HMAC-SHA256:

```
cms-backup-v1\nPOST\n/api/backup/\n<Unix seconds>\n<exact body>
```

Headers: `x-backup-time`, `x-backup-signature` (lowercase hex). Time tolerance is 120 seconds. A signature for another purpose/path/body fails. Requests do not use cookies, user identity headers or browser admin permissions. A read replay within that interval grants no mutation. Secret possession permits sensitive backup export and must remain restricted to the existing backup runtime. Provider access is an additional independent gate.

Snapshot body:

```json
{"purpose":"cms-backup-v1","operation":"snapshot","tenantId":"derech","siteId":"derech-main"}
```

Object body uses the same scope/purpose, `operation:"object"`, an exact UUID `key` and the inventory `etag`. No caller-selected SQL, table, prefix, bucket or site is accepted. Responses have private/no-store/noindex headers. Signed paths without the trailing slash are accepted only when signed for that exact path; the downloader always uses the slash.

## Snapshot and media completeness

The export reads all 11 known application tables (including users/identity pins, publication versions, draft histories, task requests/receipts, execution settings and permission audit), table definitions, column metadata, explicit indexes and complete `sqlite_sequence`. A single D1 read batch provides the database snapshot. Each full table result is checked against a count from the same batch; truncation fails the export. Scope registration and every tenant-aware table must contain only the expected tenant/site. Unknown or missing CMS tables and credential-like settings fail closed rather than silently omit data.

The R2 inventory follows every page, includes unreferenced UUID uploads, verifies HEAD metadata against each list entry, and is repeated around the DB snapshot. Changes, missing references, unexpected non-UUID keys and repeated/incomplete cursors fail. Each object is fetched conditionally against its captured ETag; the downloader checks bytes, ETag and server SHA-256, then records its own SHA-256. The final `manifest.json` exists only after every object is captured. An incomplete directory is not a completed backup.

Current conservative bounds: DB snapshot 20 MiB, 10,000 objects, and 5 MiB per upload. Overflow fails explicitly; no partial snapshot is reported successful. The current CMS upload API has the same 5 MiB object bound. Growth beyond these limits requires a streaming/provider snapshot design, not larger in-memory batches.

## Download, encryption and isolated recovery proof

Use the existing server backup runtime and off-server encrypted storage; these scripts do not add a scheduler, sender or bot. Download into a new private working directory:

```sh
python3 scripts/cms-backup-download.py --config /etc/private-cms-backup.json --output /private/new-backup-dir
```

The working directory is plaintext (0700, files 0600). Encrypt it using the established transport before off-server delivery, verify ciphertext size/hash at the remote destination, and retain the established key separately. Never commit private snapshots or credentials. Rotate/clean plaintext using that runtime's existing policy after validated encryption and delivery.

Recover only into a new local SQLite file:

```sh
python3 scripts/cms-backup-restore.py --backup /private/new-backup-dir --target /private/restore-proof.sqlite --migrations platform-cms/drizzle
```

Recovery checks wrapper and table digests, migration source hashes, semantic schema identity (identifier quoting/whitespace differences tolerated), every row count, identity/revision/history values, scope, all media hashes, sequence, `integrity_check` and `foreign_key_check`. It runs only repository migration SQL and parameterized inserts, never SQL from the snapshot. Existing targets and symlinks are rejected, and failed output DBs are removed. Original identities are retained in this private proof DB; do not connect a restored proof database to a public app.

The proof does not claim provider D1/R2 restore, public site recovery, source archive restoration, or off-server delivery. Report those states separately. An actual recovery drill must use a fresh snapshot from the live endpoint, the encrypted off-server copy, an independently verified download/decryption, and this isolated restore.

## Focused verification

`node --experimental-strip-types scripts/test-backup.mjs` exercises 1,204-row full capture, HMAC purpose/path/body/time rejection, scope/key/credential guards, media hashes, original publication versions and identity revisions, a deleted high audit sequence, isolated restore, tamper rejection and overwrite refusal. Root runs integrated application checks and live deployment verification separately.
