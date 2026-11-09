import assert from 'node:assert/strict';
import test from 'node:test';
import { filterMemoryBootstrap, registerMemoryOwnerOnly } from '../src/memory-owner-only.js';

const OWNER = '15550100123';
const DM = 'agent:main:whatsapp:secondary:direct:+15550100123';
const OTHER_DM = 'agent:main:whatsapp:secondary:direct:+15550100999';
const GROUP = 'agent:main:whatsapp:secondary:group:120363000000000000@g.us';
const FILES = [{ name: 'AGENTS.md' }, { name: 'MEMORY.md' }, { name: 'USER.md' }];

function setup(ownerDigits: () => Promise<string | undefined> = async () => OWNER) {
  const hooks = new Map<string, (...args: any[]) => any>();
  registerMemoryOwnerOnly({
    logger: { info() {} },
    registerHook: (event: string, handler: never) => { hooks.set(event, handler); },
  } as never, { ownerDigits });
  return async (sessionKey: string | undefined) => {
    const context: { bootstrapFiles: unknown[]; sessionKey?: string } = { bootstrapFiles: [...FILES], ...(sessionKey ? { sessionKey } : {}) };
    await hooks.get('agent:bootstrap')!({ sessionKey: sessionKey ?? 'unknown', context });
    return (context.bootstrapFiles as Array<{ name: string }>).map((file) => file.name);
  };
}

test('MEMORY.md is kept only for the verified owner direct session', async () => {
  const run = setup();
  assert.deepEqual(await run(DM), ['AGENTS.md', 'MEMORY.md', 'USER.md']);
  for (const key of [OTHER_DM, GROUP, 'agent:main:cron:1', 'agent:main:subagent:1', 'agent:main:heartbeat:1', 'agent:main:main', undefined]) {
    assert.deepEqual(await run(key), ['AGENTS.md', 'USER.md'], String(key));
  }
});

test('an unknown owner or a failing lookup removes MEMORY.md', async () => {
  assert.deepEqual(await setup(async () => undefined)(DM), ['AGENTS.md', 'USER.md']);
  assert.deepEqual(await setup(async () => { throw new Error('unreadable'); })(DM), ['AGENTS.md', 'USER.md']);
});

test('filter matches the file name case-insensitively and leaves other files alone', () => {
  assert.deepEqual(filterMemoryBootstrap([{ name: 'memory.md' }, { name: 'SOUL.md' }, {}], false), [{ name: 'SOUL.md' }, {}]);
  assert.equal(filterMemoryBootstrap(FILES, true).length, 3);
});
