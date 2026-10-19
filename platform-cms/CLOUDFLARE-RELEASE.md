# Controlled Cloudflare review deployment

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

This verifies every current public asset against `public-assets-manifest.json`, then type/domain/access checks and release tests before the final standalone build. A no-upload Wrangler dry run then enforces the approved3072 KiB gzip code budget and fails closed when the size cannot be parsed; it never upgrades a plan. Local checks receive a sanitized environment with provider tokens, app secrets and auth settings removed. The output records `PLATFORM_RELEASE_SHA`; every Worker response receives `x-derech-release` and `X-Robots-Tag: noindex, nofollow`. `assets.binding=ASSETS` lets Vinext serve static resources; `assets.run_worker_first=true` ensures the noindex wrapper also runs for static assets. Current forms/payments/tracking review guards remain active.

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

The prepared public-only archive contains exactly982 manifest files under `public/`,153807357 compressed bytes /159156554 original bytes. SHA256: `c493846b98ca5a39a7da3a194c29c78ff3807ddcfe32ffea00b1b84f58c75cc2`. Its manifest SHA256 is `2a494a024c6c780d8286268594fc0840d6ddb6a932ad596a9fee106ee6a6c55d`. All982 files were hydrated into an empty isolated copy and reverified. The archive is local only, has not been uploaded, and must be regenerated if that manifest changes.


### Lossless source packing for the free Worker code allowance

The first standalone compile's largest chunk was generated source pages:20805087 raw /3004985 gzip bytes. A Cloudflare-only Vite virtual module now packs the unchanged generated JSON with Brotli quality7 and uses native `node:zlib`/`node:buffer` to decode it synchronously in the Worker. Packing asserts exact byte equality after decompression; the focused test imports the generated runtime module and verifies the full37-page object digest. This changes transport representation only. Source HTML, IDs, inline scripts, text, images, histories and all982 public assets are unchanged; the Sites target retains its original JSON import.

A second no-credential isolated build and Wrangler dry run reported1509.86 KiB raw /677.52 KiB gzip for the full Worker, below3 MiB without a plan change. Real local workerd rendered all37 pages with HTTP200, noindex, the source release header and review guard (all37 in0.473 seconds total after startup). This is local fixture evidence, not a real account deployment, Cloudflare traffic benchmark or first-isolate startup budget measurement. The actual protected workflow must still prove the selected provider resource and runtime configuration.
