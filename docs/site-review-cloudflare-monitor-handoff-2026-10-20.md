# Prepared second public review monitor — 20 October 2026

Status: source prepared and locally tested; not installed, scheduled or verified live by this preparation. The current native Site remains the default monitored target with its existing state, alert ledger and sender. This public monitoring work requires no CMS/backup/bridge HMAC transfer and does not authorize or perform one.

## Fixed scopes and existing runner

The existing monitor and alert adapter accept only `--target sites` (default) or `--target cloudflare`, selected once per process. There is no configurable arbitrary origin. Cloudflare is exactly `https://derech-tkuma-review.22yarden22.workers.dev`. Both profiles check the same four bounded GETs: `/api/health` (ready, review mode, pinned content release,37 pages), `/`, `/התצפיות/` (HTTP and meta noindex), and the existing exact-SHA `hooks.min.js`. Redirects remain rejected. These are public/content-safety probes; they do not prove authenticated CMS, media write, backup or bridge operation.

Cloudflare mode never reads the Sites service configuration and rejects any supplied credential. Its request headers contain only the fixed public User-Agent and cache control. No Access token, cookie, Sites token or CMS secret is sent. Native Sites mode retains the existing token-only file and all previous checks.

`scripts/site-review-targets-runner.py` loops over both fixed targets from the **existing** monitor service/timer and existing alert callback. It creates no timer, daemon, bot, sender or CMS write path. Each target runs in a separate subprocess. One target's failure does not suppress the other, and the authoritative Israel time policy is checked again before each invocation. Child output/errors are never echoed. Monitor results0/1 retain the existing `SuccessExitStatus=1` callback behavior; adapter failure yields an alert-service failure after both adapters were attempted.

| Target | Private state | Alert ledger in the same tenant DB |
|---|---|---|
| Native Sites | `/var/lib/yarden-site-monitor/state.json` | `site_review_notices` (unchanged) |
| Cloudflare | `/var/lib/yarden-site-monitor/cloudflare-state.json` | `site_review_cf_notices` |

Each state/ledger rejects a foreign origin; outbox incident keys also include the origin digest. Cloudflare uses separate private container code staging. Its readback excludes the native acceptance drill. Native history and receipts are never migrated or rewritten. Both targets retain the same verified owner-only DM, sole tenant outbox and sender, no group/Raziel technical messages, at least15 minutes plus3 distinct fresh observations per known action, action-specific persistence, queued-opening cancellation on recovery, and recovery only after a positive actually-sent opening receipt. Generic provider/network failures remain internal. No fake outage or real outgoing drill was run.

## Root installation proposal, not executed

Preserve the existing source, service definitions/drop-ins, timer status and both current native ledger/state snapshots before installation. Verify the authoritative calendar is open before any server change. Stage only these reviewed source files from the workspace, then install root-owned0644 under `/opt/yarden-site-monitor/`:

```text
scripts/site-review-monitor.py
scripts/site-review-alerts.py
scripts/site-review-targets-runner.py
```

Keep `/opt/yarden-site-monitor/site-release.json` at the reviewed content release shared by both accepted copies. Keep canonical trusted ops copies and all existing credential files unchanged. Do not run the original provisioning deployer just to add Cloudflare: this extension needs no secret extraction or config generation.

Add only `/etc/systemd/system/yarden-site-review-monitor.service.d/dual-target.conf`:

```ini
[Service]
ExecStart=
ExecStart=/usr/bin/python3 /opt/yarden-site-monitor/site-review-targets-runner.py --kind monitor
TimeoutStartSec=120
```

And `/etc/systemd/system/yarden-site-review-alerts.service.d/dual-target.conf`:

```ini
[Service]
ExecStart=
ExecStart=/usr/bin/python3 /opt/yarden-site-monitor/site-review-targets-runner.py --kind alerts
TimeoutStartSec=180
```

The timeout extensions cover two sequential bounded targets without a second poller. Preserve all original hardening, inaccessible secret paths, AF_UNIX-only alert unit, state ownership, `OnSuccess` callback and five-minute timer. Root should validate resulting units, daemon-reload and run the existing monitor service once. The callback can then process both fresh states through the existing outbox; no new scheduling command is required. Require four successful probes per target and correct distinct origins before claiming live installation. Observe a later existing timer run as a separate acceptance check.

Read delivery receipts separately with the existing adapter's `--readback --target sites` and `--readback --target cloudflare` on an allowed calendar window. A healthy supervised sample should not enqueue any notice. Confirm native state history remains intact, the sole sender/container count is unchanged and no credentials are present in the journal. Local fixture coverage is not actual Telegram delivery.

Rollback: remove only these two new drop-ins, restore the prior reviewed script copies if needed, daemon-reload and confirm the existing native monitor/callback/timer. Retain Cloudflare state and ledger for audit; do not delete outbox/history or alter CMS/backup/bridge configuration.

## Focused verification

`python3 -m unittest discover -s scripts -p 'test_site_review_*.py'` covers the existing policies plus fixed Cloudflare public headers, credential rejection/config-read avoidance, origin isolation, both ledgers in one tenant DB, independent receipt-gated recovery, no duplicate recovery, sacred-time/network policy, and sequential runner behavior. These tests use private local SQLite and injected transports; they send no external requests or messages. Existing portable fixture dependencies remain required for the CI suite.
