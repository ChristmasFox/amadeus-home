import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  OWNER_DM_PREFERENCES_FILE,
  OWNER_DM_PREFERENCES_MAX_CHARS,
  registerOwnerDmPreferences,
} from '../src/owner-dm-preferences.js';

const OWNER = '15550100123';
const DM = 'agent:main:whatsapp:secondary:direct:+15550100123';
const OTHER_DM = 'agent:main:whatsapp:secondary:direct:+15550100999';
const GROUP = 'agent:main:whatsapp:secondary:group:120363000000000000@g.us';
const PLACEHOLDER = 'NEUTRAL-PLACEHOLDER-TEXT';
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

async function workspace(content?: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'owner-dm-prefs-'));
  if (content !== undefined) {
    await mkdir(join(dir, '.amadeus-private'), { recursive: true });
    await writeFile(join(dir, '.amadeus-private', OWNER_DM_PREFERENCES_FILE), content);
  }
  return dir;
}

async function setup(ownerDigits: () => Promise<string | undefined> = async () => OWNER, config?: unknown, logs: string[] = []) {
  const hooks = new Map<string, (...args: any[]) => any>();
  registerOwnerDmPreferences({ config, logger: { info: (m: string) => logs.push(m) }, on: (name: string, handler: never) => hooks.set(name, handler) } as never, { ownerDigits });
  await settle();
  return (sessionKey: string | undefined, workspaceDir: string | undefined) => hooks.get('before_prompt_build')!({}, { sessionKey, workspaceDir });
}

test('file content is injected only into the verified owner direct session', async () => {
  const dir = await workspace(`  ${PLACEHOLDER}\n`);
  try {
    const inject = await setup();
    assert.equal(inject(DM, dir).appendSystemContext, PLACEHOLDER);
    for (const key of [GROUP, OTHER_DM, 'agent:main:cron:1', 'agent:main:subagent:1', 'agent:main:main', undefined]) {
      assert.equal(inject(key, dir), undefined, String(key));
    }
    assert.equal(inject(DM, undefined), undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('missing or empty file injects nothing', async () => {
  const missing = await workspace();
  const empty = await workspace('  \n\n');
  try {
    const inject = await setup();
    assert.equal(inject(DM, missing), undefined);
    assert.equal(inject(DM, empty), undefined);
    assert.equal(inject(DM, join(missing, 'does-not-exist')), undefined);
  } finally {
    await rm(missing, { recursive: true, force: true });
    await rm(empty, { recursive: true, force: true });
  }
});

test('oversized file is truncated at a line boundary', async () => {
  const line = `${PLACEHOLDER}-${'x'.repeat(80)}`;
  const dir = await workspace(Array.from({ length: 100 }, () => line).join('\n'));
  try {
    const text = (await setup())(DM, dir).appendSystemContext as string;
    assert.ok(text.length <= OWNER_DM_PREFERENCES_MAX_CHARS);
    assert.ok(text.length > OWNER_DM_PREFERENCES_MAX_CHARS - line.length - 2);
    assert.ok(text.split('\n').every((entry) => entry === line));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('nothing is injected while the owner is unknown, and a failing lookup never throws', async () => {
  const dir = await workspace(PLACEHOLDER);
  try {
    assert.equal((await setup(async () => undefined))(DM, dir), undefined);
    assert.equal((await setup(async () => { throw new Error('unreadable'); }))(DM, dir), undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('falls back to the configured default workspace when the hook context has none', async () => {
  const dir = await workspace(PLACEHOLDER);
  try {
    const inject = await setup(async () => OWNER, { agents: { defaults: { workspace: dir } } });
    assert.equal(inject(DM, undefined).appendSystemContext, PLACEHOLDER);
    for (const key of [GROUP, OTHER_DM, 'agent:main:cron:1', 'agent:main:subagent:1', undefined]) {
      assert.equal(inject(key, undefined), undefined, String(key));
    }
    assert.equal((await setup(async () => OWNER, {}))(DM, undefined), undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a context workspace without the file does not hide the configured workspace', async () => {
  const configured = await workspace(PLACEHOLDER);
  const elsewhere = await workspace();
  const logs: string[] = [];
  try {
    const inject = await setup(async () => OWNER, { agents: { defaults: { workspace: configured } } }, logs);
    assert.equal(inject(DM, elsewhere).appendSystemContext, PLACEHOLDER);
    assert.equal(inject(DM, elsewhere).appendSystemContext, PLACEHOLDER);
    assert.equal(inject(GROUP, elsewhere), undefined);
    assert.deepEqual(logs, [`amadeus owner dm preferences injected chars=${PLACEHOLDER.length}`]);
  } finally {
    await rm(configured, { recursive: true, force: true });
    await rm(elsewhere, { recursive: true, force: true });
  }
});

test('the context workspace is used when the configured one has no file', async () => {
  const configured = await workspace();
  const contextDir = await workspace(PLACEHOLDER);
  try {
    const inject = await setup(async () => OWNER, { agents: { defaults: { workspace: configured } } });
    assert.equal(inject(DM, contextDir).appendSystemContext, PLACEHOLDER);
  } finally {
    await rm(configured, { recursive: true, force: true });
    await rm(contextDir, { recursive: true, force: true });
  }
});

test('missing everywhere injects nothing and logs each skip reason once', async () => {
  const empty = await workspace();
  const logs: string[] = [];
  try {
    const inject = await setup(async () => OWNER, { agents: { defaults: { workspace: empty } } }, logs);
    for (let i = 0; i < 3; i += 1) assert.equal(inject(DM, empty), undefined);
    assert.equal((await setup(async () => OWNER, {}, logs))(DM, undefined), undefined);
    assert.deepEqual(logs, ['amadeus owner dm preferences skipped reason=no-file', 'amadeus owner dm preferences skipped reason=no-workspace']);
  } finally {
    await rm(empty, { recursive: true, force: true });
  }
});
