#!/usr/bin/env python3
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import os
from unittest import mock

path = Path(__file__).with_name('lab-auto-repair.py')
spec = importlib.util.spec_from_file_location('repair', path)
repair = importlib.util.module_from_spec(spec)
spec.loader.exec_module(repair)

incident = {'id': '11111111-2222-4333-8444-555555555555', 'record': {
    'schema': 'lab-repair-incident/v1', 'tool': 'pubg_query_stats',
    'category': 'type_error', 'error': 'TypeError: private chat\n at plugins/pubg/src/index.ts:12:9',
    'observedAt': '2026-01-01T00:00:00Z'}}
assert repair.valid_incident(incident['record'])
assert not repair.valid_incident(dict(incident['record'], tool='../../bad'))
assert 'private chat' not in repair.diagnostic(incident['record']['error'])
assert repair.diagnostic(incident['record']['error']) == 'plugins/pubg/src/index.ts:12:9'
assert repair.allowed_changes(['plugins/pubg/src/index.ts', 'plugins/pubg/tests/test.ts'])
assert not repair.allowed_changes(['plugins/pubg/src/private.json'])
assert not repair.allowed_changes(['plugins/pubg/src/../../evil.ts'])
assert not repair.allowed_changes(['scripts/lab-auto-repair.py'])

with tempfile.TemporaryDirectory(prefix='lab-repair-test-') as temporary:
    repair.STATE = Path(temporary)
    calls = []
    head = ['base']
    dirty = [False]
    def git(*args, check=True):
        calls.append(('git', args))
        if args[:2] == ('status', '--porcelain'):
            if '-uall' in args:
                return ' M plugins/pubg/src/index.ts\n?? plugins/pubg/tests/new.test.ts'
            return ' M existing' if dirty[0] else ''
        if args == ('rev-parse', 'HEAD'):
            return head[0]
        if args == ('rev-parse', 'origin/main'):
            return 'base'
        if args and args[0] == 'commit':
            head[0] = 'fixsha'
        return ''
    def run(args, **kwargs):
        calls.append(('run', tuple(args)))
        if args[0] == 'codex':
            assert 'private chat' in kwargs['input']
            assert 'untrusted data' in kwargs['input']
            assert 'plugins/pubg/src/index.ts:12:9' in kwargs['input']
        return subprocess.CompletedProcess(args, 0, '', '')
    notifications = []
    def notify(key, summary):
        notifications.append((key, summary))
        return len(notifications) > 1
    discarded = []
    with mock.patch.object(repair, 'git', git), mock.patch.object(repair, 'run', run), \
         mock.patch.object(repair, 'release_verified', return_value=False), \
         mock.patch.object(repair, 'notify', notify), mock.patch.object(repair, 'discard_remote', discarded.append):
        dirty[0] = True
        assert repair.process(incident) == 'waiting_worktree'
        assert not any(entry[0] == 'run' for entry in calls)
        dirty[0] = False
        assert repair.process(incident) == 'waiting_candidate'
        assert json.loads((repair.STATE / 'job.json').read_text())['phase'] == 'pushed'
        assert not notifications
        assert any(entry[0] == 'git' and entry[1][0] == 'push' for entry in calls)
    with mock.patch.object(repair, 'release_verified', return_value=True), \
         mock.patch.object(repair, 'notify', notify), mock.patch.object(repair, 'discard_remote', discarded.append):
        assert repair.process(incident) == 'waiting_notification'
        assert repair.process(incident) == 'done'
        assert discarded == [incident['id']]
        assert not (repair.STATE / 'job.json').exists()
        duplicate = dict(incident, id='21111111-2222-4333-8444-555555555555')
        assert repair.process(duplicate) == 'duplicate'
        assert discarded[-1] == duplicate['id']
    assert sum(1 for entry in calls if entry[0] == 'git' and entry[1][0] == 'push') == 1

with tempfile.TemporaryDirectory(prefix='lab-repair-release-test-') as temporary:
    repair.RELEASE_STATE = Path(temporary) / 'release.json'
    repair.RELEASE_STATE.write_text(json.dumps({'lastCandidateSha': 'fixsha', 'pending': None}))
    snapshot = {'services': [{'service': 'openclaw', 'gitSha': 'fixsha', 'state': 'running', 'health': 'healthy'}]}
    def snapshot_run(args, **kwargs):
        return subprocess.CompletedProcess(args, 1 if args[0] == 'git' else 0, json.dumps(snapshot), '')
    with mock.patch.object(repair.subprocess, 'run', side_effect=snapshot_run):
        assert repair.release_verified('fixsha')
        assert not repair.release_verified('other')
    snapshot['services'][0]['health'] = 'unhealthy'
    with mock.patch.object(repair.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, json.dumps(snapshot), '')):
        assert not repair.release_verified('fixsha')

