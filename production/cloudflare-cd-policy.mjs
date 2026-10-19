import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const repository = 'YardenRimon/derech-tkuma-journeys';
const branches = new Set(['main', 'production-foundation-20261019']);
const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const blocked = code => { throw new Error(`Cloudflare review deployment blocked: ${code}`); };

function trustedRun(run) {
  return run?.name === 'Shared CMS checks' && run.event === 'push' &&
    run.status === 'completed' && run.conclusion === 'success' &&
    run.head_repository?.full_name === repository && branches.has(run.head_branch) &&
    run.path === '.github/workflows/site-ci.yml' && sha(run.head_sha) &&
    Number.isSafeInteger(run.id) && run.id > 0;
}

export function selectDeployment({ eventName, event, ref, sourceSha, autoEnabled }) {
  if (event?.repository?.full_name !== repository) blocked('repository');
  if (eventName === 'workflow_dispatch') {
    const branch = typeof ref === 'string' && ref.startsWith('refs/heads/') ? ref.slice(11) : '';
    if (!branches.has(branch) || !sha(sourceSha)) blocked('manual_source');
    return { repository, branch, sha: sourceSha, mode: 'manual' };
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
  if (!token || candidate.repository !== repository || !branches.has(candidate.branch) || !sha(candidate.sha)) blocked('verification_inputs');
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
  if (candidate.mode === 'automatic') {
    const run = await get(`actions/runs/${candidate.runId}`);
    if (!trustedRun(run) || run.id !== candidate.runId || run.head_sha !== candidate.sha || run.head_branch !== candidate.branch || run.repository?.full_name !== repository) blocked('ci_readback_mismatch');
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
  });
  if (candidate.sha !== environment.WORKERS_CI_COMMIT_SHA || candidate.branch !== environment.DERECH_DEPLOY_BRANCH) blocked('build_identity');
  checkApplicationSource(candidate, { head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', cwd: repositoryRoot }).trim() });
  await verifyCurrentSource(candidate, { token: environment.GH_READ_TOKEN });
  console.log(JSON.stringify({ reviewSourceVerified: true, sourceSha: candidate.sha, branch: candidate.branch, mode: candidate.mode }));
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch(error => { console.error(error.message.startsWith('Cloudflare review deployment blocked:') ? error.message : 'Cloudflare review deployment blocked: local_precondition'); process.exitCode = 1; });
}
