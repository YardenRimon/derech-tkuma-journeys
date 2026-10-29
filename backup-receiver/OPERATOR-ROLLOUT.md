# Same-receiver rollout and manual recovery artifact — recipe only

Prepared source only. Nothing here has deployed, changed a provider, installed a key, invoked the host runner, or uploaded the private original-site archive. Use existing owner-approved account/bucket/credential authority only. The existing deployment script that provisions keys or reinstalls units is **not** the update procedure.

## Exact source / file CAS pins

Before any authorized installation, the operator must read back the actual existing runtime files privately and compare them against these expected predecessor hashes. Any mismatch stops the update for review; historical pins do not prove current live state. The predecessor runner below is exactly the original existing runner before the reviewed source-only changes.

| Existing target | Required predecessor SHA256 | Reviewed replacement source | Replacement SHA256 |
|---|---|---|---|
| `/opt/yarden-cms-backup/backup_upload.py` | `092d5e2ebb4157d873ea6aa77c4b7e43b3ae9b540a5dd1f101a51a5db4933594` | `backup-receiver/upload.py` | `8b3346cc686eefd76d1be5a0ec517b2021a6e881a661278f8965ae3e9670fbc9` |
| `/opt/yarden-cms-backup/run.py` | `7bda2538caab4a48acdeedea3c4225cdee42f3f5ed8025f44ce1465879a3b6b8` | `backup-receiver/run.py` | `a12c223ffe2de17522a9a02313587411432881a8fc71ceafb19d8d301762fad8` |

Keep these files unchanged and verify their readback hashes:

| Existing target | Unchanged SHA256 |
|---|---|
| `/etc/systemd/system/yarden-cms-backup.service` | `57ef279aab1ba1481315bf4646c23382d9bc9e366cedc6e9fb6ab79bf09450d2` |
| `/etc/systemd/system/yarden-cms-backup.timer` | `6a4f0878ebac3db0232ec0afd87a563c1688668b254103c4740622233d2d9dfe` |

Reviewed Worker module graph, bundled into the **same** existing receiver:

| Source | SHA256 |
|---|---|
| `backup-receiver/worker.mjs` | `c6bd00fefd910c7f3eaca6e610a9b2926a6d8ea10a8807ea69181295f6d08967` |
| `backup-receiver/receiver-core.mjs` | `dac11b6542accdd076ffda293d8f0bee772a7ea4b28255b973a547a92b35568f` |
| `backup-receiver/multipart-core.mjs` | `5c0cc02d02505b694d0b4c92d656dbf4d4ad57c5caeac8957f01a22f54cdf9a3` |

The original local v1 `receiver-core.mjs` predecessor is `3386d68a368ed594ec117557f048fa72a1cc3cf6a688585cafd2eaf87fd052c7`; unchanged Worker entrypoint is the hash above. These are source hashes, not an assertion about the provider's current deployment ID or bundled bytes.

## Authorized operator sequence

1. Evaluate the exact existing authoritative time policy and preserve the same singleton lock. Read back the existing receiver deployment revision, exact pinned origin, sole private bucket binding, disabled request logging, existing HMAC presence, unit/timer state, and actual incomplete-upload lifecycle. Compare against the approved release baseline; stop on drift. Do not print secret values or raw provider response bodies. The live deployment revision and actual bucket lifecycle were not queried in this offline work.
2. Build/review only the three pinned Worker modules with the existing deployment configuration. Deploy to the same receiver name/origin, with the same private R2 binding and **unchanged existing secret**. No secret creation/rotation, extra bucket/binding, public access, cron, environment or billing change is needed. The Worker serves v1 throughout. Wrangler does not provide a file-hash CAS for provider state; one authorized writer must recheck the provider revision immediately before release and stop if it changed.
3. With the existing host service inactive and its same lock held, verify the two predecessor file hashes above; preserve a private rollback copy; stage the two replacement files; verify their exact pinned replacement hashes; and atomically replace only those two files, preserving root ownership and existing mode0644. Do not rewrite config, certificates, units, UID, mounts, timeout, timer/calendar, notifier or other helper files. Verify replacement readback hashes plus unchanged service/timer hashes. No daemon reload or timer creation is required for Python source replacement. Recheck the authoritative time gate immediately before each network/write action; on hold, retain prepared files/session and stop rather than sending a cancellation request.
4. Supervise one synthetic protected CMS upload above16MiB through this same transport. Require provider completion **and** the independent streamed readback's exact whole digest/count. Separately verify v1 small-archive behavior and denied unsigned/wrong-scope requests. Only then accept an ordinary existing-timer invocation with its original capture timestamp and native restore proof. No simulated private data or deliberately failed production backup is needed.
5. The unchanged10-minute service limit can require multiple ordinary invocations for a multi-GiB copy. A held/terminated upload resumes its existing pending session; it does not become a fresh capture. Roll back only the two source files if required, keeping all ciphertext, receipts and the prior native latest success. Resume state is private, and no final object is deleted.

## Operator-owned WordPress artifact through the same transport

