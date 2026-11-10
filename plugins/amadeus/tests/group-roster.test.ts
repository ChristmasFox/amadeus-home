import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import { GROUP_VOICE_ANCHOR, groupIdFromSessionKey, registerGroupRoster, renderGroupRoster } from '../src/group-roster.js';

const GROUP = '120363000000000000@g.us';
const SESSION = `agent:main:whatsapp:group:${GROUP}:thread:whatsapp-account-secondary`;

test('only a WhatsApp group session has a group id', () => {
  assert.equal(groupIdFromSessionKey(SESSION), GROUP);
  assert.equal(groupIdFromSessionKey(`agent:main:whatsapp:group:${GROUP}`), GROUP);
  assert.equal(groupIdFromSessionKey('agent:main:whatsapp:direct:+8613800000000'), undefined);
  assert.equal(groupIdFromSessionKey(undefined), undefined);
});

test('the roster names each member, the agreed name, names to avoid and the PUBG account', () => {
  assert.equal(renderGroupRoster([]), undefined);
  const text = renderGroupRoster([{
    personId: 'jiao', displayName: '胶', scope: 'group', scopeId: GROUP, addressAs: '打工战士', avoid: ['常宽'], note: '形象是铃羽',
    externalAccounts: [{ provider: 'pubg', externalId: 'SG_LabmemNo008' }, { provider: 'steam', externalId: 'x' }],
  }])!;
  assert.match(text, /- 胶（PUBG SG_LabmemNo008）：称呼「打工战士」；不要叫：常宽；形象是铃羽/u);
  assert.doesNotMatch(text, /steam/u);
  const rejected = renderGroupRoster([{
    personId: 'ye-zai', displayName: '野仔', scope: 'group', scopeId: GROUP, addressAs: '大爹', avoid: ['野仔', '野种'],
    externalAccounts: [{ provider: 'pubg', externalId: 'kim_kkl' }],
  }])!;
  assert.match(rejected, /- （PUBG kim_kkl）：称呼「大爹」；不要叫：野仔、野种/u);
  assert.doesNotMatch(rejected.replace('不要叫：野仔、野种', ''), /野仔|野种/u);
});

test('every turn of that group gets its roster, even after a reset; other conversations get nothing', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'roster-'));
  const presets = join(directory, 'presets.json');
  await writeFile(presets, JSON.stringify({ persons: [
    { personId: 'hou', displayName: '猴', externalAccounts: [{ provider: 'pubg', externalId: 'SG_LabmemNo004' }], addressing: [{ scope: 'group', scopeId: GROUP, addressAs: '变态猴' }] },
  ] }));
  const hooks: Array<(event: unknown, context: unknown) => unknown> = [];
  registerGroupRoster({
    pluginConfig: { identityDatabasePath: join(directory, 'identity.sqlite'), identityPresetsFile: presets },
    logger: { info() {}, warn() {} },
    on: (name: string, handler: (event: unknown, context: unknown) => unknown) => { if (name === 'before_prompt_build') hooks.push(handler); },
  } as unknown as OpenClawPluginApi);
  try {
    const turn = (sessionKey: string) => hooks[0]!({}, { sessionKey }) as { appendSystemContext?: string } | undefined;
    assert.match(turn(SESSION)?.appendSystemContext ?? '', /称呼「变态猴」/u);
    assert.ok((turn(SESSION)?.appendSystemContext ?? '').endsWith(GROUP_VOICE_ANCHOR));
    // A reset only changes the session id; the key, and so the roster, stays.
    assert.match(turn(SESSION)?.appendSystemContext ?? '', /称呼「变态猴」/u);
    assert.equal(turn('agent:main:whatsapp:group:999@g.us')?.appendSystemContext, GROUP_VOICE_ANCHOR);
    assert.equal(turn('agent:main:whatsapp:direct:+8613800000000'), undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('the local group voice anchor quotes no literal gesture, sign-off or catchphrase', () => {
  for (const phrase of ['双手抱胸', '斜眼', '（双手', 'D-Mail', '辉光管', '理智值', '世界线']) {
    assert.ok(!GROUP_VOICE_ANCHOR.includes(phrase), phrase);
  }
  assert.ok(!/……笨蛋冈部/u.test(GROUP_VOICE_ANCHOR), 'no sign-off example');
  assert.match(GROUP_VOICE_ANCHOR, /最近几条里用过的开头、动作、比喻和收尾方式，这一条就换个说法/u);
  assert.match(GROUP_VOICE_ANCHOR, /replyGuide/u);
  assert.match(GROUP_VOICE_ANCHOR, /工具给出的现成内容.*按工具返回的原样交付/u);
  assert.match(GROUP_VOICE_ANCHOR, /不套模板」只约束你自己说话时的措辞和句式/u);
});

test('the anchor describes natural speech: nicknames over fixed catchphrases, no counting or position rules', () => {
  assert.match(GROUP_VOICE_ANCHOR, /通常直接用昵称/u);
  assert.match(GROUP_VOICE_ANCHOR, /固定叫法和口头禅不是默认套路/u);
  assert.ok(!GROUP_VOICE_ANCHOR.includes('笨蛋冈部'), 'the retired nickname is not named at all');
  assert.match(GROUP_VOICE_ANCHOR, /被叫「助手」「AI助手」时先不高兴地顶回去/u);
  for (const mechanical of ['最多出现一次', '最多一次', '开头和结尾', '每条回复都用', '不要每条']) assert.ok(!GROUP_VOICE_ANCHOR.includes(mechanical), mechanical);
  assert.ok(!/……笨蛋冈部/u.test(GROUP_VOICE_ANCHOR), 'no sign-off example');
});
