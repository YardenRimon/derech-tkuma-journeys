# Controlled 8 MiB fallback and immutable final-key claims

Prepared source and local tests only. Provider revision CAS, quiesced installation, and bounded live resource acceptance remain operator gates. No paid plan, secret, bucket, service, timer, source re-encryption or recovery-bundle change is part of this protocol change.

## Admission and compatibility

- v1 new ciphertext writes are limited to **8 MiB inclusive**. Its request, input SHA256/DER validation, R2 checksum/create-only PUT and exact signed receipt are unchanged in that range.
- Existing v1 ciphertext up to the historical **16 MiB** bound remains immutable and verifiable. A normal old large POST can only verify a matching existing v1 object; it never allocates/reads the incoming large ciphertext or PUTs a final object. A missing large object returns413; an opposite-protocol/conflicting object returns409.
- v2 admits ciphertext **strictly above 8 MiB**. Its 8 MiB part size, manifest schema/canonical JSON, deterministic session ID, receipts, state records, 4 GiB/512-part bounds and original capture age remain unchanged. Previously pending >16 MiB sessions resume with the same identity.

## Existing-v1 metadata verification

The only new route is `POST /v1/backups/derech/derech-main/verify-existing` on the exact existing receiver origin. No browser Origin/Cookie is accepted. Its body is exactly the two bytes `{}` with `application/json`; content-length, if supplied, is2. Existing backup headers still describe the **ciphertext** capture timestamp, byte count and SHA256. Ciphertext is not sent to this route.

The same existing HMAC key signs these newline-separated fields:

```text
cms-ciphertext-verify-existing-v1
POST
<exact approved receiver origin>
/v1/backups/derech/derech-main/verify-existing
<fresh request epoch seconds>
<original capture stamp>
<ciphertext byte count>
<ciphertext SHA256>
```

Authentication/time/scope/body checks precede every R2 lookup. Known v1 metadata must match exactly, including the fixed tenant/site, original stamp, final key, size and digest. The read is conditioned on ETag; both copy and final HEAD must retain the original ETag/version. Native `crypto.DigestStream` hashes/counts every actual stored byte independently; a fixed <=64 KiB prefix is also checked for definite DER ContentInfo/EnvelopedData/AES256. An unusual old envelope whose algorithm header is beyond that prefix is held, never silently accepted or migrated. The locally owned OpenSSL certificate fixtures pass.

Success is the **exact old v1 signed receipt**, with `duplicate:true`. This route never PUTs a claim/object, lists, deletes, returns ciphertext, or creates a decryption capability. Missing objects, or matching known v2 state/claim, return only404 `existing_v1_not_found`. Unknown/conflicting metadata/claim returns409. A404 is not a verification receipt.

The host first validates its protected source file's complete hash, size and OpenSSL DER before this metadata request. Only the exact typed404 permits v2 fallback. Other HTTP/transport errors, redirects, malformed/unsigned receipts or identity conflicts stop. The exact calendar gate runs before every request; a hold retains the original ciphertext/session and sends no cancel.

## Shared immutable final-key authority

Size partition alone is insufficient: a buggy authenticated v2 caller could claim the whole SHA of a smaller valid v1 file before its independent readback detects that lie. Both writers therefore acquire one immutable CAS claim in the existing private R2 control prefix:

```text
derech/derech-main/.multipart-v2/claims/<SHA256(originalStamp + newline + wholeSHA)>
```

The claim pins schema/purpose/scope/final key/protocol/original stamp/ciphertext size/whole SHA and v2 manifest SHA (null for v1). `If-None-Match:*` admits one exact claim. Opposite protocol, different size or manifest is a409. Claims are never released, reassigned or removed by cancellation, completion, slot release, age cleanup or resume.

Before any new v1 PUT, the receiver also checks the deterministic old session record **and all eight old active slots**. An old slot may be durable before its initial session record. Persisted manifests are structurally validated and their session ID/manifest SHA recomputed. Lazy v2 resume recovers such an old slot/session into its exact claim; unknown/corrupt state is retained and fails closed. v2 completion rechecks the claim before its unconditional R2 completion API. A pre-existing different final object is never adopted into v2.

API immutability does not constrain an independent R2 administrator writing directly outside this receiver.

## Verification and rollback barrier

Every v2 completion remains `verified:false` / `globalReadbackRequired:true`. The host must independently stream **all** completed ranges and compare the actual whole byte count/SHA against its independently hashed source. Finalization and operator recovery enforce this for **any v2 receipt**, including 8..16 MiB; a part manifest or server completion never proves the global SHA.

Install receiver source first while the sole existing uploader lock is held and uploads/old in-flight writers are quiesced. Confirm the current receiver revision through the authorized CAS procedure before updating the same client. Preserve all prior ciphertext, receipts, original capture stamps and pending state. No service/timer/UID/timeout/calendar settings need change.

**Do not blindly roll back to a receiver that ignores claims while v2 uploads are active/pending or a client can open them.** That would restore the cross-protocol overwrite race. A safe rollback retains claim enforcement and the new write boundary, or remains write-quiesced pending a reviewed recovery procedure. Claims are not deleted to make a rollback appear compatible. An old client's new8..16 MiB upload may fail safely; it must not be relabelled verified.

Local checks run through the existing `test-r2-local.mjs` chain: real Workerd/R2/native DigestStream, real Python uploader/8 MiB+DER, both orders of the lying-globalSHA race, orphan/duplicate verification without PUT, old-slot/session-gap recovery, malformed/auth/scope/body/DER/version conflict, cancellation claim retention, old >16 MiB pending/replay and independent whole readback. Python tests cover typed404-only fallback, held state and mandatory whole-readback evidence. These prove local correctness, **not free-tier CPU/memory savings or live1102 resolution**. Bounded live acceptance remains required and stops on the first resource failure without discarding stored evidence.
