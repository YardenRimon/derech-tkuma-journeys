# Controlled Cloudflare review deployment

## Access fetch runtime regression — 20 October

Local workerd reproduced the live `jwks_fetch_failed`/network observation before any upstream HTTP request: Workers does not implement `redirect: "error"`. The JWKS fetch now uses `redirect: "manual"`; its existing `!response.ok || response.redirected` check rejects every 3xx without following it. Signature, issuer/audience, signed identity/time claims, the fixed issuer-derived key URL and the three-second deadline remain required. This runtime behavior is documented in Cloudflare's [Request redirect options](https://developers.cloudflare.com/workers/runtime-apis/request/).

`npm run test:access-workerd` (also in `npm test`) bundles the installed Vinext fetch shim and canonical verifier into actual local workerd with compatibility date 2026-05-15. Generated RSA JWTs prove acceptance through native and real force-dynamic patched fetch, rejection of invalid signatures/claims and 301/302/303/307/308 responses, cache reuse across requests and zero redirect-target contacts. All outgoing requests are bound to a local stub Worker that never calls the network. This needs the existing Wrangler/Miniflare/esbuild development dependencies and loopback permission; it uses no account credentials. Local regression success is separate from a deployed owner-login acceptance check.

Reusable diagnostic logs stay silent unless both `PLATFORM_RELEASE_STAGE=review` and `CF_ACCESS_DIAGNOSTICS=enabled` are explicitly set. Logs contain only fixed event/stage enums, assertion-presence booleans, bounded HTTP status/redirected values or timeout/network kind. No public diagnostic endpoint or provider observability setting is enabled by the source change.

Adapted from MainLandpage/Gvanim's existing standalone build and Access pattern. Sites remains the default development/review target. `PLATFORM_DEPLOY_TARGET=cloudflare` selects a separate Worker, fixes `__PLATFORM_AUTH_PROVIDER__` to `cloudflare-access`, excludes Sites/mock-auth plugins and strips caller-controlled Sites identity headers before application dispatch. Application identities come exclusively from the existing RS256/JWKS/issuer/audience/time-verified Access JWT implementation. Roles and linked Access IDs remain in CMS; no role is inferred from an email header.

## Resource and identity preparation (root-owned, pending)

Use the user's chosen existing Cloudflare account. Required isolated review resources are Worker `derech-tkuma-review`, D1 `derech-tkuma-cms-review` and R2 `derech-tkuma-media-review`. Fill a local/runner-private config from `wrangler.cloudflare.example.json`, including the actual account ID, D1 UUID, Access issuer/audience, owner email and workers.dev review origin. The validator rejects example values, wrong site scope, custom domain routes, additional DB/bucket bindings and inline secret vars. No final domain or DNS is changed by this workflow.

Configure Cloudflare Access on the exact workers.dev review hostname for `/admin/*` and protected browser APIs (users, CMS, collections, tasks, reports, interactive execution); admit the intended owner/admin/editor identities. Preserve a service-authenticated route for `/api/backup/` and machine `/api/execution/` without interactive redirects: application purpose-specific HMAC remains mandatory. The worker/app independently rejects missing/invalid identities, including direct/spoofed origin calls. Live owner/editor/outsider/identity-replacement checks are required; local signature tests are not that verification.

Store runtime execution/backup/lead secrets in provider secret storage. Do not put them in config or GitHub build variables. A backup secret is distinct from execution and all copied DB identity/history values are retained. Initialize schema with the original ordered migration SQL. This deployment applies schema only; it does not reset/seed CMS content, permissions or identity pins. Original D1 rows/R2 UUID objects must be migrated and independently compared by the separate recovery procedure before content traffic moves. Do not use Sites short-lived source credentials as CI credentials.

## Build and media gate

Run Node24. Set `PLATFORM_CF_CONFIG_PATH` to the reviewed JSON and `GITHUB_SHA` (or `WORKERS_CI_COMMIT_SHA`) to the full exact source commit. Execute:

```sh
node scripts/build-cloudflare.mjs
```

This verifies every current public asset against `public-assets-manifest.json`, independently reconstructs the pinned source with Python, then runs type/domain/access checks, normal release tests and the focused backup/contact contracts before the final standalone build. A no-upload Wrangler dry run then enforces the deliberate project budget of3072 KiB gzip (not Cloudflare’s current provider limit) and fails closed when the size cannot be parsed; it never upgrades a plan. Local checks receive a sanitized environment with provider tokens, app secrets and auth settings removed. The output records `PLATFORM_RELEASE_SHA`; every Worker response receives `x-derech-release` and `X-Robots-Tag: noindex, nofollow`. `assets.binding=ASSETS` lets Vinext serve static resources; `assets.run_worker_first=true` ensures the noindex wrapper also runs for static assets. Current forms/payments/tracking review guards remain active.

