# Shared platform CMS pilot

This is an extracted, runnable application foundation, reused from the Gvanim CMS rather than a separate WordPress installation. It is **not** the deployed multi-tenant SaaS core. Existing Site `appgprj_6ad223757bf48191865c448130781025` remains the sole deployment target; there is no new Site registration.

## Reused and adapted

Reviewed source allowlist from `/Users/yardenrimon/Documents/GitHub/MainLandpage/site`: `lib/cms.ts`, `lib/access.ts`, `lib/cloudflare-access.ts`, authenticated page/user/media routes, visual editor/admin assets, Sites Vite integration and auth helper. Page saving, publication snapshots, rollback, uploads, user administration and identity pinning reuse that tested implementation. The vendored Sites plugin retains its upstream license. No Gvanim identity manifest, owner/editor addresses, credentials, D1 rows, R2 objects, runtime state, or brand assets were copied.

`lib/generated-pages.json` is ignored generated data, built solely from the three existing Derech demo HTML pages. Standalone source contains only their exact compressed public fixtures in `source-pages/*.html.gz`; generation/tests prefer the current original directory when present and fall back to these fixtures otherwise. `npm run check` and `npm run build` regenerate first. `scripts/prepare-pages.py` discovers editable text/image leaves with parser offsets, inserts only `data-edit-id` / `data-image-id` attributes, and never serializes HTML. Each initial page has one locked source body. Removing the annotations reconstructs the exact source. Inline JavaScript is checked byte for byte. Future section movement needs a separate source layout review. Uploaded image overrides clear the original responsive/lazy source attributes so the selected replacement can display.

## Provider and tenant boundary

The larger SaaS decision remains Postgres, managed auth, grants, entitlements, audit, storage and queue. This pilot's provider is an explicitly **isolated D1 database and R2 bucket per tenant/site**, reusing the proven Gvanim adapter. It is not safe to place multiple customers in the inherited page/user tables. `CMS_ADAPTER_MODE=isolated-d1`, server-owned tenant/site IDs and a DB singleton registration enforce that boundary and reject a mismatched database. Do not bind a Gvanim database or bucket here. No provisioned production bindings exist in this source.

The new collection domain is provider independent (`collection-core.ts` / `CollectionStore`). Its D1 adapter scopes every read, write and history query by tenant and site. A future Postgres implementation must preserve the atomic expected-revision write, immutable history and published projection contract. The deployment-owned `siteScope()` must then be replaced by active membership plus site-grant resolution; a caller-supplied tenant/site value is never accepted.

Authentication remains the existing Sites ChatGPT identity boundary. There is no second login store or password system. `/admin`, `/admin/users` and `/admin/collections` all use `authorizeCmsUser`; publisher permission is checked on each publication. Optional `CMS_ADMIN_EMAILS` is a server-only, normalized/deduplicated bootstrap allowlist, separate from `CMS_EDITOR_EMAILS`. The initial owner and explicitly configured administrators become `system_admin`; editor overlap cannot demote an explicit administrator. Unpinned configured rows bind only when that verified email signs in, then require the same stable auth subject. Config changes after the one-time bootstrap do not silently change existing roles; subsequent role changes use protected user administration. The optional verified Cloudflare Access implementation is retained for future owner-managed hosting, but this Sites build selects Sites auth at build time. Local mock identities exist only in the loopback Vite middleware.

## Collection behavior

- `/admin/collections`: Hebrew editor for typed tours and occurrences, create/update drafts, delete draft, history, restore a historical snapshot into a draft, publish or withdraw. Restoring does not publish.
- `/api/collections/tour` and `/api/collections/occurrence`: protected reads and actions. `POST` accepts `id`, `operation`, `expectedRevision` and, for save, `content`.
- `/api/public/collections/tour` and `/api/public/collections/occurrence`: published-only projections. Withdrawn tours hide related occurrences from the public projection.
- Occurrences carry their tour ID, offset-aware start/end, IANA timezone, meeting point, integer ILS minor-unit price and capacity. They cannot publish before their linked tour publishes.

Collection list/public projections are bounded to 200 records and history to 100 snapshots in this pilot; production pagination is an explicit integration gate.

The collection UI assigns record IDs automatically, lists human tour names, offers a tour dropdown and image uploads, hides fixed timezone/currency defaults, and converts displayed shekel prices to integer minor units. Date inputs intentionally require an explicit UTC offset with an example; automatic DST-aware local-time conversion remains a UI acceptance limit.

The original three public pages continue rendering their exact source templates; typed collection records do **not yet replace their static tour cards**. Booking/payment/capacity reservation and live source-system synchronization are outside this pilot. No real tour schedule or price was invented or imported into the collection.

## Local setup and validation

Requires Node >=22.13. Drizzle schema lives in `db/schema.ts`; inherited migrations 0000–0002 remain byte-identical, with their schema-only metadata. Migrations 0003/0004 and snapshots/journal are generated by `db:generate` for the collections and isolated adapter.

The dependency lock is copied with the reviewed application and matches dependency declarations. This checkout currently reuses the Gvanim cached `node_modules` via a local, ignored symlink; packaged source consumers install from `package-lock.json` normally.

1. Copy `.dev.vars.example` to ignored `.dev.vars` for loopback synthetic fixtures only.
2. Run `npm run setup:local` once to apply `drizzle/*.sql` to a **new local D1 database**. Its Wrangler invocation is fixed to `--local`; it never provisions or changes a cloud binding. The migration runner is for a fresh DB and does not track reapplication.
3. Integrator copies `hosting.example.json` to `.openai/hosting.json` for the existing Site with `d1: "DB"`, `r2: "BUCKET"`, no static directory. No new registration.
4. `npm run dev` serves on port 5174. Use the local sign-in link; the synthetic owner is `seedy@sites.test`.
5. `npm run check`, `npm test`, then `npm run build`.

Checks completed in this task: TypeScript; exact source/inline-script preservation for all three pages and unique field IDs; domain lifecycle/permission/conflict tests; actual adapter SQL against in-memory SQLite with all migrations and tenant/site isolation; inherited Cloudflare JWT verification cases. The SQLite test is not proof of live D1/R2 provisioning. Loopback HTTP checks also passed for protected admin routes, anonymous/spoofed-header denial, all three exact rendered pages/noindex, draft isolation, revision conflict, publication/rollback, origin rejection, local R2 upload/readback and collection CRUD/public projection. A second HTTP suite verifies configured admin bootstrap, normalization/deduplication, admin/editor separation, stable-identity pinning and replacement-subject denial. Browser acceptance, recovery, fresh installation, Site packaging, deployment and live readback remain integration gates.

Source contracts consulted: Gvanim `PROJECT_CONTEXT.md`, `docs/DECISION_CONTRACT.md`, `site/WORKSTATE.md`; unified SaaS `saas-readiness.md` and `saas-mvp-contracts.md`. Their current architecture is reused as a constraint, not represented as already deployed infrastructure.

## GitHub media boundary

GitHub tracks application code and the exact compressed three-page fixtures. Large public media/runtime assets remain in the existing Sites source at commit4409748d74d0dbb520c38501a5d8db452b38dcf8 (and later verified versions), not this code repository. public-assets-manifest.json pins every excluded file size/hash and its public origin. CI checks compilation/contracts, not asset delivery. A deployment must hydrate and verify this complete manifest or use the existing Sites checkout that already owns these files; do not publish a code-only GitHub build. No durable CD is activated here.
