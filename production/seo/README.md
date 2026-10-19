# Platform CMS SEO draft adapter

`audit.py` is a read-only Python standard-library adapter for the shared platform CMS. It reads the actual public collection routes defined by `platform-cms/app/api/public/collections/[kind]/route.ts`, using the content definitions in `platform-cms/lib/collection-core.ts` and published projection in `platform-cms/lib/collection-d1.ts`.

Exactly two fixed GET requests run on success:

- `/api/public/collections/tour`
- `/api/public/collections/occurrence`

Each response must be `{ "records": [{ "id": "resource-id", "content": {}, "version": 1 }] }`. The published version is an integer, IDs are the platform's bounded string resource IDs. Tour content is exactly `title`, `slug`, `description`, `image`, `imageAlt`. Occurrence content is exactly `tourId`, `startsAt`, `endsAt`, `timezone`, `meetingPoint`, `priceMinor`, `currency`, `capacity`. Internal admin records, draft snapshots, extra tenant/account fields, generic CMS records, malformed fields and missing collections fail closed. Occurrences require a parent in the same published tour projection. No prices appear in draft proposals.

The public route selects published content only; it derives tenant/site scope from deployment-owned configuration and removes occurrences whose parent is withdrawn. These public responses deliberately omit tenant/site IDs: the adapter depends on the verified origin and deployment configuration for site identity. It cannot independently prove tenant membership from the payload. It never requests the authenticated admin routes or credentials.

The source allows only `https://derech-tkuma.com` or `https://www.derech-tkuma.com` on port 443. Staging may use an explicit loopback origin with `--allow-loopback`. Private addresses and other origins are rejected. Redirects are disabled and final response URLs must exactly equal requested URLs. No proxy environment is inherited. Each request uses an eight-second socket-operation timeout; an unattended runner should also impose a whole-process deadline. Responses share an aggregate 2 MiB cap, and each collection caps at 200 records, matching the current store. `inventory_may_be_capped` warns when either reaches that cap; completeness beyond it is not asserted.

All results are `internal_only`, including public mode. Every draft action is `proposed`, `publication_allowed: false`; receipts carry `auto_publish: false` and `no_publish: true`. Stable action IDs combine tour ID, field, published version and deterministic record hash. Repeated snapshots deduplicate; a version or content edit changes the key. Proposed title/description reuse source content and require editorial review. Missing descriptions remain null rather than invented text. Canonical/sitemap values are only slug-derived URL candidates: frontend routing and original URL continuity require separate verification. The projection has no SEO fields, so the adapter cannot claim that rendered pages lack existing metadata.

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
