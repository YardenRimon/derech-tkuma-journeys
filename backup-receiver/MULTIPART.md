# Bounded ciphertext multipart transport — prepared and tested locally

This extension uses the **existing** receiver, private backup bucket, approved upload HMAC, host runner, singleton lock, calendar, service and timer. It creates no credential, sender, poller, job queue or scheduler. Provider deployment and real scheduled large-archive acceptance are separate gates. The existing v1 request and signed receipt remain unchanged for new archives at or below8MiB. Historical v1 objects through16MiB are read-only verifiable. See [controlled fallback and shared final-key claims](CLAIMED-FALLBACK.md) for the mandatory rollout/rollback barrier.

For a larger archive the same uploader selects v2: 8 MiB parts, at most 512 parts and 4 GiB total ciphertext. Nonfinal parts are exactly 8 MiB. The canonical manifest binds protocol, exact `derech` / `derech-main` scope, original UTC capture time, total bytes, whole ciphertext SHA256, and every ordered part number/size/SHA256. The client hashes the whole protected source in bounded chunks before networking and rechecks the complete source and file identity before publication. Large archives use a bounded public DER ContentInfo / EnvelopedData OID / AES256 envelope-header check; a full OpenSSL parse of a multi-GiB CMS could itself allocate the whole ciphertext. The trusted existing capture runtime still performs the plaintext isolated-restore proof and creates AES256 CMS. Format checks cannot prove the inner plaintext or replace recovery-key decryption and restoration.

## Authenticated fixed routes

Only POSTs to the deployment-pinned HTTPS origin and these exact paths are admitted, without query, fragment, Origin or cookies:

- `/v2/backups/derech/derech-main/create`
- `/v2/backups/derech/derech-main/part`
- `/v2/backups/derech/derech-main/complete`
- `/v2/backups/derech/derech-main/readback`
- `/v2/backups/derech/derech-main/cancel`

Every request has `x-backup-time`, `x-backup-session`, `x-backup-part`, `x-backup-size`, `x-backup-sha256`, and `x-backup-signature`. The raw existing 32-byte HMAC key signs UTF-8 lines without a terminal newline:

```text
cms-ciphertext-<action>-v2
POST
<exact pinned origin>
<exact route including action>
<Unix seconds>
<session ID>
<part number, or 0 for control actions>
<exact body byte count>
<exact body SHA256>
```

The clock window is 120 seconds. A session ID is SHA256 of `createdAt + "\n" + wholeCiphertextSha256`, binding a unique final key; its immutable manifest digest rejects competing different manifests for that key. Create carries the exact canonical manifest JSON. Part carries opaque encrypted bytes. Other actions carry exactly `{}`. Readback identifies one manifest part number. Control bodies are at most 128 KiB and part bodies at most 8 MiB, including actual streamed body limits. No arbitrary URL, bucket, prefix, final key, upload ID or SQL is accepted from the caller. Upload IDs remain private receiver state.

Each response is signed with `cms-ciphertext-<action>-receipt-v2\n<exact receipt JSON>`. Readback returns encrypted bytes only, with the signed JSON in `x-backup-readback-receipt` and its MAC in `x-backup-receipt-signature`; the receipt binds session, part, actual byte count/SHA and completed object ETag/version. There is no anonymous GET, arbitrary read, list, final-object deletion, redirect, CORS or plaintext API. The client rejects redirects and checks the exact response URL, signed receipt identity, bounded body, chunk bytes and digest.

## Publication and independent verification

The receiver hashes every bounded part, validates the first part's public encrypted envelope, writes native R2 multipart parts, and stores immutable part receipts. Complete compares every ordered manifest entry with private receipt metadata and performs native R2 multipart completion. It does **not** hash a multi-GiB object in one Worker invocation and does **not** infer whole ciphertext SHA from the part manifest.

A completion receipt explicitly says `verified=false` and `globalReadbackRequired=true`. Before the host can set `offServerCopyVerified`, it independently reads the completed ciphertext in authenticated, ETag/version-bound ranges; computes SHA256 incrementally across **every actual returned byte**, including original ordering; and compares the complete byte count and whole digest against the independently hashed source. Only the host's resulting report says `verified=true`, `independentReadbackVerified=true`, with exact `readbackBytes` / `readbackSha256`. Finalization and operator recovery enforce this proof for every v2 receipt, including8..16MiB. A completion receipt or matching part manifests alone never advances latest success.

Final opaque object keys stay compatible with the independent provider restore CLI:

