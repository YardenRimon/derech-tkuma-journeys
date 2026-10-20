# Platform CMS SEO draft adapter

`audit.py` is a read-only Python standard-library adapter for the shared platform CMS. It reads the actual public collection routes defined by `platform-cms/app/api/public/collections/[kind]/route.ts`, using the content definitions in `platform-cms/lib/collection-core.ts` and published projection in `platform-cms/lib/collection-d1.ts`.

Exactly two fixed GET requests run on success:

- `/api/public/collections/tour`
- `/api/public/collections/occurrence`

Each response must be `{ "records": [{ "id": "resource-id", "content": {}, "version": 1 }] }`. The published version is an integer, IDs are the platform's bounded string resource IDs. Tour content requires exactly `title`, `slug`, `description`, `image`, `imageAlt`, with only the current optional `sourcePath` also allowed. Occurrences require `tourId`, `startsAt`, `endsAt`, `timezone`, `meetingPoint`, `priceMinor`, `currency`, `capacity`; the current `title`, `date`, `dateLabel`, and `note` fields are explicitly allowed and validated. Missing legacy dates may be derived only from an existing start timestamp. A pair of unknown timestamps requires a known valid date; half-known or inconsistent times fail. Unknown capacity remains null and an unknown meeting point remains empty. `unknown_occurrence_fields` reports these source gaps without inventing business data. Internal admin records, draft snapshots, extra tenant/account fields, generic CMS records, malformed fields and missing collections fail closed. Occurrences require a parent in the same published tour projection. No prices appear in draft proposals.

The public route selects published content only; it derives tenant/site scope from deployment-owned configuration and removes occurrences whose parent is withdrawn. These public responses deliberately omit tenant/site IDs: the adapter depends on the verified origin and deployment configuration for site identity. It cannot independently prove tenant membership from the payload. It never requests the authenticated admin routes or credentials.

The source allows only `https://derech-tkuma.com` or `https://www.derech-tkuma.com` on port 443. Staging may use an explicit loopback origin with `--allow-loopback`. Private addresses and other origins are rejected. Redirects are disabled and final response URLs must exactly equal requested URLs. No proxy environment is inherited. Each request uses an eight-second socket-operation timeout; an unattended runner should also impose a whole-process deadline. Responses share an aggregate 2 MiB cap, and each collection caps at 200 records, matching the current store. `inventory_may_be_capped` warns when either reaches that cap; completeness beyond it is not asserted.

All results are `internal_only`, including public mode. Every draft action is `proposed`, `publication_allowed: false`; receipts carry `auto_publish: false` and `no_publish: true`. Stable action IDs combine tour ID, field, published version and deterministic record hash. Repeated snapshots deduplicate; a version or content edit changes the key. Proposed title/description reuse source content and require editorial review. Missing descriptions remain null rather than invented text. Canonical/sitemap values use the source `sourcePath` verbatim when present, with a slug-derived fallback only for older records. Both remain URL candidates: frontend routing and original URL continuity require separate verification. The projection has no SEO fields, so the adapter cannot claim that rendered pages lack existing metadata.

There is no page crawler, CMS write, publication, delivery, scheduler or new sender. Indexing, robots, rendered metadata, analytics events, bookings and SEO uplift are outside this receipt. The existing runtime sacred-time and delivery gates remain required for downstream proactive work.

Local staging verification command:

```sh
python3 production/seo/audit.py --origin http://127.0.0.1:5174 --mode staging --allow-loopback
```

Public invocation requires accepted site transition and independent live verification:

```sh
python3 production/seo/audit.py --origin https://derech-tkuma.com --mode public --new-site-live-verified
```

The flag records the caller's gate attestation; it does not prove DNS, frontend identity, desktop/mobile acceptance or analytics events by itself.

Validation on 2026-10-19: eight fixture tests pass using `python3 -m unittest discover -s production/seo -v`. They cover actual collection envelopes and version keys; admin/private/other-schema rejection; malformed, missing and empty collections; occurrence and slug constraints; the two fixed GETs; private/off-origin endpoints and redirects; explicit staging loopback; invalid JSON and aggregate limits. No external writes, deployment, message or public-source probe was performed.

Real local acceptance at `2026-10-19T13:36:54.187394Z`: the command above completed against the running platform CMS at port 5174. Both published collections were empty. The receipt is `local-empty-projection-2026-10-19.json`: `status: no_published_tours`, zero tours/occurrences/proposals, `audience: internal_only`, `no_publish: true`, `auto_publish: false`. This verifies the adapter/public route integration for empty state, not rendered SEO or populated tour acceptance. The initial read found no listener; after the owning task restored the local process, the single verification succeeded.

## 20 October 2026 — current projection alignment (offline)

The previous validator rejected the current published projection with `tour_schema_invalid`, because the CMS had gained source paths, source dates/labels and deliberately unknown business fields. It now accepts the authoritative `platform-cms/lib/current-collections.json` fixture: four tours, six occurrences and sixteen internal-only proposals. All six source occurrences retain unknown start/end times, capacity and meeting points; no value is filled or changed.

