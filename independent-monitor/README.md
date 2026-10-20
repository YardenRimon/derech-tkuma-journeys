# Independent owner VPS watchdog — prepared only

This separate Worker evaluates the existing private R2 heartbeat outside the VPS. It adds no Telegram intake, tenant sender, outbox or poller. The optional direct owner DM is a narrow exception that still requires explicit approval for credential transfer and activation. **No deployment, credential transfer, real message or live outage/recovery acceptance has been performed by this change.** `ENABLE_NOTIFY` must equal the exact string `true`; omission and all other values send nothing.

## Fixed boundaries

- Production origin: `https://derech-vps-watchdog.22yarden22.workers.dev`.
- Binding `MONITOR_BUCKET`: existing private bucket `derech-tkuma-monitor-review`.
- Production read key: `monitor/derech/vps/heartbeat-v1.json`.
- Production CAS ledger: `monitor/derech/vps/watchdog-v1.json`. The Worker never writes the heartbeat.
- `FIXTURE_MODE=true` selects only `monitor/derech/vps/fixture/heartbeat-v1.json` and `monitor/derech/vps/fixture/watchdog-v1.json`, with status origin `https://derech-vps-watchdog-fixture.22yarden22.workers.dev`. Other origins are denied. Invalid fixture configuration fails closed. Fixed fixture messages explicitly say this is a delivery test and no real outage is being reported.
- Root configures the five-minute scheduled trigger. The only HTTP route is signed, read-only `GET /status`. There is no HTTP trigger, test, clock override, mutation, generic target or group route.

The policy derives from the existing pure `site-review-vps-policy.py`. A trusted R2 heartbeat must have exactly `{schema: "derech-vps-heartbeat/v1", observedAt, receivedAt, ready}`, integral UTC epoch seconds, no future receipt, at most60seconds observation/receipt difference, and no regression from the prior accepted heartbeat. Missing/uninitialized/malformed/unavailable reads are internal-only evidence.

A bad sample is `ready=false` or a heartbeat receipt older than600seconds. At least three distinct current outside observations spanning900seconds are needed. A regular five-minute schedule normally needs four bad observations to span15minutes. A gap greater than720seconds resets the evidence. Unknown reads reset it too. An unsent pending incident is cancelled/archived as `observation_lost_before_notice` after unknown input or a gap, including sacred-time reopening; the next bad observation starts a new evidence sequence. Recovery before an opening was sent cancels the unsent notification. A sent opening remains open until a fresh healthy heartbeat permits its single recovery notification to the same verified private destination.

## Sacred-time policy

`calendar.json` is compiled from the exact shared offline Jerusalem policy, including Israel holidays and the authority's120-second pre-closure margin. These intervals already include that margin; the Worker adds a12-second operation lookahead. Its schema, source hashes, pinned library versions, validity bounds, interval ordering and full SHA256 are verified locally. Current SHA256: `848224e2f848aa551df3c13efdacb9d997530547be40a6499fed3a0594e82f51`.

The bounded calendar covers UTC epoch seconds1790812800 through1859241600, with121merged closed intervals and1846authority-equivalence checks. Malformed, modified, expired and out-of-range calendars fail closed. Renewal requires regenerating from the same reviewed authority and updating the reviewed pins; an expired calendar must never be treated as permission to act. No calendar is fetched from the VPS.

The gate runs before each R2 read/body read/write and external request, and is rechecked before the send and receipt commit. A closure reached after a durable sending claim prevents sending or committing, leaving that claim frozen for manual resolution. The provider call has an eight-second deadline, never follows redirects, and never retries automatically.

## Durable delivery rules

The fixed R2 object is a scoped, versioned CAS ledger with up to32closed incident summaries. Every observation/update uses R2 conditional writes. Before reading the heartbeat, the Worker CAS-persists a unique `observationAttempt` marker in that same ledger. The trusted observation clears it only in the final CAS (or the durable sending claim). A crash, unknown heartbeat followed by a failed reset write, or lost attempt acknowledgement leaves the marker present. The next invocation clears the abandoned evidence and cancels any unsent incident before starting its own attempt; it must build three new observations spanning900seconds. Sent and frozen delivery claims are retained unchanged. A `sending` claim is durably confirmed **before** the first provider POST. Concurrent requests that lose the CAS never send. Response acceptance requires HTTP200 JSON, `ok=true`, a positive integral `message_id`, exact equality of `result.chat.id` with the configured positive personal `OWNER_CHAT_ID`, and private chat type. Only that small verified receipt is persisted.

