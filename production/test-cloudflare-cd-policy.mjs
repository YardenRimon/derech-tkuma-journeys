import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { selectDeployment, checkApplicationSource, verifyCurrentSource, repository } from './cloudflare-cd-policy.mjs';

const sourceSha = 'a'.repeat(40);
const run = { name: 'Shared CMS checks', event: 'push', status: 'completed', conclusion: 'success', head_repository: { full_name: repository }, repository: { full_name: repository }, head_branch: 'production-foundation-20261019', head_sha: sourceSha, path: '.github/workflows/site-ci.yml', id: 12345 };
const event = { repository: { full_name: repository }, action: 'completed', workflow_run: run };
const input = { eventName: 'workflow_run', event, ref: 'refs/heads/main', sourceSha: 'b'.repeat(40), autoEnabled: 'true' };
const candidate = selectDeployment(input);
assert.equal(candidate.sha, sourceSha, 'workflow_run must select tested head SHA, never the default-branch GITHUB_SHA');
assert.equal(candidate.branch, run.head_branch);
assert.equal(selectDeployment({ ...input, event: { ...event, workflow_run: { ...run, head_branch: 'main' } } }).branch, 'main');
assert.equal(selectDeployment({ ...input, eventName: 'workflow_dispatch', ref: 'refs/heads/main', sourceSha }).mode, 'manual');
for (const autoEnabled of [undefined, '', 'false', 'TRUE']) assert.throws(() => selectDeployment({ ...input, autoEnabled }));
for (const patch of [{ event: 'pull_request' }, { event: 'pull_request_target' }, { conclusion: 'failure' }, { conclusion: 'cancelled' }, { status: 'in_progress' }, { name: 'Another workflow' }, { head_repository: { full_name: 'outsider/fork' } }, { head_branch: 'other' }, { path: '.github/workflows/other.yml' }, { head_sha: 'refs/heads/main' }, { id: '../invalid' }]) {
  assert.throws(() => selectDeployment({ ...input, event: { ...event, workflow_run: { ...run, ...patch } } }));
}
assert.throws(() => selectDeployment({ ...input, event: { ...event, repository: { full_name: 'outsider/fork' } } }));
assert.throws(() => selectDeployment({ ...input, event: { ...event, action: 'requested' } }));
assert.throws(() => selectDeployment({ ...input, eventName: 'pull_request' }));
for (const ref of ['refs/heads/other', 'refs/tags/main', 'refs/pull/1/merge']) assert.throws(() => selectDeployment({ ...input, eventName: 'workflow_dispatch', ref }));
checkApplicationSource(candidate, { head: sourceSha, exists: () => true });
assert.throws(() => checkApplicationSource(candidate, { head: 'b'.repeat(40), exists: () => true }));
assert.throws(() => checkApplicationSource(candidate, { head: sourceSha, exists: path => !path.startsWith('platform-cms/') }), /application_source_missing/, 'main workflow-only skeleton must fail before credentials/provider steps');

function transport({ current = sourceSha, ci = run, jobs, status = 200, failure = false } = {}) {
  const calls = [];
  return { calls, fetcher: async (url, init) => {
    calls.push(url);
    assert(url.startsWith(`https://api.github.com/repos/${repository}/`));
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers.authorization, 'Bearer private-test-token');
    if (failure) throw new Error('private-token-url-and-cause-canary');
    return Response.json(url.includes('/jobs?') ? jobs : url.includes('/actions/runs/') ? ci : { object: { sha: current } }, { status });
  } };
}
let mock = transport();
await verifyCurrentSource(candidate, { token: 'private-test-token', fetcher: mock.fetcher });
assert.equal(mock.calls.length, 2, 'automatic path rereads actual CI result and current branch');
mock = transport();
await verifyCurrentSource({ ...candidate, mode: 'manual' }, { token: 'private-test-token', fetcher: mock.fetcher });
assert.equal(mock.calls.length, 1);
for (const options of [{ current: 'b'.repeat(40) }, { status: 403 }, { failure: true }, { ci: { ...run, conclusion: 'failure' } }, { ci: { ...run, head_sha: 'b'.repeat(40) } }, { ci: { ...run, repository: { full_name: 'outsider/fork' } } }]) {
  mock = transport(options);
  await assert.rejects(verifyCurrentSource(candidate, { token: 'private-test-token', fetcher: mock.fetcher }), error => !error.message.includes('private') && error.message.startsWith('Cloudflare review deployment blocked:'));
}
await assert.rejects(verifyCurrentSource(candidate, { fetcher: transport().fetcher }));