Sixteen focused tests pass. Added coverage uses the real seed, exact nested/encoded source paths, legacy fallback, normalized route collisions, invalid/encoded external routes, dates/times, unknown/private schema keys, origin/publication gates, and the same two fixed GETs through a fake transport. Programmatic audit calls validate origin without network access; actual fetching retains DNS, redirect, host, timeout and response limits. There was no live request, CMS write, queue, provider delivery or publication. The historical empty-projection receipt above is unchanged and is not evidence of current populated live acceptance.

This fixes proposal generation only. A reviewed CMS write/readback adapter, execution through the existing task/approval system, scheduling and rendered SEO acceptance remain separate work.

The exact owner-controlled review host `https://derech-tkuma-review.22yarden22.workers.dev` is accepted only in staging mode. Its proposals remain internal and never publish; public mode rejects that host even when a live flag is supplied. Other Workers hosts are not permitted.

Live read-only acceptance on 20 October 2026: the exact review origin returned four tours and six occurrences through the two fixed GETs. Seventeen tests pass, including denial of the review host in public mode. The audit produced sixteen internal-only proposals with no CMS writes, queueing or publication. The source values remained unchanged.


## 20 October 2026 — task 29 private draft execution (locally verified)

`execution.py` now prepares typed task-29 effects from the validated public projection **and** a fresh administrator readback for every tour. It has no network, credential, queue or publishing capability. Four tours produce four draft groups containing the existing sixteen proposals. The accepted origin is the exact isolated review origin; public-domain execution remains closed. Markup/entity source text requires editorial handling instead of a lossy or invented automatic rewrite.

The existing signed gateway accepts `kind: "seo_draft", itemId: 29` effects through its existing machine URL and HMAC/lease/scope boundary. `platform-cms/lib/seo-draft-core.ts` reconstructs permitted values from the exact published source and rejects other tasks, fields, origins or publishing flags. Source content/version and the source record revision must still match. A separate private draft revision uses CAS. The transaction saves the private draft, immutable private history and receipt together; a source race, conflicting draft or SQL error leaves no partial result. Source collections, published versions and rendered metadata are unchanged.

Private draft/current/history/receipt data uses the existing backed-up `cms_settings` table under `cms_seo_draft:derech:derech-main:`, `cms_seo_history:derech:derech-main:` and `cms_seo_execution:derech:derech-main:`. No table or migration was added. Stable source effect keys deduplicate retries. A rolled-back key stays tombstoned even if a new preparation is attempted. A later private draft blocks blind rollback; rollback restores the exact prior proposal or records a withdrawn empty proposal, appending history.

Owner readback uses the existing authenticated endpoint:

- `GET /api/execution?seoTourId=<id>` returns the scoped current draft, source record revision/published source, history and receipt for that source.
- `GET /api/execution?effectKey=<hash>` returns the matching scoped SEO receipt when no legacy content receipt exists.
- Existing same-origin owner rollback POST `{ "operation": "rollback", "effectKey": "...", "expectedRevision": 1 }` supports SEO receipts. The machine alias still rejects every top-level operation property.

Safe integration through the existing approved execution worker:

1. Read the existing two public collections and obtain each tour's protected `seoTourId` readback using the existing authorized connector. Save these only to private runtime artifacts; never Git or model input containing credentials.
2. Call `prepare(projection, readbacks)` from `execution.py`, or run `python3 -B production/seo/execution.py prepare --projection <private-projection.json> --readbacks <private-readbacks.json>`. The output is a plan fragment, not a complete signed packet or approval.
3. Only the existing approved task-29 execution recipe may append `plan["effects"]` to the existing immutable gateway packet, with its existing report/tasks. Reuse the current spool, signed fixed-origin transport, sacred-time gate and receipt settlement; add no transport, sender, poller or independent schedule. A plan alone must not mark the task complete.
4. After acceptance or uncertain transport, obtain fresh protected readback and call `verify_readback(effect, readback)` (CLI `verify --effect <private-effect.json> --readback <private-readback.json>`). `verified_private_draft` requires the actual current draft/receipt, exact values/revision and unchanged published source. A receipt, plan or HTTP200 alone is insufficient. A conflict requires fresh source review, not forced replacement; a tombstone must not be reactivated.
5. Show proposed values/history/rollback to the owner in the existing execution screen. These are proposed SEO values only. Editorial acceptance, real metadata fields/rendering, public canonical/sitemap validation and publication remain separate authorized work.

Focused local acceptance: `python3 -B -m unittest discover -s production/seo -v` passes24 tests. `node --experimental-strip-types platform-cms/scripts/test-seo-drafts.mjs` (run from the repository with its Node dependencies available) passes actual SQLite and cross-language adapter checks, including current four-tour fixtures, source CAS races, atomic failure, isolation, replay/tombstone and rollback conflicts. It also exercises the actual execution gateway handler with real HMAC/packet/lock/store/report logic and fixture provider/auth boundaries: unsigned denial, signed acceptance/replay, protected readback and same-origin owner rollback; public collection rows remain byte-identical. TypeScript passed. These are isolated local checks; no live draft was created, task marked done, deployment, delivery or publication performed. Root integration must still connect the prepared recipe to the existing approved server execution producer and expose the owner screen before claiming that live #29 is complete.
