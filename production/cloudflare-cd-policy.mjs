import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const repository = 'YardenRimon/derech-tkuma-journeys';
const branches = new Set(['main', 'production-foundation-20261019']);
const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const blocked = code => { throw new Error(`Cloudflare review deployment blocked: ${code}`); };

function trustedRun(run, allowRunning = false) {
  return run?.name === 'Shared CMS checks' && run.event === 'push' &&
    ((run.status === 'completed' && run.conclusion === 'success') ||
      (allowRunning && run.status === 'in_progress' && run.conclusion === null)) &&
    run.head_repository?.full_name === repository && branches.has(run.head_branch) &&
    run.path === '.github/workflows/site-ci.yml' && sha(run.head_sha) &&
    Number.isSafeInteger(run.id) && run.id > 0;
}

export function selectDeployment({ eventName, event, ref, sourceSha, autoEnabled, verifiedJobEnabled, verifyResult, runId, runAttempt }) {
  if (event?.repository?.full_name !== repository) blocked('repository');
  if (eventName === 'workflow_dispatch') {
    const branch = typeof ref === 'string' && ref.startsWith('refs/heads/') ? ref.slice(11) : '';
    if (!branches.has(branch) || !sha(sourceSha)) blocked('manual_source');
    return { repository, branch, sha: sourceSha, mode: 'manual' };
  }
  if (eventName === 'push') {
    const branch = typeof ref === 'string' && ref.startsWith('refs/heads/') ? ref.slice(11) : '';
    const id = Number(runId), attempt = Number(runAttempt);
    if (verifiedJobEnabled !== 'true' || verifyResult !== 'success' || !branches.has(branch) || !sha(sourceSha) ||
      event.deleted !== false || event.head_commit?.id !== sourceSha ||
      !Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(attempt) || attempt <= 0) blocked('untrusted_verified_job_event');
    return { repository, branch, sha: sourceSha, mode: 'verified_job', runId: id, runAttempt: attempt };
  }
  if (eventName !== 'workflow_run' || autoEnabled !== 'true' || event.action !== 'completed' || !trustedRun(event.workflow_run)) blocked('untrusted_ci_event');
  const run = event.workflow_run;
  return { repository, branch: run.head_branch, sha: run.head_sha, mode: 'automatic', runId: run.id };
}

export function checkApplicationSource(candidate, { head, exists = path => existsSync(join(repositoryRoot, path)) }) {
  if (head !== candidate.sha) blocked('checkout_sha');
  for (const path of ['platform-cms/package.json', 'platform-cms/scripts/build-cloudflare.mjs', 'platform-cms/scripts/validate-cloudflare-artifact.mjs', 'platform-cms/public-assets-manifest.json', 'production/cloudflare-cd-policy.mjs']) {
    if (!exists(path)) blocked('application_source_missing');
  }
}

export async function verifyCurrentSource(candidate, { token, fetcher = fetch } = {}) {
  if (!token || candidate.repository !== repository || !branches.has(candidate.branch) || !sha(candidate.sha) || !['manual', 'automatic', 'verified_job'].includes(candidate.mode)) blocked('verification_inputs');
  async function get(path) {
    let response;
    try {
      response = await fetcher(`https://api.github.com/repos/${repository}/${path}`, {
        redirect: 'error', signal: AbortSignal.timeout(15_000),
        headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
      });
      if (!response.ok || response.redirected) blocked('github_read_failed');
      return await response.json();
    } catch { blocked('github_read_failed'); }
  }
  if (candidate.mode === 'automatic' || candidate.mode === 'verified_job') {
    const run = await get(`actions/runs/${candidate.runId}`);
    if (!trustedRun(run, candidate.mode === 'verified_job') || run.id !== candidate.runId || run.head_sha !== candidate.sha || run.head_branch !== candidate.branch || run.repository?.full_name !== repository) blocked('ci_readback_mismatch');
    if (candidate.mode === 'verified_job') {
      if (run.run_attempt !== candidate.runAttempt) blocked('ci_attempt_mismatch');
      const result = await get(`actions/runs/${candidate.runId}/attempts/${candidate.runAttempt}/jobs?per_page=100`);
      if (!Number.isSafeInteger(result.total_count) || result.total_count < 1 || result.total_count > 100 || !Array.isArray(result.jobs) || result.jobs.length !== result.total_count) blocked('ci_jobs_unavailable');
      const verified = result.jobs.filter(job => job.name === 'verify');
      if (verified.length !== 1 || verified[0].run_id !== candidate.runId || verified[0].head_sha !== candidate.sha ||
        verified[0].status !== 'completed' || verified[0].conclusion !== 'success' ||
        (verified[0].run_attempt !== undefined && verified[0].run_attempt !== candidate.runAttempt)) blocked('verify_job_not_successful');
    }
  }
  const current = await get(`git/ref/heads/${encodeURIComponent(candidate.branch)}`);
  if (current.object?.sha !== candidate.sha) blocked('superseded_source');
}

async function main() {
  const environment = process.env;
  const candidate = selectDeployment({
    eventName: environment.GITHUB_EVENT_NAME,
    event: JSON.parse(readFileSync(environment.GITHUB_EVENT_PATH, 'utf8')),
    ref: environment.GITHUB_REF, sourceSha: environment.GITHUB_SHA,
    autoEnabled: environment.DERECH_CF_AUTO_DEPLOY_ENABLED,
    verifiedJobEnabled: environment.DERECH_CF_VERIFIED_JOB_DEPLOY_ENABLED,
    verifyResult: environment.DERECH_CI_VERIFY_RESULT,
    runId: environment.GITHUB_RUN_ID, runAttempt: environment.GITHUB_RUN_ATTEMPT,
  });
  if (candidate.sha !== environment.WORKERS_CI_COMMIT_SHA || candidate.branch !== environment.DERECH_DEPLOY_BRANCH) blocked('build_identity');
  checkApplicationSource(candidate, { head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', cwd: repositoryRoot }).trim() });
  await verifyCurrentSource(candidate, { token: environment.GH_READ_TOKEN });
  console.log(JSON.stringify({ reviewSourceVerified: true, sourceSha: candidate.sha, branch: candidate.branch, mode: candidate.mode }));
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch(error => { console.error(error.message.startsWith('Cloudflare review deployment blocked:') ? error.message : 'Cloudflare review deployment blocked: local_precondition'); process.exitCode = 1; });
}
