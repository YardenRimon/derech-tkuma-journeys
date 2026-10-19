# Automatic review deployment contract — 20 October 2026

This preparation targets only the existing isolated Cloudflare review Worker, D1 and media bucket. Source preparation changes no domain, Access policy, application data, outbound integration or provider plan. It is not proof that a workflow is installed, enabled or accepted live.

## Trigger, source and privilege boundary

`github-workflows/site-cloudflare.yml` retains manual dispatch from `main` and `production-foundation-20261019`. Its optional automatic path waits for **Shared CMS checks** to complete successfully after a **push** to one of those exact branches in `YardenRimon/derech-tkuma-journeys`. Pull-request runs, forks, failed/cancelled CI, another workflow path and other branches are rejected. No CI artifacts are downloaded or executed.

The automatic job additionally requires repository-level variable `DERECH_CF_AUTO_DEPLOY_ENABLED=true`. Leave this variable absent or `false` until root installs the reviewed workflow and accepts the live UI/Access/data gates. An environment-level variable cannot enable `jobs.if`; remove the obsolete environment-level copy to avoid confusing operators.

GitHub's [`workflow_run` event](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run) executes privileged follow-up workflows from the default branch and can expose secrets even when the preceding workflow could not. Therefore the deploy job filters the event before checkout, checks out only the successful run's exact `head_sha` from the fixed repository, then independently rereads that run and the current branch through read-only GitHub APIs. `WORKERS_CI_COMMIT_SHA` carries the tested commit through build, artifact validation and live verification; `GITHUB_SHA` for a workflow-run event is not the tested application commit.

`cloudflare-cd-policy.mjs` rejects a checkout mismatch or missing application files. The current workflow-only `main` skeleton cannot deploy an application. This does not merge PR1 or otherwise authorize an application merge. The selected source must contain the policy and its focused test as well as the application. Run metadata and branch head are checked before the build and immediately before schema/application mutation. A source superseded while queued fails closed. The unavoidable small interval between GitHub head verification and provider mutation is bounded by adjacent steps; serialized, non-cancelling deployments and another guard before code upload prevent a stale queued run from silently replacing a newer selected head.

Actions remain pinned; permissions are `contents:read` and `actions:read`. The existing protected environment `derech-cloudflare-review`, private Cloudflare token, pinned media hash, full build/tests, resource/scope validators, noindex/source HTTP checks and concurrency lock are preserved. Configuration and provider secrets remain separate. The workflow does not turn on provider observability or change any secret scope.

## Installation and acceptance, performed by root

1. Keep the repository auto-enable variable `false`. Copy the workflow and the two policy/test files into the application branch; run `node production/test-cloudflare-cd-policy.mjs` in ordinary CI as well. The deployment workflow itself runs that test before processing credentials.
2. Install the same workflow bytes as `.github/workflows/site-cloudflare.yml` on the default branch. This bootstrap needs no application merge. Install/update the application branch's workflow copy too so manual dispatch uses the same policy. The upstream CI file must remain `.github/workflows/site-ci.yml`, named `Shared CMS checks`; a rename requires a reviewed update of both workflow and policy.
3. Confirm the protected environment admits only the two approved branches and retains required owner approval where configured. Verify its scoped provider secret and existing reviewed config/media variables. Do not copy provider secrets into repository variables or the preceding CI workflow.
4. Complete manual review deployment and live owner/admin UI, Access, noindex, source/media/data and rollback readiness acceptance. Root then explicitly sets the **repository** auto-enable variable to `true`. No setting is changed by these source files.
5. Observe a new trusted push CI success followed by a review deployment: run ID/head SHA, checkout SHA, build/source header and live HTTP acceptance must agree. A successful provider upload alone is insufficient. Record any failed post-upload verification as a failed deployment acceptance; the code might already be live.
6. A pull-request CI completion must leave deployment skipped. Changing the repository flag back to `false` stops future automatic jobs; it does not cancel a currently running job. Cancel or resolve that existing run explicitly before a manual rollback.

Environment `vars` are available only after the runner declares the environment; unset variables evaluate to an empty string. This is why the scheduling guard uses a repository variable. [GitHub vars context](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#vars-context)

## Manual code rollback plan

Before each accepted release, retain the provider's prior verified Worker version ID, corresponding source SHA, private reviewed resource config, database migration level and runtime-binding/secret compatibility evidence. Ordinary migrations must be additive and remain compatible with that retained version. A destructive migration or incompatible data transition needs its own reviewed migration and fresh recovery plan; this workflow does not classify SQL safety automatically.

On a failed release, first disable automatic review deployment and resolve any active run under the same deployment lock. Inspect the current provider deployment and select the **explicit previously verified version**, not an inferred “previous” version. Using the existing private reviewed config and scoped provider credential, root can inspect the installed CLI's `wrangler deployments list`/`wrangler versions view` and run:

```sh
npx wrangler rollback "$VERIFIED_PREVIOUS_VERSION_ID" --name derech-tkuma-review --config "$REVIEW_CONFIG" --message "Reviewed code rollback"
```

This is a prepared operator command, not an executed rollback. Keep its interactive confirmation. Verify retained version/source/noindex, all public pages, owner login, data compatibility and monitor health after it. Check current secret/binding compatibility first; a provider can reject a rollback when secret versions changed. Preserve the failed version and diagnostic evidence.

Never automatically roll back, reset or overwrite D1/R2. A code rollback retains current data/history and additive migrations. If data recovery is necessary, restore a fresh encrypted backup into a separate isolated database/bucket and compare it before an explicitly authorized switch. Final-domain/DNS migration remains a separate acceptance phase.

## Local test evidence

`node production/test-cloudflare-cd-policy.mjs` covers tested-head SHA selection, default-disabled auto mode, manual dispatch, PR/fork/workflow/branch/status rejection, application-free source refusal, stale head and actual CI readback mismatches, sanitized network errors, secret-free output, protected environment, pinned actions, no artifact consumption and guard placement. These are local fixtures with injected transport; no GitHub, provider or deployment state is changed or proven by them.
