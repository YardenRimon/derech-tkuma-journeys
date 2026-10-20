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

The local restore command alone does not establish provider D1/R2 restore, public site recovery, source archive restoration, or off-server delivery. Report those states separately. An actual recovery drill must use a fresh snapshot from the live endpoint, the encrypted off-server copy, an independently verified download/decryption, and this isolated restore.

## Verified encrypted off-server path and acceptance boundary

The existing owner VPS runtime now captures the CMS, performs an isolated local restore, encrypts with the established public certificate, and uploads only the encrypted OpenSSL DER archive to a separate purpose-scoped Worker bound to the private `derech-tkuma-backups` R2 bucket. This bucket is separate from CMS media. The VPS upload credential is a dedicated HMAC capability, not a Cloudflare admin or S3 credential. The uploader validates the receiver's signed receipt, exact scope, object identity, ciphertext size/hash and verified stored-copy result. A failed/unverified copy writes a failure attempt and never replaces the prior latest success. Private recovery-key custody remains separate.

The receiver has a **16 MiB limit for the entire encrypted archive**, distinct from the export's 20 MiB database snapshot and 5 MiB individual media limits above. Growth beyond the ingress limit fails explicitly and requires a reviewed streaming/multipart design before increasing usage. It does not create a partial successful backup. There is no external GET/list/delete API on the receiver; independent recovery downloads use the owner's separate provider authority. Static source/media archives are retained separately.

The 19 October 2026, 21:00:44 UTC capture produced a 143,919-byte encrypted archive, SHA256 `fcf23f48ecc503f9e32c5b527d8d61fd4bd24edaea4418d890d3e3b66557b664`. A separately downloaded provider object had the identical ciphertext hash, was decrypted off the VPS and restored into a new isolated SQLite database: **11 tables, 104 rows, integrity_check=ok and foreign_key_check=ok**. Its snapshot SHA256 is `6a3e131314997b30265e38a694e6444a00f74bc6ae411938425f0491a7b399bd`. The CMS media inventory was empty: 0 objects/0 bytes. This proves the downloaded database recovery set, not upload/read/restore of a nonempty live media object or recovery of the original WordPress site. Evidence: `../audit/cms-r2-offserver-recovery-2026-10-19.json`.

A separate earlier recovery drill restored a 99-row snapshot to a new isolated Cloudflare D1 database and compared every row, schema, identities/history and sequence. It did not overwrite the original or apply a final migration delta. The 104-row downloaded recovery above is a separate local SQLite proof, not a claim of a 104-row provider D1 restore. Evidence: `../audit/cms-cloudflare-recovery-drill-2026-10-19.json`.

A one-off timer scheduled in advance invoked the backup service at 21:00:44 UTC; it completed success/exit0 at 21:00:47. The existing owner-only success notifier completed success/exit0 at 21:00:51, with processed/notices[] because no failure was open. The acceptance timer subsequently deactivated and was already unloaded when checked. The ordinary daily 03:10 Asia/Jerusalem timer remained active/waiting and unchanged; its first calendar occurrence was still future at the check. This establishes the scheduled one-off capture/restore/encrypt/verified-copy/callback path, rather than asserting an unobserved daily occurrence. Evidence: `../audit/cms-backup-forward-scheduled-2026-10-19.json`.

The deployed runtime checks the existing authoritative Israel/Jerusalem Sabbath/holiday policy before capture and again before upload; the notifier and sole sender retain their own checks before writes/delivery. Missing/closed calendar fails closed. The singleton backup lock remains. No calendar exception, sender or poller was added. Failed-run notices remain owner-private; recovery requires an actual sent opening with a positive message ID, while an unsent queued opening is cancelled on verified success. Isolated tests cover failure/recovery semantics; no live backup failure was fabricated for acceptance.

Remaining before domain cutover: a full original WordPress files+database backup with isolated restore and the final original-site content/database delta plus a fresh backup for the domain migration window. Provider/account recovery and the independent VPS monitor remain separate operational responsibilities.

## Focused verification

`node --experimental-strip-types scripts/test-backup.mjs` exercises 1,204-row full capture, HMAC purpose/path/body/time rejection, scope/key/credential guards, media hashes, original publication versions and identity revisions, a deleted high audit sequence, isolated restore, tamper rejection and overwrite refusal. Root runs integrated application checks and live deployment verification separately.

## Cloudflare active-target handoff — 20 October 2026

The two existing purpose-separated HMACs were copied, with explicit owner approval, to the exact review Worker secret store. Existing native CMS browser and machine writes are blocked at the old Worker boundary (Sites v11, source8931d6b); `/admin` redirects only to the fixed Cloudflare admin. Its public preview and read-only backup remain available. A fresh three-way delta from the frozen99-row baseline to the current104-row source retained Cloudflare identity pins, monotonic login metadata, all history and its uploaded media. One guarded37-statement bound REST batch was used only after isolated rollback/success validation; current-target and final-state assertions were inside the same transaction. No rows or media were deleted.

The existing backup config now targets `https://derech-tkuma-review.22yarden22.workers.dev` with only `url`, `secret`, `scope`; it sends no Sites/Access credential. The updated downloader, singleton, public-certificate encryption, signed private-R2 receiver and daily03:10 Asia/Jerusalem timer remain in the existing service. No scheduler or sender was added. Source/config rollback copies stay root-private.

The live Cloudflare backup at01:19:27UTC, invocation5db3578e9d6242d4acf9ccbaee1fb5c2, produced164,399 encrypted bytes, SHA256 `7990b73de4a74b5b2b5a58f10ae94af9468a6573b6a48ce2b2fb72e951194dd0`; snapshotSHA `95464afeaa3cbca0ea5ec84b4443d13c10a14c061c6b1489ecb4e2a276ef18f1`. Independent provider download, decryption and isolated SQLite restore verified all11 tables/104 rows plus the actual15,800-byte WebP uploaded through the CMS, including its exact SHA and retained owner Cloudflare identity pin. This is recovery from the active Cloudflare CMS archive, not restoration of the original WordPress site or a live-provider rollback. Evidence: `../audit/cms-cloudflare-backup-handoff-2026-10-20.json`, `../audit/cms-cloudflare-r2-recovery-2026-10-20.json`.

R2 HTTP metadata is normalized to its JSON wire representation before snapshot hashing. A regression with optional undefined properties and Date metadata failed before this fix and now passes HTTP JSON roundtrip SHA plus isolated media restore in CI. Release source1e831cdf / push run39351803558 verified and deployed successfully. HMAC live checks deny unsigned/expired requests, wrong scope, cross-purpose keys and any machine `operation` field including null/rollback.
