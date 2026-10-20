# Private encrypted backup receiver

This is a separate purpose-scoped Worker, not a route or binding added to the CMS Worker. It accepts uploads only into the existing owner's intended **private** bucket `derech-tkuma-backups`. The media bucket is separate. The example stays disabled by default. Owner-authorized provisioning was completed separately on2026-10-19: a separate live Worker, private backup bucket and independent upload HMAC were installed. A scheduled capture and signed receipt succeeded; an independent provider download, ciphertext hash check, owner-key decrypt and isolated104-row restore passed. This is implementation evidence for the owner deployment, not a claim that running this source provisions resources.

## Minimal authority

The reviewed deployment example declares one R2 binding, `BACKUP_BUCKET`, and no D1, CMS, media, service or other client binding. R2 bucket public access must stay disabled: no r2.dev or public-domain mapping. Root creates the bucket with Standard storage/location hint weur; that hint is not a strict residency guarantee. Uploads explicitly use Standard storage. Retention/lifecycle or bucket-lock decisions are separate owner-controlled changes; the uploader cannot delete data.

Generate a **new independent random32-byte key**, represented as64 lowercase hex characters, securely on the owner-controlled host. Install it as the Worker secret `BACKUP_UPLOAD_HMAC` and in a root-owned mode0600 `/etc/yarden-cms-backup-upload.json` via protected input. Do not reuse the CMS backup-export, execution, service-access, Telegram, Cloudflare API or S3 credentials. No admin/provider token, S3 key or private decrypt key is placed on the VPS for this upload path. The Worker receives no decryption key.

The endpoint is a capability-limited application boundary: the R2 binding can internally read its one bucket to verify writes, but the external API exposes no read/list/delete. A Worker/account administrator still has provider-level authority; this does not implement a storage WORM lock. A narrower S3 token would avoid custom receiver code but requires another object-storage credential and equivalent scope/verification work. The dedicated Worker keeps a general storage credential off the existing VPS and permits purpose-specific checks.

## Exact protocol

Only `POST /v1/backups/derech/derech-main`, with no query, fragment, browser Origin or cookies, is admitted. The exact HTTPS receiver origin is deployment-pinned. Every GET/HEAD/PUT/DELETE/OPTIONS path returns405; there is no list/download/delete API or permissive CORS. Responses have no-store, noindex/nofollow/noarchive and nosniff headers. Disabled/missing configuration fails closed before storage.

Metadata headers: `x-backup-time` (Unix seconds), `x-backup-created-at` (UTC YYYYMMDDTHHMMSSZ), `x-backup-size`, `x-backup-sha256` and `x-backup-signature`. Content-Type is exactly `application/pkcs7-mime`. HMAC-SHA256 uses raw bytes decoded from the64-hex key and signs UTF-8 lines, without a terminal newline:

```text
cms-ciphertext-upload-v1
POST
<exact HTTPS receiver origin>
/v1/backups/derech/derech-main
<Unix request time>
<capture UTC timestamp>
<decimal ciphertext byte length>
<lowercase ciphertext SHA256>
```

The request signature has a120-second window. Capture age is separately bounded to seven days, permitting a controlled retry of an existing encrypted archive under a fresh signed request. Body reads are bounded to16MiB and exact declared size. SHA256 must match before any write. A normal uploader parses OpenSSL CMS DER locally before networking. The receiver checks a complete DER ContentInfo envelope, EnvelopedData OID and AES256-CBC marker. These are public format checks, not decryption or proof of the archive's inner plaintext; encryption/restore proof belongs to the existing trusted capture runtime. No sensitive plaintext or recovery key is transmitted.

Storage keys are **server-derived**, never accepted from a request:

```text
derech/derech-main/YYYY/MM/DD/YYYYMMDDTHHMMSSZ-<ciphertext SHA256>.cms
```

The Worker uses conditional create-only `If-None-Match:*`, passes the checksum to R2, then fetches the stored object conditionally on its captured ETag and independently recomputes its full ciphertext SHA256. A duplicate verifies the existing exact object and returns a stable safe receipt; it never overwrites. Metadata conflicts, stored-byte corruption and provider failures fail without success. Provider errors/bodies/secret values are not returned or logged.

The JSON receipt binds protocol, exact tenant/site scope, server-derived key, capture time, byte count, hash, R2 ETag/version, verified=true and duplicate boolean. Its exact response bytes are signed with a separate response purpose:

```text
cms-ciphertext-receipt-v1\n<exact JSON response bytes>
```

