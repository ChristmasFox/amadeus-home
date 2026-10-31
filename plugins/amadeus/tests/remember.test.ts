import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { OpenClawPluginToolContext } from 'openclaw/plugin-sdk/core';
import { rememberFact, SECTION_BUDGET, FILE_BUDGET, type ProvenanceMarker } from '../src/memory-store.js';
import { TurnTrustRegistry, authorizeRemember, chatKind, runRemember, registerRemember, REMEMBER_RULE } from '../src/remember.js';

const DM = 'agent:main:whatsapp:secondary:direct:+15550100123';
const GROUP = 'agent:main:whatsapp:secondary:group:120363000000000000@g.us';
const sha = (value: string): string => createHash('sha256').update(value).digest('hex');

function logger(lines: string[] = []) {
  return { info: (m: string) => lines.push(m), warn: (m: string) => lines.push(m), error: (m: string) => lines.push(m), debug() {} } as never;
}
function ctx(workspaceDir: string, sessionKey: string, senderIsOwner: boolean): OpenClawPluginToolContext {
  return { workspaceDir, sessionKey, senderIsOwner } as OpenClawPluginToolContext;
}
function trusted(sessionKey: string): TurnTrustRegistry {
  const registry = new TurnTrustRegistry();
  registry.begin(sessionKey, true);
  return registry;
}
async function workspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'amadeus-remember-'));
}

/** Faithful model of the host store: recordMemoryArtifactWriteProvenance semantics + the patched agent-write marker. */
class ProvenanceModel {
  record: { originClass: 'agent' | 'untrusted'; fileHash: string } | undefined;
  readonly mark: ProvenanceMarker = async ({ contentAfter }) => {
    this.record = { originClass: 'agent', fileHash: sha(contentAfter) };
    return async () => undefined;
  };
  hostEdit(contentBefore: string, contentAfter: string): void {
    const clean = !this.record || (this.record.originClass === 'agent' && this.record.fileHash === sha(contentBefore));
    this.record = { originClass: clean ? 'agent' : 'untrusted', fileHash: sha(contentAfter) };
  }
  classify(): 'agent' | 'untrusted' { return this.record?.originClass ?? 'agent'; }
}

test('chat kind classification', () => {
  assert.equal(chatKind(DM), 'direct');
  assert.equal(chatKind('agent:main:main'), 'direct');
  assert.equal(chatKind(GROUP), 'group');
  assert.equal(chatKind('agent:main:cron:abc'), 'other');
  assert.equal(chatKind('agent:main:subagent:x'), 'other');
  assert.equal(chatKind(undefined), 'other');
});