The GitHub checkout intentionally excludes large media. Prepare a public-static-only archive with members under `public/`; exclude private snapshots, `.env`, source integrations and any credentials. Pin its HTTPS URL and SHA256. The hydration script checks the archive hash, rejects traversal/symlink/device/unknown/duplicate members, refuses to overwrite changed tracked source, and verifies all 982 current manifest entries after hydration. A media-only archive may contain a subset; every file missing from Git must be supplied. A code-only green build cannot pass this deployment gate.

```sh
python3 scripts/hydrate-cloudflare-media.py --archive /private/static-media.tgz --sha256 ACTUAL_SHA256 --root .
```

## Protected deployment workflow

Prepared source: `production/github-workflows/site-cloudflare.yml`. Root copies it into the actual repository `.github/workflows/` after configuration. It accepts manual runs only from `main` or the exact current `production-foundation-20261019` branch, and uses protected GitHub environment `derech-cloudflare-review` with one serialized deployment. It does not require an early merge of the draft PR.

Environment variables: `DERECH_CF_CONFIG_JSON` (non-secret reviewed JSON), `CLOUDFLARE_ACCOUNT_ID`, `DERECH_MEDIA_ARCHIVE_URL`, `DERECH_MEDIA_ARCHIVE_SHA256`. Environment secret: scoped `CLOUDFLARE_API_TOKEN` limited to this account and needed Worker/D1/R2 deployment actions. Runtime secrets are provisioned separately and never passed to tests. Add environment branch restrictions and required review according to owner policy before installing the workflow.

The workflow hydrates pinned media, verifies source reconstruction and the checked build, validates built resource/account/source identity, applies schema-only migrations and deploys the built artifact. The configuration's migration directory is made absolute on the ephemeral runner. It then verifies HTTP/source SHA/noindex/health on pages and representative static assets and rejection of spoofed Sites identity headers. A workflow cannot undo a succeeded provider deployment if a subsequent live check fails; preserve the previous Worker version and rollback procedure, report the failed check, and keep DNS unchanged.

Long-term push-to-main deployment may be enabled through this same protected environment after account, Access, data/media migration, runtime secrets and first reviewed manual deployment all pass. It is deliberately not enabled by the preparation alone. Ordinary CI should call `node scripts/test-cloudflare-release.mjs`; those tests require no account or credentials. Existing Cloudflare Access signature tests remain in the normal CMS test suite.

## Remaining release evidence

Root must verify actual account/resources, Access policy, owner login and scope, runtime secrets, migrated rows/history/media and live R2 upload/read, fresh encrypted backup/off-server recovery, the first manual CD run, source commit header, all review pages/noindex, monitoring and rollback. Only after those gates and the domain/integration prerequisites are complete should the separate final-domain migration plan proceed. This preparation has not provisioned, uploaded, migrated or deployed any Cloudflare resource.


## 2026-10-19 local preparation evidence

A no-credential, explicitly synthetic compile fixture built in an isolated `/private/tmp` project. This was not an account/resource validation. The generated Wrangler configuration retained `ASSETS` and worker-first routing. Real local Worker requests served both admin CSS and a nested WordPress JS asset with HTTP200/noindex/source headers; requests to users/tasks/reports with spoofed Sites identity headers received401. A deployment dry run completed without upload and reported 3235.17 KiB gzip Worker code (21249.59 KiB raw), so the chosen account's current Workers code-size allowance must be verified before the first actual deploy. No account plan was inspected or changed.

The prepared public-only archive contains exactly982 manifest files under `public/`,153807357 compressed bytes /159156554 original bytes. SHA256: `c493846b98ca5a39a7da3a194c29c78ff3807ddcfe32ffea00b1b84f58c75cc2`. Its manifest SHA256 is `2a494a024c6c780d8286268594fc0840d6ddb6a932ad596a9fee106ee6a6c55d`. All982 files were hydrated into an empty isolated copy and reverified. That initial capture was local only and must be regenerated if its manifest changes. Root subsequently supplied the immutable public-only GitHub Release asset657358587; the deployment workflow rechecks its pinned bytes before use.


### Lossless source packing under the project code budget