```text
derech/derech-main/YYYY/MM/DD/YYYYMMDDTHHMMSSZ-<ciphertext SHA256>.cms
```

R2 multipart completion has no conditional-create option. API publication is restricted to one immutable session claim for each final content key; competing different manifests, conflicting existing metadata and changed completed object versions fail. A provider administrator writing out of band during the head/complete interval is outside this API guarantee. Keep the receiver as the sole writer for these keys; owner-level provider authority remains a separate boundary.

## Bounded resume, calendar and resources

Eight private CAS-created/reclaimed active slots bound concurrent incomplete sessions. Slot release/reuse uses ETag conditions, avoiding stale release deleting a later claimant. Session, part, completion and cancellation receipts remain immutable in the existing private R2 scope. Each create invocation checks at most eight slots and cleans up at most four expired incomplete sessions. Cleanup aborts incomplete multipart state only; final ciphertext objects are preserved. The capture/session age remains seven days. The public [R2 upload documentation](https://developers.cloudflare.com/r2/objects/upload-objects/#incomplete-upload-lifecycles) also describes default seven-day incomplete-upload abort, covering the unavoidable crash interval between native multipart creation and persisting its upload ID. This source work neither verifies nor changes the live bucket lifecycle; actual policy remains a release check.

The prepared existing `run.py` source is used by the existing deployment preparation instead of a second embedded copy. Its host invocation resumes only its single `last-attempt.json` pending archive before beginning another capture. It preserves the original `createdAt`; an old resumed archive never becomes a fresh capture. Latest success does not regress over a newer original capture time. A future scheduled invocation may continue the same session, skipping signed accepted-part numbers.

Independent readback is also resumable: one protected, encrypted `.readback.partial` beside the pending archive holds only bytes obtained from prior independent reads. At every resume, the host rehashes all cached bytes, verifies each against the fixed manifest, and fetches only remaining ranges. A terminated partial append is truncated to its last complete verified boundary. The host still computes whole SHA over all actual independently read ciphertext bytes; it never constructs whole SHA from part hashes. This temporary file can require up to one extra archive-size of local disk, bounded at 4 GiB; available space is checked. The encrypted readback temporary is removed only after full verification. The source ciphertext is retained on failure.

The authoritative time policy is checked before **every** client network request. On a hold, pending session and encrypted cache remain; no cleanup/cancel request is sent after sacred time closes. Held reports have `encrypted_upload_held`, `complete=false`, `offServerCopyVerified=false`. The source-only runner hook preserves its existing 10-minute timeout, UID, mounts, calendar, lock, notifier and timer. A 2.1 GiB upload plus independent readback may need multiple ordinary invocations depending on bandwidth; no timeout or permission was widened. Local pending/readback state is not a second queue.

Immutable metadata adds small per-part R2 objects and requests. Existing usage alerts are still alerts, not spending caps. No billing settings or paid plan is created or changed by this extension.

## Offline acceptance

```sh
node backup-receiver/test-worker.mjs
python3 -m unittest discover -s backup-receiver -p 'test_*.py'
node backup-receiver/test-r2-local.mjs
```

The existing R2 test invokes the new multipart fixture. Actual local Miniflare/workerd R2 receives a real synthetic OpenSSL CMS archive above 16 MiB, completes native multipart upload and independently reconstructs the full stored ciphertext/hash. It also covers exact session resume, duplicate part receipts, malformed manifest, auth/expired replay/cross-scope/browser context, tamper/plaintext/size rejection, incomplete completion, existing-object conflict, cancellation, maximum 4 GiB / 512-part metadata, eight active slots and bounded expired cleanup. All 38 Python cases pass, including four operator-artifact cases proving native freshness markers remain byte-identical and two executions of the same prepared runner with network disabled. Python fixtures cover bounded source and readback streaming, held upload/readback resume without resending stored parts, byte tamper, corrupt independent cache, receipt scope/signature, source identity, expired capture, original-age preservation and rejection of manifest-only verification. Existing v1 receiver, local R2 and uploader regressions remain in the same checks.

This proves local protocol behavior with synthetic data, not live upload, provider lifecycle, real large-backup timing, source recovery, deployment, or a scheduled production invocation. The independently restored original WordPress archive and CMS recovery set remain separate evidence.

The exact same-receiver/file-CAS rollout recipe and operator-only WordPress recovery-artifact command are in [OPERATOR-ROLLOUT.md](OPERATOR-ROLLOUT.md). Raw large-ZIP outer-DER encoding is an explicit separate preparation gate.
