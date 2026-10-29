#!/usr/bin/env python3
"""Run both fixed review targets from the existing timer/callback; never send."""
import argparse
import json
import os
import subprocess
from pathlib import Path

BASE = Path('/opt/yarden-site-monitor')
STATE = Path('/var/lib/yarden-site-monitor')
TARGETS = ('sites', 'cloudflare')

def allowed():
    try:
        result = subprocess.run(['/usr/bin/python3', '/opt/yarden-time-policy/time_policy.py'], capture_output=True, text=True, timeout=10)
        return result.returncode == 0 and json.loads(result.stdout).get('allowed') is True
    except Exception:
        return False

def command(kind, target):
    if kind not in ('monitor', 'alerts') or target not in TARGETS:
        raise ValueError('runner_scope_invalid')
    state = STATE / ('state.json' if target == 'sites' else 'cloudflare-state.json')
    args = ['/usr/bin/python3', str(BASE / ('site-review-monitor.py' if kind == 'monitor' else 'site-review-alerts.py')), '--target', target, '--state', str(state)]
    if kind == 'monitor':
        args += ['--release-file', str(BASE / ('site-release-sites.json' if target == 'sites' else 'site-release.json'))]
        args += ['--service-config', '/etc/yarden-site-monitor.json'] if target == 'sites' else ['--public-only']
    else:
        args += ['--ops-directory', str(BASE / 'ops')]
    return args

def run(kind, *, gate=allowed, execute=subprocess.run):
    results = []
    for target in TARGETS:
        if gate() is not True:
            print(json.dumps({'state': 'time_policy_closed', 'targets': results}))
            return 0
        try:
            result = execute(command(kind, target), capture_output=True, text=True, timeout=42 if kind == 'monitor' else 65)
            code = result.returncode if result.returncode in (0, 1, 2) else 2
        except Exception:
            code = 2
        # Never echo child output, stderr, provider messages or credentials.
        results.append({'target': target, 'exitCode': code})
    print(json.dumps({'state': 'targets_checked', 'kind': kind, 'targets': results}))
    # Existing SuccessExitStatus=1 still starts the sole alert callback even if
    # one target failed; each adapter independently rejects stale/invalid state.
    return (1 if kind == 'monitor' else 2) if any(item['exitCode'] for item in results) else 0

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--kind', choices=('monitor', 'alerts'), required=True)
    args = parser.parse_args(argv)
    if os.geteuid() != 0:
        print('{"state":"deployment_owner_required"}'); return 2
    return run(args.kind)

if __name__ == '__main__':
    raise SystemExit(main())