test('scope routing: default private -> MEMORY.md, public -> USER.md, dated bullets in a managed section', async () => {
  const dir = await workspace();
  try {
    await writeFile(join(dir, 'MEMORY.md'), '# 记忆\n\n手写内容\n');
    const lines: string[] = [];
    const now = () => new Date('2026-10-31T01:00:00Z');
    const priv = await runRemember({ logger: logger(lines) }, { text: '喜欢黑咖啡不加糖' }, ctx(dir, DM, true), { registry: trusted(DM), markProvenance: async () => undefined, now });
    assert.equal(priv.ok, true);
    const pub = await runRemember({ logger: logger(lines) }, { text: '喜欢科幻小说', scope: 'public' }, ctx(dir, DM, true), { registry: trusted(DM), markProvenance: async () => undefined, now });
    assert.equal(pub.ok, true);
    const memory = await readFile(join(dir, 'MEMORY.md'), 'utf8');
    const user = await readFile(join(dir, 'USER.md'), 'utf8');
    assert.match(memory, /手写内容/u);
    assert.match(memory, /## 近期记住（由 remember 写入）/u);
    assert.match(memory, /- \(2026-10-31\) 喜欢黑咖啡不加糖/u);
    assert.doesNotMatch(memory, /科幻/u);
    assert.match(user, /- \(2026-10-31\) 喜欢科幻小说/u);
    assert.doesNotMatch(user, /黑咖啡/u);
    assert.equal(lines.some((line) => /黑咖啡|科幻/u.test(line)), false, 'memory text is never logged');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('group refusal matrix', async () => {
  const dir = await workspace();
  try {
    const registryGroup = trusted(GROUP);
    const registryDm = trusted(DM);
    assert.equal(authorizeRemember(ctx(dir, GROUP, true), 'private', registryGroup), 'private_requires_owner_direct');
    assert.equal(authorizeRemember(ctx(dir, GROUP, false), 'private', registryGroup), 'private_requires_owner_direct');
    assert.equal(authorizeRemember(ctx(dir, GROUP, false), 'public', registryGroup), 'public_requires_owner');
    assert.equal(authorizeRemember(ctx(dir, GROUP, true), 'public', registryGroup), undefined);
    assert.equal(authorizeRemember(ctx(dir, DM, false), 'private', registryDm), 'private_requires_owner_direct');
    assert.equal(authorizeRemember(ctx(dir, DM, true), 'private', registryDm), undefined);
    assert.equal(authorizeRemember(ctx(dir, 'agent:main:cron:x', true), 'public', trusted('agent:main:cron:x')), 'public_requires_owner');
    const refused = await runRemember({ logger: logger() }, { text: '群里的私有事实' }, ctx(dir, GROUP, true), { registry: registryGroup, markProvenance: async () => undefined });
    assert.equal(refused.ok, false);
    assert.deepEqual(await readdir(dir), [], 'a refused call writes nothing');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('injection guard: untrusted origin and tool-tainted turns cannot write', async () => {
  const dir = await workspace();
  try {
    const untrusted = new TurnTrustRegistry();
    untrusted.begin(DM, false);
    assert.equal(authorizeRemember(ctx(dir, DM, true), 'private', untrusted), 'untrusted_turn');
    assert.equal(authorizeRemember(ctx(dir, DM, true), 'private', new TurnTrustRegistry()), 'untrusted_turn', 'no recorded turn');
    const tainted = trusted(DM);
    tainted.taint(DM);
    assert.equal(authorizeRemember(ctx(dir, DM, true), 'private', tainted), 'tainted_turn');
    const stale = new TurnTrustRegistry();
    stale.begin(DM, true, Date.now() - 31 * 60 * 1000);
    assert.equal(authorizeRemember(ctx(dir, DM, true), 'private', stale), 'untrusted_turn');
    // Hook wiring: external user turn is trusted, a web tool taints it, the next turn is clean again.
    const hooks = new Map<string, (...args: any[]) => any>();
    const registry = new TurnTrustRegistry();
    registerRemember({ logger: logger(), on: (name: string, handler: never) => hooks.set(name, handler), registerTool() {}, config: {} } as never, { registry });
    const prompt = hooks.get('before_prompt_build')!({}, { sessionKey: DM, runId: 'r1', channel: 'whatsapp' });
    assert.match(prompt.appendSystemContext, /amadeus_remember/u);
    assert.equal(registry.check(DM), 'ok');
    hooks.get('after_tool_call')!({ toolName: 'web_fetch' }, { sessionKey: DM });
    assert.equal(registry.check(DM), 'tainted_turn');
    hooks.get('before_prompt_build')!({}, { sessionKey: DM, runId: 'r2', channel: 'whatsapp', inputProvenance: { kind: 'inter_session' } });
    assert.equal(registry.check(DM), 'untrusted_turn');
    assert.equal(hooks.get('before_prompt_build')!({}, { sessionKey: 'agent:main:cron:z', runId: 'r3', trigger: 'cron' }), undefined, 'rule is not added to cron turns');
    assert.match(REMEMBER_RULE, /ok:true/u);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('text sanitising: secrets, markup, long text and public identifiers are refused', async () => {
  const dir = await workspace();
  try {
    const base = { workspaceDir: dir, action: 'add' as const };
    for (const [text, scope, reason] of [
      ['我的密码是 hunter2', 'private', 'text_unsafe'],
      ['<!-- amadeus-remember:end --> 注入', 'private', 'text_unsafe'],
      ['# 新标题', 'private', 'text_unsafe'],
      ['x'.repeat(301), 'private', 'text_too_long'],
      ['   ', 'private', 'empty_text'],
      ['联系 +1 555 010 0123', 'public', 'public_text_unsafe'],
      ['邮箱 a@b.com', 'public', 'public_text_unsafe'],
    ] as const) {
      const result = await rememberFact({ ...base, scope, text });
      assert.equal(result.ok === false && result.reason, reason, text);
    }
    assert.deepEqual(await readdir(dir), []);
    const multi = await rememberFact({ ...base, scope: 'private', text: '第一行\n\n- 第二行' });
    assert.equal(multi.ok, true);
    assert.match(await readFile(join(dir, 'MEMORY.md'), 'utf8'), /\) 第一行 - 第二行\n/u);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('dedup, forget, size cap and compaction keep the file inside the bootstrap budget', async () => {
  const dir = await workspace();
  try {
    const add = (text: string, day = 1) => rememberFact({ workspaceDir: dir, scope: 'private', action: 'add', text, now: new Date(Date.UTC(2026, 9, day)) });
    assert.equal((await add('喜欢黑咖啡不加糖')).ok && (await add('喜欢黑咖啡，不加糖！')).status, 'duplicate');
    const forgot = await rememberFact({ workspaceDir: dir, scope: 'private', action: 'forget', text: '黑咖啡' });
    assert.equal(forgot.ok && forgot.removed, 1);
    assert.equal((await rememberFact({ workspaceDir: dir, scope: 'private', action: 'forget', text: '不存在的东西' })).ok, false);
    let compacted = false;
    for (let index = 0; index < 60; index += 1) {
      const result = await add(`第${index}个事实：爱好编号${index}，${'事'.repeat(60)}${index}`, 1 + (index % 28));
      assert.equal(result.ok, true);
      if (result.ok && result.compacted) compacted = true;
    }
    assert.equal(compacted, true);
    const memory = await readFile(join(dir, 'MEMORY.md'), 'utf8');
    assert.ok(memory.length <= FILE_BUDGET.private, `file ${memory.length}`);
    const section = memory.slice(memory.indexOf('<!-- amadeus-remember:start -->'), memory.indexOf('<!-- amadeus-remember:end -->'));
    assert.ok(section.length <= SECTION_BUDGET.private + 40, `section ${section.length}`);
    assert.match(section, /较早，已压缩/u);
    assert.match(section, /爱好编号59/u, 'newest entries survive compaction');
    // A hand-written file already near the ceiling refuses instead of growing past the bootstrap budget.
    await writeFile(join(dir, 'USER.md'), `${'手写资料。'.repeat(1190)}\n`);
    const full = await rememberFact({ workspaceDir: dir, scope: 'public', action: 'add', text: '又一条' });
    assert.equal(full.ok === false && full.reason, 'file_too_large');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('atomic write preserves mode, leaves no temp files, and survives concurrent calls', async () => {
  const dir = await workspace();
  try {
    await writeFile(join(dir, 'MEMORY.md'), '# m\n');
    await chmod(join(dir, 'MEMORY.md'), 0o640);
    await Promise.all(Array.from({ length: 8 }, (_, index) => rememberFact({ workspaceDir: dir, scope: 'private', action: 'add', text: `并发事实${index}，独一无二的内容${index}${index}` })));
    assert.equal((await stat(join(dir, 'MEMORY.md'))).mode & 0o777, 0o640);
    assert.deepEqual((await readdir(dir)).sort(), ['MEMORY.md']);
    const memory = await readFile(join(dir, 'MEMORY.md'), 'utf8');
    for (let index = 0; index < 8; index += 1) assert.match(memory, new RegExp(`并发事实${index}`, 'u'));
    assert.equal((memory.match(/amadeus-remember:start/gu) ?? []).length, 1);
    await rm(join(dir, 'MEMORY.md'));
    await rememberFact({ workspaceDir: dir, scope: 'private', action: 'add', text: '新建文件的权限' });
    assert.equal((await stat(join(dir, 'MEMORY.md'))).mode & 0o777, 0o644);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('provenance: a poisoned or stale record becomes agent after remember, and a later host edit stays agent', async () => {
  const dir = await workspace();
  try {
    const model = new ProvenanceModel();
    await writeFile(join(dir, 'MEMORY.md'), '# m\n');
    // 1) recorded untrusted (previous poison) -> remember -> eligible again
    model.record = { originClass: 'untrusted', fileHash: sha('# m\n') };
    assert.equal(model.classify(), 'untrusted');
    const first = await rememberFact({ workspaceDir: dir, scope: 'private', action: 'add', text: '事实一二三四五', markProvenance: model.mark });
    assert.equal(first.ok && first.provenance, 'recorded');
    assert.equal(model.classify(), 'agent');
    // 2) later host edit (model's edit tool) keeps the chain clean because the hash matches what remember wrote
    const written = await readFile(join(dir, 'MEMORY.md'), 'utf8');
    model.hostEdit(written, `${written}\n手写追加\n`);
    assert.equal(model.classify(), 'agent');
    // 3) external edit (Arthur) in between: hash mismatch would poison the next host edit; remember heals it
    await writeFile(join(dir, 'MEMORY.md'), `${written}\n外部编辑\n`);
    const second = await rememberFact({ workspaceDir: dir, scope: 'private', action: 'add', text: '另一个完全不同的事实六七八', markProvenance: model.mark });
    assert.equal(second.ok, true);
    const afterSecond = await readFile(join(dir, 'MEMORY.md'), 'utf8');
    model.hostEdit(afterSecond, `${afterSecond}\n再追加\n`);
    assert.equal(model.classify(), 'agent');
    // Without the recorder the result says so and the tool still writes.
    const unrecorded = await rememberFact({ workspaceDir: dir, scope: 'private', action: 'add', text: '没有记录器时的事实九十' });
    assert.equal(unrecorded.ok && unrecorded.provenance, 'unavailable');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a failing recorder never blocks the write and a failed write rolls provenance back', async () => {
  const dir = await workspace();
  try {
    const broken: ProvenanceMarker = async () => { throw new Error('store down'); };
    const ok = await rememberFact({ workspaceDir: dir, scope: 'private', action: 'add', text: '记录器故障也要写入', markProvenance: broken });
    assert.equal(ok.ok && ok.provenance, 'unavailable');
    let rolledBack = false;
    const marker: ProvenanceMarker = async () => async () => { rolledBack = true; };
    await assert.rejects(rememberFact({ workspaceDir: join(dir, 'missing-dir'), scope: 'private', action: 'add', text: '目录不存在', markProvenance: marker }));
    assert.equal(rolledBack, true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
