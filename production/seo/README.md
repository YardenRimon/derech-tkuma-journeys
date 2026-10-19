# New-site SEO draft adapter

`audit.py` is a read-only Python standard-library adapter for the Derech CMS projection. It makes exactly two fixed GET requests on success: `/api/content/tours` and `/api/content/occurrences`. It does not crawl pages, follow redirects, query WordPress admin, access credentials, write to the CMS, queue messages, or publish. It is an executable source for the existing workflow; it adds no schedule.

The origin accepts only `https://derech-tkuma.com` or `https://www.derech-tkuma.com` on port 443. A deliberate staging invocation may use a literal loopback origin with `--allow-loopback`; private addresses and other domains are rejected. Redirects are disabled and the final response URL must equal the requested URL. No proxy environment is inherited. Each GET uses an eight-second network timeout, with an aggregate response cap of 2 MiB. Returned CMS collections cap at 100 each. The timeout is the socket-operation timeout, not a guaranteed whole-process deadline; an outer runner should impose a total process deadline for unattended execution.

Only the published public projection is accepted. The adapter validates both arrays, the exact documented Derech field sets, unique IDs and legacy paths, published parent references, and occurrence shapes. Explicit draft or other-tenant markers block the run. The public endpoint's published-only guarantee remains a dependency; this receipt does not independently query WordPress status. A generic WordPress REST response is rejected. Empty published arrays produce `no_published_tours`, never fabricated content. No prices are emitted in proposals or performance reports.

Each proposal is `proposed`, `publication_allowed: false`, and keyed by `tour ID + field + canonical JSON source revision`. Identical snapshots retain identical action IDs for downstream deduplication; a CMS edit changes the revision. There are no live write operations. The revision is a snapshot digest, not WordPress's revision number. All receipts remain `internal_only`, including staging. Proposed titles reuse source titles; descriptions reuse excerpts and require editorial review. Missing excerpts produce a null proposal rather than invented copy. The projection contains no dedicated SEO fields, so proposals do not claim that the published site is missing them. Canonical and sitemap actions require a subsequent live audit before application. No rankings, indexing, robots, rendered HTML, conversion, or SEO uplift claim is made.

Staging command, **only after CMS initialization and public projection acceptance**:

```sh
python3 production/seo/audit.py --origin http://127.0.0.1:8782 --mode staging --allow-loopback
```

Public command, **only after the original site's transition is accepted and the new site is verified live**:

```sh
python3 production/seo/audit.py --origin https://derech-tkuma.com --mode public --new-site-live-verified
```

The explicit flag records the caller's gate attestation; it cannot prove DNS, site identity, mobile/desktop acceptance, or analytics events by itself. Do not set it for a preview. Existing runtime sacred-time and delivery gates remain in force when the workflow consumes a receipt. Receipts do not authorize outbound messages or publication.

Validation on 2026-10-19: eight fixture-only tests passed with `python3 -m unittest discover -s production/seo -v`: stable keys/revision changes; draft, other-tenant and orphan rejection; missing/malformed schema; exact bounded requests; private/off-origin endpoints and redirects; explicit loopback gating; malformed JSON and aggregate limits. No public or staging endpoint was probed. CMS initialization is blocked pending owner approval, so integration and published-content acceptance remain pending.
