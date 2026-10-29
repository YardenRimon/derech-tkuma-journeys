# Review Site external monitor — installed, notifications pending

The bounded monitor is `scripts/site-review-monitor.py`. It performs four GETs to the fixed review origin only: `/api/health`, `/`, `/התצפיות/` and `/wp-includes/js/dist/hooks.min.js`. Health must report ready, review mode, 37 pages and the pinned release. Both HTML pages require HTTP and meta `noindex`; the asset must match its exact known SHA256. Each probe records latency. Responses are capped at 2 MB, requests time out after eight seconds, redirects are refused and no POST is possible. This tests source asset delivery, **not R2 upload/read or business transactions**.

The existing root-owned `/etc/yarden-answer-cms.json` schema was inspected in `answer-runtime/cms_bridge.py:195–206`. The monitor checks version1, enabled and exact origin, and reads only `serviceToken` for the documented Site-only `OAI-Sites-Authorization` header. It neither consumes nor sends the application's HMAC secret. Credentials, response bodies, customer data and provider errors are not persisted or printed. The optional `--public-only` mode consumes no credentials; origin access controls may then return403.

State lives in an owner-only0700 directory, with mode0600 atomic files and a singleton lock. The retained history is at most288 observations/seven days, plus at most100 event candidates. Failed observations must be distinct and fresh, cover at least15 minutes and number at least3. An unproven outage resets after a sampling gap above12 minutes. Clock rollback, future, stale or overlong samples are rejected. A successful check closes a short unannounced outage silently.

An `actionable_open` is a **candidate**, not an outgoing notification. It is emitted once into the durable event list; repeated checks retain the candidate without emitting another event. The monitor has no Telegram API, bot token, sender, outbox mutation, retry worker or scheduling code. Current operational-alert adapters accept named sources/codes; do not insert website incidents under an unrelated existing code.

A recovery candidate is created only after the opening was actually sent and a trusted operator adapter writes a protected root-owned receipt, supplied through `--opening-receipt`:

```json
{"version":1,"origin":"https://derech-tkuma-demo-20261016.daring-elf-3029.chatgpt.site","incidentId":"site-review:1","eventId":"site-review:1:open","state":"sent","messageId":123}
```

The adapter must map a real existing outbox `sent` row and positive Telegram message ID to the exact candidate before writing this assertion. Queued, sending, unknown, failed or mismatched receipts are rejected. No receipt means `recovery_pending_receipt`; there is no claim a recovery message was sent. Recovery is emitted only once. Candidate IDs and full probe evidence remain in the private state for future consumer deduplication. Deleting state resets generation IDs; preserve state and receipts together and never reuse an old receipt after reinitialization.

## Proposed installation (primary review required; not executed)

From the authorized server-side source checkout, prepare a dedicated installation without editing broker/worker or enabling anything yet:

```sh
install -d -m 755 /opt/yarden-site-monitor
install -d -m 700 /var/lib/yarden-site-monitor
install -m 755 scripts/site-review-monitor.py /opt/yarden-site-monitor/site-review-monitor.py
install -m 644 platform-cms/lib/site-release.json /opt/yarden-site-monitor/site-release.json
python3 /opt/yarden-site-monitor/site-review-monitor.py --state /var/lib/yarden-site-monitor/state.json --release-file /opt/yarden-site-monitor/site-release.json
```

Exit0 means this sample passed;1 means a failed sample was recorded;2 means configuration/state/monitor failure. stdout is bounded machine-readable JSON with `deliveryIntegrated:false`. Install the exact release JSON again when the expected content release changes; an unexpected release must remain a mismatch.

Only after root reviews and performs one supervised sample, a proposed systemd service is:

```ini
[Unit]
Description=Read-only external monitor of Derech review Site
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=root
UMask=0077
ExecStart=/usr/bin/python3 /opt/yarden-site-monitor/site-review-monitor.py --state /var/lib/yarden-site-monitor/state.json --release-file /opt/yarden-site-monitor/site-release.json
SuccessExitStatus=1
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
ReadOnlyPaths=/etc/yarden-answer-cms.json
ReadWritePaths=/var/lib/yarden-site-monitor
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
CapabilityBoundingSet=
```

```ini
[Unit]
Description=Check Derech review Site every five minutes

[Timer]
OnBootSec=2m
OnUnitActiveSec=5m
RandomizedDelaySec=15s
Unit=yarden-site-review-monitor.service

[Install]
WantedBy=timers.target
```

This is external to Sites and can detect a Sites outage while the VPS works. It cannot detect its own VPS outage; an independent outside heartbeat is a separate gate. Add the existing fail-closed Israel/Jerusalem time-policy wrapper before enabling the schedule, and preserve the existing sender's own time-policy check before every outgoing notice. No new schedule is installed by this change. The notification adapter must also preserve owner-only technical routing, deduplication, recovery receipt checks and existing outbox ownership.

## Validation and outstanding acceptance

Run `python3 -m unittest discover -s scripts -p 'test_site_review_monitor.py'` —14 meaningful injected-transport/clock/file tests pass. They cover health/release mismatch, both noindex layers, exact asset content, GET-only fixed targets, redirects, credential handling/redaction, private files, distinct observations, sampling gaps, clock errors, persistence, receipt validation, single recovery and retention.

The preparation section above records the original proposal; the installed state below supersedes it.

## Live installation — 19 October 2026

Primary reviewed the source and ran all 14 tests. `scripts/deploy-site-review-monitor.py` installed the monitor at `/opt/yarden-site-monitor`, protected state at `/var/lib/yarden-site-monitor` and enabled `yarden-site-review-monitor.timer` every five minutes. The supervised sample and initial timer sample both passed all four probes with 200 responses and the expected release/noindex/asset hash. Readback confirmed timer active/waiting and service Result=success, ExecMainStatus=0.

The actual unit uses a separate root0600 service-token-only config `/etc/yarden-site-monitor.json`. `InaccessiblePaths` prevents reading `/etc/yarden-answer-cms.json`; no HMAC is copied to the monitor config. A fail-closed runner checks the existing Israel time policy before any probe. No Telegram sender, outbox adapter, actual alert/recovery or independent VPS heartbeat is established; `deliveryIntegrated:false` remains explicit.

Native Site version9 was published from a full archive, source `8f9a67ba1e7826a8421f6eb49cec66e674103d96`, without changing contentRelease. Recurring monitor history is operational evidence, not a database/media backup. Remaining: 15-minute live observation window, existing outbox integration and end-to-end alert/recovery, independent VPS heartbeat. Domain, original WordPress, CMS permissions, indexing policy and billing were not changed.
