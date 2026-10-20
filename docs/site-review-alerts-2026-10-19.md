# Site review alerts — bounded adapter handoff

Current verified state,19October20:15UTC: the adapter is installed and its supervised service run succeeded with ExecMainStatus0; the monitor succeeded and its existing timer is active. The latest adapter receipt is processed with no notices, and protected outbox readback is empty. No acceptance drill or outgoing notice was performed. Source CMS, canonical owner-alert policy, bot, poller and sole sender are unchanged. Evidence: `../audit/site-review-alert-repair-2026-10-19.json`.

## Fixed scope and behavior

`scripts/site-review-alerts.py` reads the root-owned monitor state for the exact existing review origin. It validates all four probe identities, allowed result codes, increasing timestamps, observation freshness, bounded request duration, current last-sample age (90 seconds), and seven-day history bounds. It independently proves **at least three consecutive action-specific failed observations over at least15 minutes**, with no sampling gap above12 minutes. A long unrelated transport outage cannot age a newly detected noindex failure.

Only three known developer actions can queue a notice: restore the review site's missing HTTP/meta noindex; inspect an unexpected health/release response; restore the exact verified hooks.min.js asset. Transport, provider, HTTP/auth, redirect, unknown or oversized-response failures remain private `internal_only` diagnostics. These do not create customer tasks, notify Raziel or fall back to a group.

The adapter reuses the current deployed `weekly_telegram.protected_file`, `read_json`, `_identity`, tenant metadata and `client_notifications.owner_dm` helpers. It inserts into the **same sole outbox schema** and transaction pattern used by the existing owner-alert helper and `Bridge.enqueue_report`, with an additional scoped `site_review_notices` ledger. It does not construct Bridge or read any Telegram credentials. The exact recipient is the already verified owner885011787, tenant derech, group binding-5379385865, bot8905221076. All outgoing rows are owner-private reports without mentions, buttons or arbitrary text.

The authoritative `/opt/yarden-time-policy/time_policy.py` is required before host mutation, inside the container transaction and immediately before queue/cancel writes. Missing calendar or a closed gate fails closed. The existing sender retains its own sacred-time check. No local weekday approximation or calendar exception is introduced.

An opening candidate queues once under a stable scoped key. Replays verify destination, text hash, kind, entities, markup and delivery state; they never retry failed or uncertain sends. A fresh fully healthy observation:

- Cancels an opening still `queued`, as `failed/resolved_before_delivery`, without a recovery message.
- Defers recovery while the opening is `sending`, `unknown`, or lacks a positive message ID.
- Resolves a failed opening without retry or recovery.
- Queues exactly one owner-private recovery only after the actual opening row is `sent` with a positive Telegram message ID.

The monitor's optional opening-receipt file is not required: this adapter reads authoritative outbox receipts directly. Monitor state and alert ledger remain separate. No old whole database may be restored over concurrent answers/outbox records to roll back this code.

## Primary deployment and schedule integration

The primary-authorized installation used the existing monitor installation; these are the source locations for later reviewed updates:

```sh
install -m 755 scripts/site-review-monitor.py /opt/yarden-site-monitor/site-review-monitor.py
install -m 755 scripts/site-review-alerts.py /opt/yarden-site-monitor/site-review-alerts.py
```

Keep the monitor's separate token-only `/etc/yarden-site-monitor.json`, existing service credential and `InaccessiblePaths=/etc/yarden-answer-cms.json`. The alert adapter has no use for either credential file.

The adapter host CLI uses bounded `docker --config /opt/yarden-site-monitor/docker-config exec -i yarden-shared-platform-derech-legacy-1` calls, copying only canonical code helpers into its own mode0700 temporary directory inside the same legacy container; shared temporary modules are untouched. Before enabling a schedule, confirm `/opt/yarden-platform/shared-ops` contains current `organic_import.py`, `tenant_holds.py`, `weekly_telegram.py`, `client_notifications.py`, and that the existing container can read the mounted authoritative calendar. It targets only the already-running `yarden-shared-platform-derech-legacy-1` container, `/data/bridge.sqlite3` and `/data/runtime.json`. The root-owned Docker config directory is empty and credential-free; direct exec avoids Compose plugin discovery and `/root/.docker` under `ProtectHome=yes`. It never creates, starts, restarts or scales a container.

Run one supervised real-state pass after the monitor has just sampled:

```sh
python3 /opt/yarden-site-monitor/site-review-alerts.py --state /var/lib/yarden-site-monitor/state.json
python3 /opt/yarden-site-monitor/site-review-alerts.py --readback
```

A healthy site with no ledger history queues nothing. `queued` means awaiting the existing sender; `deliveryVerified:true` is emitted by readback only for an actual outbox row with `sent` and positive messageId. It never means the owner read the message.