with tempfile.TemporaryDirectory(prefix='lab-repair-router-test-') as temporary:
    repair.STATE = Path(temporary) / 'state'
    repair.STATE.mkdir()
    repair.RELEASE_STATE = Path(temporary) / 'release/state.json'
    repair.RELEASE_STATE.parent.mkdir()
    sha = 'a' * 40
    job = {'id': incident['id'], 'phase': 'router', 'tool': 'model_request', 'category': 'invalid_schema',
           'sha': sha, 'fingerprint': 'key', 'needsRouter': True, 'needsLab': False}
    repair.private_write(repair.STATE / 'job.json', job)
    calls = []
    def router_git(*args, **kwargs):
        return sha if args == ('rev-parse', 'HEAD') else ''
    def router_run(args, **kwargs):
        calls.append(args)
        output = 'local/9router:git-' + sha[:12] + '-test' if args[0] == 'orb' else ''
        return subprocess.CompletedProcess(args, 0, output, '')
    with mock.patch.object(repair, 'git', router_git), mock.patch.object(repair, 'run', router_run), \
         mock.patch.object(repair, 'notify', return_value=True), mock.patch.object(repair, 'discard_remote'):
        assert repair.process(incident) == 'done'
    assert any('--apply' in args and '--build' in args for args in calls)

# Exercise real Git staging, commit and push with a fake agent and test runner.
with tempfile.TemporaryDirectory(prefix='lab-repair-git-test-') as temporary:
    root = Path(temporary)
    bare, repo, bin_dir = root / 'remote.git', root / 'repo', root / 'bin'
    bin_dir.mkdir()
    def shell(*args, cwd=root):
        return subprocess.run(args, cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()
    shell('git', 'init', '--bare', '--initial-branch=main', str(bare))
    shell('git', 'clone', str(bare), str(repo))
    shell('git', 'config', 'user.email', 'test@example.invalid', cwd=repo)
    shell('git', 'config', 'user.name', 'Test', cwd=repo)
    source = repo / 'plugins/pubg/src/index.ts'
    source.parent.mkdir(parents=True)
    source.write_text('export const value = 1;\n')
    (repo / 'scripts').mkdir()
    (repo / 'scripts/check-secrets.sh').write_text('#!/bin/sh\nexit 0\n')
    shell('git', 'add', '.', cwd=repo)
    shell('git', 'commit', '-m', 'initial', cwd=repo)
    shell('git', 'push', 'origin', 'HEAD:main', cwd=repo)
    fake_codex = bin_dir / 'codex'
    fake_codex.write_text('#!/bin/sh\ncat >/dev/null\nprintf "export const value = 2;\\n" > plugins/pubg/src/index.ts\nmkdir -p plugins/pubg/tests\nprintf "test fixture\\n" > plugins/pubg/tests/repair.test.ts\n')
    fake_codex.chmod(0o755)
    fake_pnpm = bin_dir / 'pnpm'
    fake_pnpm.write_text('#!/bin/sh\nexit 0\n')
    fake_pnpm.chmod(0o755)
    repair.ROOT = repo
    repair.STATE = root / 'state'
    repair.PNPM = str(fake_pnpm)
    repair.NODE = str(fake_pnpm)
    with mock.patch.dict(os.environ, {'PATH': str(bin_dir) + os.pathsep + os.environ['PATH']}), \
         mock.patch.object(repair, 'release_verified', return_value=False):
        assert repair.process(incident) == 'waiting_candidate'
    sha = shell('git', 'rev-parse', 'HEAD', cwd=repo)
    assert shell('git', '--git-dir', str(bare), 'rev-parse', 'main') == sha
    assert shell('git', 'status', '--porcelain', cwd=repo) == ''
    assert json.loads((repair.STATE / 'job.json').read_text())['sha'] == sha
    private_phrase = 'a very private chat message'
    fake_codex.write_text('#!/bin/sh\ncat >/dev/null\nprintf "// a very private chat message\\n" >> plugins/pubg/src/index.ts\nprintf "more test\\n" >> plugins/pubg/tests/repair.test.ts\n')
    repair.STATE = root / 'state2'
    private_incident = dict(incident, record=dict(incident['record'], params={'question': private_phrase}))
    with mock.patch.dict(os.environ, {'PATH': str(bin_dir) + os.pathsep + os.environ['PATH']}):
        try:
            repair.process(private_incident)
            raise AssertionError('private chat must block the commit')
        except RuntimeError as error:
            assert 'private diagnostic' in str(error)
    assert shell('git', '--git-dir', str(bare), 'rev-parse', 'main') == sha

print('Lab automatic repair state-machine tests passed')