The uploader accepts an **already outer-encrypted CMS EnvelopedData DER** file, regardless of the opaque inner archive. It does not run WordPress or inspect its plaintext. Stage that protected outer ciphertext under the existing backup directory, root-owned0600, with a distinct recovery-artifact name:

```text
/var/lib/yarden-cms-backup/derech-recovery-wordpress-<ORIGINAL_CAPTURE_UTC>.cms
```

Use the original verified WordPress capture time, not the outer encryption time or today's upload time. A capture older than seven days is rejected; do not relabel it to bypass the age gate. Independently calculate outer-ciphertext SHA256 and byte count in bounded chunks. Preserve the existing original encrypted ZIP and the owner's recovery key independently.

When the exact time policy permits, the explicit manual command is:

```sh
python3 /opt/yarden-cms-backup/backup_upload.py \
  --operator-recovery \
  --archive /var/lib/yarden-cms-backup/derech-recovery-wordpress-<ORIGINAL_CAPTURE_UTC>.cms \
  --created-at <ORIGINAL_CAPTURE_UTC> \
  --expected-sha256 <OUTER_DER_SHA256> \
  --expected-size <OUTER_DER_BYTE_COUNT>
```

Replace placeholders with privately verified metadata; there are no secret command-line arguments. This uses the same existing upload config, HMAC, fixed origin, private bucket, native multipart protocol, calendar and exclusive `backup.lock`. It writes only the artifact's derived `.recovery-copy.json` and bounded encrypted `.readback.partial`, without touching native CMS `latest.json` or `last-attempt.json`. Its success requires full independently read ciphertext SHA/count and retains the original capture timestamp. A time hold returns75, preserves resumable state and sends no abort; repeating this same explicit command later resumes the same session. No timer/service/job/poller is added and no native freshness health is advanced by an unrelated WordPress artifact.

The final object keeps the established `derech/derech-main/YYYY/MM/DD/<capture>-<outer SHA>.cms` key format. Independent provider recovery can download that exact opaque object with existing owner authority, compare its whole SHA/count, decrypt using the existing recovery key, then restore its **WordPress** inner archive in the already isolated recovery workflow. It must not be passed to the native CMS SQLite restorer as though the inner format were a CMS snapshot.

### Original preparation gap (resolved by bounded parts below)

The original source AES-encrypted WordPress ZIP is not itself CMS DER. This task does **not** claim that its2.1GiB outer CMS file has already been created or uploaded. Standard `openssl cms -encrypt -outform DER` can buffer large content; OpenSSL's memory-bounded `-stream` mode emits indefinite-length BER, which the deliberately DER-only transport rejects. The [official OpenSSL CMS documentation](https://docs.openssl.org/3.6/man1/openssl-cms/#notes) confirms this distinction.

The bounded-memory preparation step has now been implemented and independently reviewed as described below; this earlier whole-object recipe is not a claim that the original2.1GiB ZIP was uploaded as one DER object. Do not silently use a full-memory2.1GiB encryption on the small existing VPS, switch the receiver to BER, create another key/destination, or claim WordPress off-server completion from the already verified native CMS backup. The **transport of an already prepared outer-DER artifact** is implemented and tested; raw-ZIP outer encoding and real provider/scheduled acceptance remain explicit gates.


## Bounded original-archive preparation (29 October)

The outer-DER memory gap is resolved by `recovery-bundle.py`: the existing certificate encrypts independent8MiB parts with standard OpenSSL CMS-DER and encrypts an ordered manifest binding each ciphertext/plaintext digest/count plus the original complete ZIP digest/count and original UTC capture time. No key, bucket, timer or freshness marker is created. Preserve `expected_manifest_sha256` independently of provider files; encrypted CMS does not itself authenticate the sender. Each part and manifest fits the existing v1 upload limit and operator-recovery filename contract. Upload parts first and manifest last, through that same operator path, then independently download ALL artifacts and run `restore` with the trusted pre-upload manifest digest. A native CMS latest success is not evidence for this separate WordPress copy.

Seven actualOpenSSL tests and independent review passed. The real2,252,296,880byte source ZIP was locally decrypted/reassembled from269parts with its original SHA256 unchanged. Provider upload/download acceptance remains separate; see operational audit records for actual state. Preparation failures retain only encrypted partial artifacts and require a new empty private directory; completed bundles resume byte-identically. Restore publishes a new private output only after all hashes match and never overwrites an existing destination.


## Observed live resource boundary,29October

Receiver version413d9720-4b10-4bd3-bb64-e38dc3c542d7 uses one bounded input allocation plus nativeDigestStream independent stored-byte verification. The same16MiB v1 limit, signed receipts, create-only PUT, v2 state and all encryption/identity checks remain. Small native CMS recovery and a bounded8MiB-DER live batch passed. A longer manual source-copy run still encountered1102/resource exhaustion at part195. Therefore full WordPress offsite acceptance remains pending; do not infer free-tier sustained capacity from synthetic or short live acceptance. Retain all ciphertext and signed receipts. The next controlled fallback must partition new v1/v2 writes atomically by size and preserve existing large v1 objects, not introduce overlapping protocol writers or a paidplan change.