Schedule this adapter after a fresh monitor pass under the existing fail-closed sacred-time wrapper. For a separate oneshot unit, use the existing approved sacred wrapper to execute the adapter, order it after the monitor unit, and give it access to Docker's existing sole tenant container. Do not reuse the monitor's restrictive filesystem unit unchanged: the adapter needs the canonical operations modules, calendar and Docker socket, while the monitor should retain its narrow token-only access. Root must review the final unit privileges; this source change installs no unit or timer.

## Isolated fixture and optional explicit delivery drill

The portable SQLite tests exercise the adapter with the explicit minimal dependency contract in `scripts/site_review_alerts_test_fixture.py`, the existing outbox/owner-DM schema and injected receipt states. The fixture contains only Derech identity and no other client metadata; canonical operations modules are not required or published by CI. It is not an implementation or security audit of the production helpers. Actual deployed canonical-helper integration is independently verified by the private scoped live readback (`audit/site-review-alert-readback-2026-10-19.json`). Run the portable suite locally or in CI:

```sh
python3 -m unittest discover -s scripts -p 'test_site_review_*.py'
```

**35 tests pass**:15 monitor tests and20 adapter tests. They include future/stale/duplicate observations, action-specific persistence, gaps, no group/Raziel fallback, exact owner identity, sacred gate rollback, protected files, message/payload conflicts, queued cancellation, uncertain delivery deferral, actual-sent receipt recovery, replay deduplication and secret redaction. The tests send no messages and never treat fixture message IDs as live delivery proof.

If the primary decides to verify actual transport, explicit labelled drill commands are available. They queue **test notices**, with their own `site_review_acceptance` ledger and `fixture:true`; they never fabricate a real outage or write fake monitor samples. The run ID must be actual UTC in the shown format and at most one hour old. Resolve one concrete fresh run ID, retain it, then use exactly the same ID for both stages and retries:

```sh
python3 /opt/yarden-site-monitor/site-review-alerts.py --acceptance-stage open --run-id 20261020T120000Z
python3 /opt/yarden-site-monitor/site-review-alerts.py --readback
```

The displayed timestamp above is an example, **not an executable current run ID**. Wait for the existing sole sender's ordinary cycle, without starting a sender or flushing manually. Readback must show the acceptance opening `sent`, positive messageId, `deliveryVerified:true`. Only then:

```sh
python3 /opt/yarden-site-monitor/site-review-alerts.py --acceptance-stage recovery --run-id 20261020T120000Z
python3 /opt/yarden-site-monitor/site-review-alerts.py --readback
```

The recovery command returns `recovery_deferred` until the actual opening receipt qualifies. Running either command again uses the same durable key; failed/unknown outcomes are not retried. Preserve a private sanitized receipt with both message IDs. A live drill proves the labelled queue→existing-sender→API acceptance path; it does not prove the owner read it or that a genuine live outage persisted for15 minutes. Live non-disruptive monitor observations and fixture threshold tests remain separate evidence.

Remaining acceptance after the successful supervised installation: optional explicitly labelled transport drill and actual receipt readback; a forward scheduled monitor→adapter run. The supervised fresh-state pass and service ordering/time-policy integration are installed and verified separately from delivery acceptance. No fake incident, real Site outage, DNS change, Raziel task or customer-group notice is necessary for these checks.

## Sandbox transport repair

A supervised transient diagnostic under the exact service restrictions found Docker home-config access denied and `docker compose version` exit125, while the same protected outbox readback worked outside the sandbox. This was a transport/plugin discovery failure before container execution, not a tenant/database/auth failure. The adapter now uses direct Docker exec with a fixed empty config directory and the exact existing container. ProtectHome, AF_UNIX restrictions, inaccessible HMAC/token files and the sole sender remain unchanged. A regression test checks the exact command boundary and suppressed provider stderr. No acceptance message was queued during diagnosis/repair.

Repair deployment evidence19October20:15UTC: alerts and monitor Result=success/ExecMainStatus0; source SHA2568bc42bf62577a52088cd69e99aa377a42d52a220f705017d9acb7d27cc838d05 matches local; monitor timer active; adapter processed with notices[]. Rollback files are under `/opt/yarden-site-monitor/prior-alerts-20261019T201501Z`. Restore code/unit only if needed; preserve current live ledger/outbox and concurrent client answers.

CI portability handoff: include `scripts/site-review-monitor.py`, `scripts/site-review-alerts.py`, `scripts/test_site_review_monitor.py`, `scripts/test_site_review_alerts.py` and **`scripts/site_review_alerts_test_fixture.py`**. No `work/project-updates-2026-10-19` modules or unrelated tenant configuration is needed. An isolated temporary checkout containing exactly those five files passed all35 tests, proving the suite does not depend on private server-source paths. The monitor CLI redaction test supplies its own release fixture.