const pushInput = {
  eventName: 'push', event: { repository: { full_name: repository }, head_commit: { id: sourceSha }, deleted: false },
  ref: 'refs/heads/production-foundation-20261019', sourceSha,
  verifiedJobEnabled: 'true', verifyResult: 'success', runId: '12345', runAttempt: '2',
};
const verifiedCandidate = selectDeployment(pushInput);
assert.equal(verifiedCandidate.mode, 'verified_job');
assert.equal(verifiedCandidate.runId, 12345);
for (const patch of [{ verifiedJobEnabled: undefined }, { verifiedJobEnabled: 'false' }, { verifyResult: 'failure' }, { verifyResult: true }, { runId: '../bad' }, { runAttempt: '0' }, { ref: 'refs/pull/1/merge' }, { sourceSha: 'b'.repeat(40) }, { eventName: 'pull_request' }]) assert.throws(() => selectDeployment({ ...pushInput, ...patch }));
assert.throws(() => selectDeployment({ ...pushInput, event: { ...pushInput.event, deleted: true } }));
assert.throws(() => selectDeployment({ ...pushInput, event: { ...pushInput.event, repository: { full_name: 'outsider/fork' } } }));
const runningRun = { ...run, status: 'in_progress', conclusion: null, run_attempt: 2 };
// GitHub's documented job schema does not require run_attempt; the endpoint is attempt-specific.
const verifyJob = { id: 777, run_id: 12345, head_sha: sourceSha, name: 'verify', status: 'completed', conclusion: 'success' };
const jobResponse = { total_count: 2, jobs: [verifyJob, { name: 'deploy-review / deploy', status: 'in_progress' }] };
mock = transport({ ci: runningRun, jobs: jobResponse });
await verifyCurrentSource(verifiedCandidate, { token: 'private-test-token', fetcher: mock.fetcher });
assert.equal(mock.calls.length, 3);
assert(mock.calls[1].endsWith('/actions/runs/12345/attempts/2/jobs?per_page=100'));
for (const options of [
  { ci: { ...runningRun, event: 'pull_request' } }, { ci: { ...runningRun, run_attempt: 1 } },
  { ci: { ...runningRun, head_sha: 'b'.repeat(40) } }, { ci: { ...runningRun, name: 'Forged caller' } },
  { ci: { ...runningRun, path: '.github/workflows/other.yml' } },
  { ci: { ...runningRun, status: 'completed', conclusion: 'cancelled' } },
  { jobs: { total_count: 0, jobs: [] } }, { jobs: { total_count: 101, jobs: [verifyJob] } },
  { jobs: { total_count: 2, jobs: [verifyJob, verifyJob] } },
  ...[{ conclusion: 'failure' }, { conclusion: 'skipped' }, { status: 'in_progress', conclusion: null }, { head_sha: 'b'.repeat(40) }, { run_id: 12346 }, { run_attempt: 1 }, { name: 'verify-other' }].map(patch => ({ jobs: { total_count: 1, jobs: [{ ...verifyJob, ...patch }] } })),
  { current: 'b'.repeat(40) },
]) {
  mock = transport({ ci: runningRun, jobs: jobResponse, ...options });
  await assert.rejects(verifyCurrentSource(verifiedCandidate, { token: 'private-test-token', fetcher: mock.fetcher }));
}

const workflow = readFileSync(new URL('./github-workflows/site-cloudflare.yml', import.meta.url), 'utf8');
assert(workflow.includes('  workflow_run:'));
for (const required of ["workflows: ['Shared CMS checks']", 'types: [completed]', "github.event.workflow_run.event == 'push'", "github.event.workflow_run.conclusion == 'success'", 'github.event.workflow_run.head_repository.full_name == github.repository', "vars.DERECH_CF_AUTO_DEPLOY_ENABLED == 'true'", 'github.event.workflow_run.head_sha || github.sha', 'WORKERS_CI_COMMIT_SHA:', 'persist-credentials: false', 'environment: derech-cloudflare-review', 'cancel-in-progress: false', 'actions: read']) assert(workflow.includes(required), required);
assert(workflow.includes('  workflow_call:'));
assert(workflow.includes("inputs.verify_result == 'success'"));
assert(workflow.includes("vars.DERECH_CF_VERIFIED_JOB_DEPLOY_ENABLED == 'true'"));
assert.equal((workflow.match(/node (?:\.\.\/)?production\/cloudflare-cd-policy\.mjs/g) ?? []).length, 3, 'guard before build and each provider mutation');
assert(workflow.indexOf('node production/cloudflare-cd-policy.mjs') < workflow.indexOf('node scripts/build-cloudflare.mjs'));
assert(workflow.lastIndexOf('node production/cloudflare-cd-policy.mjs') < workflow.indexOf('npx wrangler d1 migrations apply'));
assert(workflow.indexOf('node ../production/cloudflare-cd-policy.mjs') < workflow.indexOf('npx wrangler deploy'));
assert(!/^  (?:push|pull_request|pull_request_target):/m.test(workflow), 'deploy only through manual or validated completed CI');
assert(!/uses:.*(?:download-artifact|\/main\b|@v\d)/.test(workflow), 'pinned actions and no untrusted CI artifact consumption');
const ci = readFileSync(new URL('./github-workflows/site-ci.yml', import.meta.url), 'utf8');
assert(ci.includes('run: node production/test-cloudflare-cd-policy.mjs'), 'ordinary CI must require deployment policy tests');
assert(ci.indexOf('actions/setup-node@') < ci.indexOf('run: node production/test-cloudflare-cd-policy.mjs'));
for (const required of ['  deploy-review:', 'needs: verify', "needs.verify.result == 'success'", 'uses: ./.github/workflows/site-cloudflare.yml', 'verify_result: ${{ needs.verify.result }}', "vars.DERECH_CF_VERIFIED_JOB_DEPLOY_ENABLED == 'true'", "cancel-in-progress: ${{ !(github.event_name == 'push' && vars.DERECH_CF_VERIFIED_JOB_DEPLOY_ENABLED == 'true') }}", 'actions: read']) assert(ci.includes(required), required);
assert(!ci.includes('secrets: inherit'));
console.log('Cloudflare review CD policy passed: exact SHA, same-run successful verify job/attempt API proof, legacy successful push-only gate, default-disabled flags, fork/PR/stale denial and protected non-cancelling deployment.');