The first standalone compile's largest chunk was generated source pages:20805087 raw /3004985 gzip bytes. A Cloudflare-only Vite virtual module now packs the unchanged generated JSON with Brotli quality7 and uses native `node:zlib`/`node:buffer` to decode it synchronously in the Worker. Packing asserts exact byte equality after decompression; the focused test imports the generated runtime module and verifies the full37-page object digest. This changes transport representation only. Source HTML, IDs, inline scripts, text, images, histories and all982 public assets are unchanged; the Sites target retains its original JSON import.

A second no-credential isolated build and Wrangler dry run reported1509.86 KiB raw /677.52 KiB gzip for the full Worker, below the deliberately stricter3 MiB project budget without a plan change. Real local workerd rendered all37 pages with HTTP200, noindex, the source release header and review guard (all37 in0.473 seconds total after startup). This is local fixture evidence, not a real account deployment, Cloudflare traffic benchmark or first-isolate startup budget measurement. The actual protected workflow must still prove the selected provider resource and runtime configuration. Cloudflare’s current [Worker limits](https://developers.cloudflare.com/workers/platform/limits/) are separate from this conservative project budget; the verifier must not describe3 MiB as the provider Free-plan limit.


## CI/CD handoff after source commit aabee48

GitHub PR CI run39319871028 (`Shared CMS checks`, run22) succeeded for source commit `aabee48d269e833693d1d3b1d23d6ccb1c985a42`. The active ordinary CI already runs focused backup/contact tests with the portable source-contract fixture and repository restore tool; the preparation CI template is synchronized to that actual workflow. Native Sites `npm test` intentionally does not invoke the outer-workspace backup restore test. The Cloudflare build plan invokes both focused tests explicitly, with sanitized credentials and the complete GitHub checkout.

Root's public-static release URL is `https://github.com/YardenRimon/derech-tkuma-journeys/releases/download/review-static-media-20261019/derech-public-media-20261019-c493846b.tar.gz` with SHA256 `c493846b98ca5a39a7da3a194c29c78ff3807ddcfe32ffea00b1b84f58c75cc2`. A newly changed public manifest requires a newly pinned immutable asset before its source merge; a stale archive fails hydration rather than replacing new tracked scripts.

The current preparation remains manual-only. After real Access issuer/audience configuration and the first verified manual review deployment, root can enable the commented `push` section for `main` and set protected environment variable `DERECH_CF_AUTO_DEPLOY_ENABLED=true`. Both changes are required. The existing job still uses the approved protected environment, fixed review-resource/domain gates and serialized non-cancelling deployments. A branch-head check immediately before provider mutations rejects superseded queued source commits. Review branch manual dispatch remains available; automatic deployment is restricted to main. No workflow or push trigger is installed or activated by this source preparation.

The complete GitHub release build and source/backup/contact checks must precede schema/application changes. Live source/noindex/static/auth/health readbacks are separate from a successful provider upload. On failed live verification, keep the final domain unchanged and use the saved previous Worker version for a reviewed code rollback; the workflow does not overwrite CMS data or perform an automatic data rollback.


## Source integration checks — 20 October

Normal CMS `npm test` includes the machine-execution boundary test; `npm run test:machine-http` is a separate loopback-only denial suite for the existing local HTTP stage. It sends no accepted machine packet and does not switch the live connector. Native Site tests remain self-contained: outer backup receiver/Python/storage tests belong in repository CI rather than the standalone CMS package test command.

The CI preparation template is copied from the current actual GitHub CI, then extended with backup-receiver path filters, cryptographic receiver/security tests, Python upload/notification tests and a real local workerd/R2 test. Those checks use generated local fixtures and no provider credentials or public uploads. Actual `.github` workflow installation, GitHub source synchronization and CI/deployment readback remain root-owned.


## Mutation request streams — 20 October

The standalone Worker must construct the sanitized `Request` exactly once, then pass that same object through the build-asset classifier and Vinext. Constructing two `Request` objects from the original transfers its POST body on the first construction and makes the second throw before the CMS route can return its JSON error. The classifier does not read non-static request bodies. This preserves streaming upload limits and byte identity without buffering, cloning a second stream, changing MIME handling, or relaxing Access/CMS authorization.

`node scripts/test-cloudflare-request-workerd.mjs` exercises the actual wrapper in local workerd with the installed Vinext header-cloning code and force-dynamic fetch patch. Binary `image/webp` POST, UTF8 JSON POST and JSON PATCH retain exact method/path/MIME/length/SHA256 through isolated local R2 put/get; noindex/source headers and removal of caller Sites identity remain checked. It is included in the focused Cloudflare release suite. This transport fixture uses no real Access identity or provider network and does not itself prove a live authenticated upload or application-level file validation.