An uncertain network/result, missing receipt or unconfirmed post-send commit freezes that same incident as `sending` or `uncertain`. Later schedules never automatically resend it or invent recovery. Keep the ledger intact when disabling or rolling back code. A frozen claim requires private investigation of the actual owner receipt and a separately reviewed CAS repair; deleting the ledger or clearing a claim to "retry" can duplicate a delivered alert. No remote repair/mutation route is provided.

Failures to read or write the authoritative ledger produce no send. No heartbeat is read until the current observation attempt has a positive durable CAS receipt. The observation marker and separate durable delivery claim prevent failed reads/writes or restarts from silently retaining pre-failure evidence or resending an uncertain alert.

No raw provider body, exception, credential, URL containing the bot token, heartbeat payload, account identity, IP address or unit information is logged or returned. Messages are fixed Hebrew strings. The status response reports only bounded operational state, revisions/timestamps and configuration booleans; it does not expose tokens, destination IDs or raw receipts.

## Read-only status protocol

Use a new, separate64-character lowercase hexadecimal `WATCHDOG_READ_HMAC`. It is never the heartbeat write/read credential or bot token. Headers retain the existing receiver protocol:

```
X-Derech-Heartbeat-Time: <10-digit UTC epoch seconds>
X-Derech-Heartbeat-Signature: <lowercase HMAC-SHA256>
```

Sign the exact UTF-8 string `GET\n/status\n<timestamp>\n<SHA256-of-empty-body>`. The skew limit is60seconds. No body or query is allowed. Anonymous/forged requests return401, unsupported routes/methods are denied, and every response has no-store/noindex headers. A valid signed read also obeys the sacred-time gate before touching R2. Production HTTP callers cannot supply clocks or alter scope.

## Local acceptance and release steps

Run from the canonical repository with Node24:

```
node independent-monitor/test-worker.mjs
node independent-monitor/test-worker.mjs --workerd
```

The second command uses the existing installed platform-cms Miniflare/esbuild packages, an ephemeral real Workerd/R2 instance, local-only Miniflare scheduler support and blocked external transport. That development harness is absent from the deployed Worker and provides no production trigger. Twenty-one isolated cases and the real default scheduler/status/R2 CAS race pass. Coverage includes stale/ready-false persistence, replay/gaps/unknown input, pending cancellation/rebuilding, abandoned observation attempts and failed reset commits, disabled notification, exact recipient validation, claim races, pre-send claims, uncertain outcomes, lost commits, opening/recovery once, sacred closures/lookahead/expiry, malformed ledger freeze, fixture isolation and redacted errors. No external requests or actual messages are used.

Root release sequence:

1. Review the code and the compiled calendar against the existing authority. Bundle `worker.mjs` with its local policy/calendar; bind only the fixed private monitor bucket. Configure the separate read secret and five-minute cron, with notifications disabled and no bot credential yet. Verify exact-origin anonymous/forged denial and signed read/noindex/no-store behavior.
2. Obtain the explicit narrow approval for copying the existing bot token into the two purpose-scoped Worker secret stores and sending opening/recovery test messages to the exact approved positive owner DM. Keep token and actual owner ID in private config/secret management, never Git, artifacts or model input. `OWNER_CHAT_ID` rejects groups/zero/nonintegral IDs; the bot token must match the bounded Telegram token format.
3. Use a separate temporary fixture Worker with `FIXTURE_MODE=true`. Write test heartbeat data only to its separate fixture key through the authorized private administration path. Allow actual distinct scheduled observations spanning at least15minutes; do not backdate the ledger, override clocks, accelerate with an HTTP trigger or alter the production heartbeat. Verify one clearly labelled opening and one recovery via the real positive private API receipts, inspect the matching durable ledger, and obtain owner acknowledgement separately. API acceptance does not prove the owner read the message.
4. After fixture acceptance, root activates the approved production owner DM config without fixture mode and verifies continued real heartbeat reads and durable outside observations. Do not deliberately stop production services to manufacture an outage. Production outage/recovery delivery remains a separately stated acceptance condition until actually evidenced.
5. Disable with `ENABLE_NOTIFY=false` or remove the cron while preserving the ledger and heartbeat receiver/producer. Rollback must preserve accepted receipts, generation, claims and later writes. Do not deploy a second sender or tenant notification flow.