The uploader checks TLS origin/no redirects, response size/status, signature and every identity field before accepting the copy. Raw receipt-signature headers and credentials are not persisted in the successful backup report.

Provider semantics were checked against [Cloudflare's R2 Workers API reference](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/): failed conditional writes return null; conditional headers and upload checksums are supported; successful writes are strongly consistent. The local runtime test also exercised actual conditional create/replay and stored-byte reads, rather than relying only on this documentation.

## Deployment procedure — root only

1. Root creates/verifies private backup bucket and separate media bucket. Keep receiver entirely independent of CMS code/bindings.
2. Review `wrangler.example.jsonc`. Bundle `worker.mjs` **and its `receiver-core.mjs` import**, bind only the private backup bucket, set the exact stable receiver origin and securely provision the new HMAC secret. Keep `BACKUP_UPLOAD_ENABLED=false` until the complete scoped configuration is ready. `observability.enabled=false` avoids request logging; do not introduce credential/body logging elsewhere.
3. Configure the VPS uploader file (actual secret through protected input, never a source file or chat):

```json
{"version":1,"origin":"https://derech-cms-backup-receiver.OWNER-SUBDOMAIN.workers.dev","secret":"PROVISION_A_NEW_64_LOWERCASE_HEX_SECRET_PRIVATELY"}
```

The config accepts only the fixed worker-name host under workers.dev. A future custom receiver domain requires an explicit reviewed allowlist change. Install `upload.py` on the existing backup host as `/opt/yarden-cms-backup/backup_upload.py`; no scheduler is introduced by this module.

4. Review/apply `runtime-upload.patch` to the existing runner, and add the uploader config to the existing service's read-only paths. Keep current singleton lock, fail-closed Israel/Jerusalem calendar, capture, isolated restore, public certificate, encryption, cleanup and network restrictions. The uploader checks the same authoritative calendar again before network upload. It never invokes a sender or backup export with an unrelated key.
5. A local encrypted report starts as encrypted_verified/offServerCopyVerified=false. On upload/storage/signature failure, preserve ciphertext, write a private `last-attempt.json` failure and exit nonzero; **do not advance latest.json**. On a verified provider copy, persist its safe receipt and only then mark offserver_copy_verified and advance latest success. Reuploading an older verified archive does not regress a newer latest success.
6. Perform one supervised real encrypted upload and verify denied read/list/delete/wrong-purpose requests. Use separate owner-provider download authority to download that object to a private off-server location, compare ciphertext SHA, decrypt with the owner's existing private recovery key and rerun isolated restore checks. The upload HMAC deliberately cannot download its own backup. Verify a subsequent scheduled capture→restore→encrypt→upload→verified-receipt run before claiming recurring off-server backup acceptance.

A signed retry of the same ciphertext is safe because the destination key is content-derived and create-only. A failed upload is not retried automatically in this addition. Preserve encrypted artifacts until owner-approved retention is implemented; never delete the only recovery copy merely because upload was attempted. Provider-account loss, recovery-key custody and restoration of unrelated infrastructure remain separate recovery gates.

## Focused checks completed

```sh
node backup-receiver/test-worker.mjs
python3 -m unittest discover -s backup-receiver -p 'test_upload.py'
node backup-receiver/test-r2-local.mjs
```

- Security/behavior checks use a **real locally generated OpenSSL AES256 CMS DER envelope**, injected faulting storage, concurrent replay, wrong HMAC/purpose/time/origin/scope, malformed metadata/DER/plaintext, body limits, signed receipts and provider error redaction.
- **9 Python tests** cover protected files/config/scope/time, exact signing, response signature and metadata validation, redirect/provider failure redaction, fail-closed calendar, unchanged latest on storage failure/unverified receipt, successful latest update and refusal to regress to an older success.
- Actual local **workerd/R2** verifies create-only preconditions, repeated upload without overwrite, independent stored-byte hash, signed receipt and denied external GET/DELETE. The installed local binary supports compatibility date2026-05-22, used only by that test; reviewed deployment example uses2026-10-19. The test binds localhost and temporary local storage only. It requires the existing CMS development Miniflare dependency, not a Cloudflare account.

Owner deployment acceptance was recorded separately in audit/cms-r2-offserver-recovery-2026-10-19.json and audit/cms-backup-forward-scheduled-2026-10-19.json. Local tests alone do not establish provider provisioning, delivery or recovery. CMS image-upload acceptance and original WordPress full backup/recovery remain separate migration gates.
