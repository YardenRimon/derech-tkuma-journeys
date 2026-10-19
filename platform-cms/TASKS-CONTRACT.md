# Site task projection and review gateway

`/admin/tasks` reuses the protected CMS membership and site scope. It is an interface to existing platform `work_items`, not a replacement task registry. It supports content review, source contradictions and access requests. Source quotes/questions remain immutable to the assignee; answers and status requests enter a durable command queue. Importing current site content is independent of unresolved review questions; no task operation publishes or edits a page.

## Authority and identity

- Authoritative tasks: existing tenant SQLite `work_items` used by Telegram, with existing numeric `id`, stable `item_key`, assignee Telegram identity, status and `updated_at`. Do not create another work item when projecting it here.
- Gateway snapshot `externalId` is that existing numeric `id` as a string. `externalVersion` must be a hash of a canonical authoritative snapshot including task fields, evidence/answers, assignment and `updated_at`; SQLite currently has no revision column. Never call the local D1 `revision` a source revision.
- D1 is a site-scoped projection plus audit and unsynchronized commands. Tenant/site are resolved by the server and checked against the deployment DB. Callers cannot select either. Admin reads all site tasks; editors read/answer only tasks assigned to their normalized verified CMS email. No imported task grants CMS membership.
- The trusted integration maps the already verified Telegram identity to an explicitly approved CMS account; it must not infer the account from a display name. `derechtkuma@gmail.com` is the organization account approved for this site; linking it to Raziel is a deliberate integration choice, not evidence of a separately verified personal email. Never expose Telegram numeric identities in client labels.
- `sourceUrl` is an HTTPS reference, not a server-fetch instruction. `quotedContent`, `question`, `linkedTarget` (human page/field or collection label) are preserved as supplied, including whitespace. `sourceHash`, when supplied, is the lowercase SHA-256 of the captured source artifact/quote identified by the integration. Hash scope must be recorded in its source-capture manifest. Absence is represented by an empty string; never invent a hash.

## Existing session protected API

GET `/api/tasks`: own assigned records (admin: this site's records). GET `?id=<externalId>`: record, command results and immutable audit. GET `?gateway=1`: admin-only pending command export, maximum 200. All reads are `no-store`. There is no public task endpoint.

POST `/api/tasks` requires the same verified CMS session, current role and exact same Origin as other CMS mutations. No static token, bearer shortcut, new sender or background process is introduced. Body limit: 50 KB. Import requires administrator role (`users` permission):

```json
{
  "operation": "import",
  "expectedRevision": 0,
  "snapshot": {
    "externalId": "27",
    "externalVersion": "sha256:<canonical-authoritative-snapshot-hash>",
    "title": "בירור מחיר הסיור",
    "category": "content_review",
    "sourceUrl": "https://derech-tkuma.com/סיורים/",
    "sourceHash": "",
    "linkedTarget": "עמוד סיורים · מחיר בכרטיס הסיור",
    "quotedContent": "הטקסט הנוכחי כפי שנקלט",
    "question": "איזה מחיר נכון?",
    "assigneeEmail": "derechtkuma@gmail.com",
    "assigneeLabel": "רזיאל",
    "status": "waiting_info",
    "answer": ""
  }
}
```

Allowed category: `content_review`, `contradiction`, `access_request`. Existing authoritative status vocabulary: `open`, `in_progress`, `waiting_info`, `blocked`, `done`, `cancelled`. Reimporting the identical source snapshot at the current local revision is a no-op. Changing source fields without a new externalVersion returns 409. A real source update increments the local revision and records audit.

An authorized assignee submits `operation=request`, `id`, `expectedRevision`, a stable random `key` (16–100 ASCII alphanumeric/underscore/hyphen), `answer`, and `requestedStatus`. HTTP 202 means **stored here, pending synchronization**, not delivered to Telegram or applied to `work_items`. Same key/payload/actor replays safely. Changed payload under the same key, stale revisions and a second pending request return 409. Source status/answer remain unchanged while pending.

## Gateway application and receipts

The integration must revalidate tenant, existing item ID, current authoritative assignee/role and canonical externalVersion before applying a command to the existing task service. Do not execute arbitrary answer text, publish content, widen account permissions or send Telegram messages merely because a response was saved. Use command `key` as the authoritative application's idempotency key and persist the receipt alongside its transaction. A changed source or assignment must reject the command rather than overwrite newer work. Treat `done` as the same workflow transition allowed by existing operations, not proof that a requested external access grant happened.

After application, capture a fresh authoritative snapshot and import at the current local revision with `receipts: [{key,state:"accepted",note:"..."}]`; accepted receipts require a changed externalVersion and matching source status. Import the resulting confirmed answer/evidence into `snapshot.answer`. Rejection uses `state:"rejected"`, a human explanation and the current authoritative snapshot, and may retain its externalVersion. Both paths append audit and release the pending UI. Reimporting an existing task without a receipt leaves its command pending. A rejected command does not silently resubmit.

One-off CLI: `node --experimental-strip-types scripts/task-gateway.mjs import <sanitized.json>` validates an array of `{snapshot, expectedRevision, receipts?}` with no network. `--commit` uses `CMS_TASK_ORIGIN` and an ephemeral existing `CMS_TASK_SESSION_COOKIE`; it never writes a credential. `export --commit` reads pending commands for that site. In an authenticated owner browser the same JSON can be sent through `fetch('/api/tasks', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)})`; the browser supplies the session and Origin. Validate seed records and read them back before presenting the list as current.

## Acceptance and remaining gates

Apply migration 0005 after 0000–0004. Test via `node --experimental-strip-types scripts/test-tasks.mjs` and local HTTP suite `scripts/test-tasks-http.mjs`. Lists/commands cap at 200 and history at 100; this pilot needs pagination before scaling beyond those limits.

No automatic Telegram/service bridge is connected in this implementation. Its explicit mode is `manual-gateway`; pending answers require the trusted gateway action above. Deployment, migrated live DB, real sanitized snapshots, organization-account login, browser mobile/desktop acceptance, and authoritative round-trip receipt verification remain integration gates. Do not claim successful web-to-Telegram synchronization before that last check.


## Automatic server gateway addendum — 19 October 2026

The historical manual-only gate above is superseded **only when** the current integration audit verifies an enabled live gateway. The existing Hetzner broker/worker now implement a fixed-origin, HMAC-authenticated `/api/execution` transport. They mirror authoritative current tasks and consume authenticated CMS commands with stable version/assignment checks, separate genuine CMS origin tables and the existing model/execution pipeline. No fabricated Telegram messages or second task registry. Source question metadata for IDs30–36 is derived from exact trusted item keys and source-review evidence in the live SQLite. Pending commands remain pending until authoritative receipts; a processed answer may still have a rejected requested-status change. See EXECUTION-CONTRACT.md and audit/cms-server-execution-2026-10-19.json. Manual import/export remains an administrator recovery path. The connector initially remains disabled until the integrating site owner verifies baseline, login and endpoint behavior; code deployment alone is not enablement.
