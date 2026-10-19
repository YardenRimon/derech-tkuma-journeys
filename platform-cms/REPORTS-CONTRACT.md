# Administrative operational reports

`/admin/dashboard`, `/admin/reports`, and GET `/api/reports` require the existing verified CMS session and current `users` administrator permission. The server resolves tenant/site, and the existing access layer verifies deployment isolation. API responses, including errors, are private/no-store. There is no report mutation, public report, external fetch, or execution endpoint. Query parameters cannot select another site. React escapes source strings.

The dashboard reads the current site's D1 task mirrors, task-command receipts, collection records and immutable collection history. Authoritative task ownership remains the server SQLite work_items. Source timestamps identify projection import times, not verified server health or successful continuous synchronization. The oldest projected task import determines freshness; after 15 minutes it is visibly stale, and absent/future-invalid timestamps are distinguished. Task lists and content lists cap at 200; counts labelled 'in list' refer to that bounded list, while total counts are separate SQL counts. History shows the 100 most recently appended rows.

Pending commands remain pending, accepted commands indicate source task reconciliation only. The requested status and the confirmed/rejected/pending command result are separate columns. An information task marked done is not proof of external work. A CMS draft and a published CMS record are separate; publication in the database is not itself proof of live rendering. No traffic, lead, booking, payment or revenue metrics are fabricated.

## Execution mirror integration

No migration is required. The trusted scoped integration can store a **sanitized** operational snapshot in the existing isolated D1 `cms_settings`, key `server_execution_report_v1`. The report only reads it. The future ingestion endpoint belongs to the trusted gateway and must verify its existing server authorization, tenant/site, source timestamps and idempotency; report GET adds no write privilege.

```json
{"schemaVersion":1,"tenantId":"<configured tenant>","siteId":"<configured site>","sourceAt":"2026-10-19T18:00:00Z","jobs":[{"id":"stable-effect-id","itemId":26,"recipe":"lead_workflow","state":"executed_private","updatedAt":"2026-10-19T17:59:00Z","summary":"Private inquiry register created"}]}
```

Maximum 200 unique jobs, bounded strings, positive task IDs, valid timestamps and matching scope are enforced. Allowed states: queued, needs_review, failed, executed_private, cms_draft_applied, applied. Optional `cmsState` is applied_draft, conflict or rejected; applied_draft requires positive integer `cmsRevision`. The UI displays this destination receipt separately from private preparation. Unknown/malformed/wrong-site snapshots fail closed to an explicitly unavailable mirror. No source answer text, contact details, credentials or arbitrary receipt JSON should enter this mirror. 'Applied' is reported execution state, never an inferred publication or business result. Missing mirror does not imply healthy/failed/no pending server work. `sourceAt` must be the server snapshot observation timestamp, not a browser's current time.

## Acceptance and handoff

Run `node --experimental-strip-types scripts/test-reports.mjs`, then project typecheck. The test uses real isolated SQLite migrations and checks scoped SQL, command/content distinctions, stale/empty state, mirror rejection and static read-only/admin gate assertions. Authenticated HTTP/browser acceptance, live migrations and actual server mirror ingestion remain integration gates; no deployment is performed by this module. Shared admin navigation should add links to `/admin/dashboard` and `/admin/reports` for administrators only. Package scripts may add the focused report test to existing checks.
