# Scoped backup failure/recovery notices — prepared only

New files: `notify.py`, `notify.service.example`, `test_notify.py` and this document. This work did not edit the uploader/current deployment scripts, install a live notifier, create another sender/poller, read provider credentials or send any message.

## Admission and recipient

The host collector reads the **actual** `yarden-cms-backup.service` Result, ExecMainStatus, start/exit timestamps and invocation identity. It reads only the root-owned mode0600 `last-attempt.json`, checks a fresh completed run (exit within30 minutes, at most20 minutes duration), and requires the attempt's `invocationId` to match the actual service run. `createdAt` must correspond to the service start, rather than an old successful backup.

Inactive oneshot units may clear their InvocationID property. In that case the collector reads only `_SYSTEMD_INVOCATION_ID` journal metadata for this exact unit/run interval; it does not request or inspect journal MESSAGE content. Missing or ambiguous identity fails closed. A failed full backup run can generate one immediate notice; there is no invented website outage or generic provider-event notification.

Root already added `invocationId` to capture-start last-attempt and to the encrypted report. Keep that field through finalization. A success needs actual service Result=success/exit0 **and** a complete/offserver_copy_verified report with a complete matching verified-copy receipt: protocol, exact tenant/site, ciphertext size/hash, capture time and derived object key. Missing receipt fields do not qualify. A partial capture/local-only encryption/upload attempt cannot resolve a failure.

Only the verified owner885011787 receives fixed technical wording through the existing Derech outbox. Tenant/group/bot binding remains derech/-5379385865/8905221076 and owner-DM proof is checked through the existing canonical helper. There is no group or Raziel fallback, no new customer task, arbitrary recipient, request URL, error-body forwarding or provider secret. The source projects only opaque run state and timing into the container.

The notifier reuses root-owned current `site-review-alerts.py` transport/outbox helpers and the same canonical operations module copies. It stages code in a separate owner-only temporary directory inside the already-running sole tenant container. It never constructs Bridge, invokes a sender, flushes a queue, polls Telegram or changes canonical owner-alert policy.

The authoritative Israel/Jerusalem calendar is checked before processing and again before each queue/cancel write. Missing/closed calendar fails closed. The existing sole sender retains its own check before delivery. This is not a calendar exception.

## Ledger and actual receipt handling

The separate `cms_backup_notices` ledger lives in the existing legacy tenant SQLite database; it does not change the CMS D1 schema or snapshot contract. An incident key derives from the actual invocation and capture timestamp. Repeated OnFailure/manual calls cannot queue another notice for the same failed run. Outbox destination, text hash, entities, markup and state are checked on replay.

A fresh later verified successful run resolves older failures:

- Opening still queued: cancel only that queued row as failed/backup_recovered_before_delivery; no recovery notice.
- Opening sending/unknown, or sent without positive message ID: defer recovery.
- Opening delivery failed: do not retry or send recovery.
- Opening actually sent with positive message ID: queue one owner-only recovery under the stable incident key.

Later reads/replays do not create duplicate recovery rows. An older success cannot resolve a later failure. A queued row never proves delivery. `--readback` reports deliveryVerified=true only when the actual existing outbox row is sent with a positive messageId; it never claims the owner read it.

## Proposed installation and checks — primary only

Install `notify.py` as `/opt/yarden-cms-backup/notify.py`. Review/install the template `notify.service.example` as `yarden-cms-backup-notify@.service`, and add these existing-backup-unit hooks:

```ini
OnFailure=yarden-cms-backup-notify@failure.service
OnSuccess=yarden-cms-backup-notify@success.service
```

No notifier timer is needed. Keep its fixed AF_UNIX transport, ProtectHome, strict filesystem protection and inaccessible export/upload/HMAC/service secret files. The empty credential-free Docker config and exact existing-container transport are reused; do not introduce a Cloudflare admin token, S3 key or bot token. Docker access remains the same privileged transport boundary already used by scoped server operations, so review the supplied unit before installing it.

Before activation, verify root-owned canonical sources at `/opt/yarden-site-monitor/site-review-alerts.py` and `/opt/yarden-site-monitor/ops/{organic_import.py,tenant_holds.py,weekly_telegram.py,client_notifications.py}`. The notifier has no need to read any secret config. It does need to read service metadata and journal invocation metadata locally.

After a genuine fresh run, the appropriate callback can be invoked with `--failure` or `--success` (also `--event failure|success`). These are **operational queue actions**, not dry runs; do not invent a failure or alter a real service/attempt just to test them. Start with isolated tests:

```sh
python3 -m unittest discover -s backup-receiver -p 'test_notify.py'
```

Read authoritative receipt states without queueing a notice:

```sh
python3 /opt/yarden-cms-backup/notify.py --readback
```

The first real failure callback requires the exact failed run's metadata still present. Do not backfill a previous failed run after a new success replaced last-attempt.json. No old whole database should be restored to roll back notifier code: preserve current answers, outbox and notice ledger.

## Evidence and remaining gates

**13 focused tests pass** with the portable, explicitly labelled Derech-only dependency fixture. They cover one full-run failure notice/replay, quiet success, queued cancellation, actual-sent positive-ID recovery, uncertain delivery deferral, no failed-delivery retry, stale/future/mismatched evidence, unverified copy rejection, sacred-time protection, owner-DM/no-group-fallback, tampered receipt destination, recovery ordering, and readback truthfulness. Compilation passes. These are isolated SQLite tests and do not claim that a live failure/recovery message was sent.

Remaining: primary review/install, verify real systemd timestamp/invocation collection in the deployed sandbox, a forward genuine callback and actual outbox delivery readback when applicable. No outage, fake failure record or real message was created by this preparation.
