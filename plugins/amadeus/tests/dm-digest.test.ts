import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, mkdir, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DIGEST_HEADER, DIGEST_MAX_CHARS, buildTranscript, capDigest, digestPath, isOwnerDirectSession, registerDmDigest, renderDigestContext, updateDigest, validateDigest } from '../src/dm-digest.js';

const OWNER = '15550100123';
const DM = 'agent:main:whatsapp:secondary:direct:+15550100123';
const OTHER_DM = 'agent:main:whatsapp:secondary:direct:+15550100999';
const GROUP = 'agent:main:whatsapp:secondary:group:120363000000000000@g.us';
const messages = [
  { role: 'user', content: '最近在调试家里的 NAS，硬盘总是休眠失败。' },
  { role: 'assistant', content: [{ type: 'text', text: '先看看休眠策略和 SMART 状态。' }] },
  { role: 'toolResult', content: '不应该进入摘要' },
];
const good = '- (2026-10-31) 在排查 NAS 硬盘休眠失败\n- (2026-10-30) 想换一个更安静的机箱';

async function workspace(): Promise<string> { return mkdtemp(join(tmpdir(), 'amadeus-digest-')); }
function setup(dir: string, complete: (prompt: string) => Promise<string>, logs: string[] = [], config: unknown = {}) {
  const hooks = new Map<string, (...args: any[]) => any>();
  registerDmDigest({
    logger: { info: (m: string) => logs.push(m), warn: (m: string) => logs.push(m), error() {}, debug() {} },
    on: (name: string, handler: never) => hooks.set(name, handler),
    config,
  } as never, { complete: async (prompt) => complete(prompt), ownerDigits: async () => OWNER, now: () => Date.now() });
  return hooks;
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 250));

test('transcript keeps only user/assistant text and is bounded', () => {
  const transcript = buildTranscript(messages);
  assert.match(transcript, /用户: 最近在调试/u);
  assert.match(transcript, /助手: 先看看/u);
  assert.doesNotMatch(transcript, /不应该进入/u);
  assert.ok(buildTranscript(Array.from({ length: 500 }, () => ({ role: 'user', content: '很长的内容'.repeat(200) }))).length <= 9000);
});

test('digest validation rejects non-bullets and secret-like lines, and caps size newest-first', () => {
  assert.equal(validateDigest('没有列表'), undefined);
  assert.equal(validateDigest('- (2026-10-31) 密码是 abc'), undefined);
  assert.equal(validateDigest('- (2026-10-31) 联系 +15550100123'), undefined);
  const long = Array.from({ length: 80 }, (_, index) => `- (2026-10-31) 第${index}条${'要'.repeat(40)}`).join('\n');
  const capped = capDigest(long);
  assert.ok(capped.length <= DIGEST_MAX_CHARS);
  assert.ok(capped.split('\n').length <= 30);
  assert.match(capped, /第0条/u);
  assert.doesNotMatch(capped, /第79条/u, 'oldest lines are truncated first');
  assert.ok(renderDigestContext(good).startsWith(DIGEST_HEADER));
});

test('owner direct session detection', () => {
  assert.equal(isOwnerDirectSession(DM, OWNER), true);
  assert.equal(isOwnerDirectSession(OTHER_DM, OWNER), false);
  assert.equal(isOwnerDirectSession(GROUP, OWNER), false);
  assert.equal(isOwnerDirectSession(DM, undefined), false);
});

test('digest is injected only into the owner DM, never groups, other DMs or cron', async () => {
  const dir = await workspace();
  try {
    await mkdir(join(dir, '.amadeus-private'), { recursive: true });
    await writeFile(digestPath(dir), `${good}\n`);
    const hooks = setup(dir, async () => good);
    await settle();
    const inject = (sessionKey: string) => hooks.get('before_prompt_build')!({}, { sessionKey, workspaceDir: dir });
    const owner = inject(DM);
    assert.match(owner.appendSystemContext, /NAS 硬盘休眠/u);
    assert.match(owner.appendSystemContext, /背景笔记，可能已过时，不要复述/u);
    for (const key of [GROUP, OTHER_DM, 'agent:main:cron:1', 'agent:main:subagent:1']) assert.equal(inject(key), undefined, key);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('reset hook of the owner DM writes the digest; group and other DMs never do', async () => {
  const dir = await workspace();
  try {
    const prompts: string[] = [];
    const hooks = setup(dir, async (prompt) => { prompts.push(prompt); return good; });
    hooks.get('before_reset')!({ messages }, { sessionKey: GROUP, workspaceDir: dir });
    hooks.get('before_reset')!({ messages }, { sessionKey: OTHER_DM, workspaceDir: dir });
    await settle();
    assert.equal(prompts.length, 0);
    await assert.rejects(readFile(digestPath(dir)));
    hooks.get('before_reset')!({ messages }, { sessionKey: DM, workspaceDir: dir });
    await settle();
    assert.equal(prompts.length, 1);
    assert.match(prompts[0]!, /NAS/u);
    assert.equal(await readFile(digestPath(dir), 'utf8'), `${good}\n`);
    assert.equal((await stat(digestPath(dir))).mode & 0o777, 0o600);
    assert.deepEqual(await readdir(join(dir, '.amadeus-private')), ['dm-digest.md']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('model failure or invalid output keeps the previous digest; logs carry no content', async () => {
  const dir = await workspace();
  try {
    await mkdir(join(dir, '.amadeus-private'), { recursive: true });
    await writeFile(digestPath(dir), `${good}\n`);
    for (const complete of [async () => { throw new Error('upstream 502 with 私密内容'); }, async () => '随便一段不是列表的话', async () => '- (2026-10-31) api_key=abcdefghijklmnop']) {
      const result = await updateDigest({ workspaceDir: dir, messages, complete });
      assert.equal(result, 'failed');
      assert.equal(await readFile(digestPath(dir), 'utf8'), `${good}\n`);
    }
    assert.equal(await updateDigest({ workspaceDir: dir, messages: [{ role: 'user', content: 'hi' }], complete: async () => good }), 'skipped');
    const logs: string[] = [];
    const hooks = setup(dir, async () => { throw new Error('私密内容 NAS'); }, logs);
    hooks.get('before_reset')!({ messages }, { sessionKey: DM, workspaceDir: dir });
    await settle();
    assert.equal(logs.some((line) => /私密|NAS|休眠/u.test(line)), false);
    assert.equal(await readFile(digestPath(dir), 'utf8'), `${good}\n`);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('digest injection falls back to the configured default workspace when the hook context has none', async () => {
  const dir = await workspace();
  try {
    await mkdir(join(dir, '.amadeus-private'), { recursive: true });
    await writeFile(digestPath(dir), `${good}\n`);
    const hooks = setup(dir, async () => good, [], { agents: { defaults: { workspace: dir } } });
    await settle();
    const inject = (sessionKey: string) => hooks.get('before_prompt_build')!({}, { sessionKey });
    assert.match(inject(DM).appendSystemContext, /NAS 硬盘休眠/u);
    for (const key of [GROUP, OTHER_DM, 'agent:main:cron:1']) assert.equal(inject(key), undefined, key);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('digest injection finds the file in the configured workspace when the context points elsewhere', async () => {
  const dir = await workspace();
  const elsewhere = await workspace();
  try {
    await mkdir(join(dir, '.amadeus-private'), { recursive: true });
    await writeFile(digestPath(dir), `${good}\n`);
    const hooks = setup(dir, async () => good, [], { agents: { defaults: { workspace: dir } } });
    await settle();
    const inject = (sessionKey: string) => hooks.get('before_prompt_build')!({}, { sessionKey, workspaceDir: elsewhere });
    assert.match(inject(DM).appendSystemContext, /NAS 硬盘休眠/u);
    for (const key of [GROUP, OTHER_DM, 'agent:main:cron:1']) assert.equal(inject(key), undefined, key);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(elsewhere, { recursive: true, force: true });
  }
});
