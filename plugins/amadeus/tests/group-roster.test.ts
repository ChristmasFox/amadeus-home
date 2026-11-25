import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import { GROUP_VOICE_ANCHOR, groupIdFromSessionKey, registerGroupRoster, renderGroupRoster } from '../src/group-roster.js';

const GROUP = 'EXAMPLE_ADDRESS@g.us';
const SESSION = `agent:main:whatsapp:group:${GROUP}:thread:whatsapp-account-example`;

test('only a WhatsApp group session has a group id', () => {
  assert.equal(groupIdFromSessionKey(SESSION), GROUP);
  assert.equal(groupIdFromSessionKey(`agent:main:whatsapp:group:${GROUP}`), GROUP);
  assert.equal(groupIdFromSessionKey('agent:main:whatsapp:direct:EXAMPLE_ADDRESS'), undefined);
  assert.equal(groupIdFromSessionKey(undefined), undefined);
});

test('the roster maps push and self names to the agreed name and PUBG account', () => {
  assert.equal(renderGroupRoster([]), undefined);
  const text = renderGroupRoster([{
    personId: 'example-person', displayName: 'Example Person', aliases: ['Example Push Name', 'Example Self Name', 'Example Avoided Name'],
    scope: 'group', scopeId: GROUP, addressAs: 'Example Call Name', avoid: ['Example Avoided Name'], note: 'Example note',
    externalAccounts: [{ provider: 'pubg', externalId: 'EXAMPLE_PUBG' }, { provider: 'steam', externalId: 'EXAMPLE_STEAM' }],
  }])!;
  assert.match(text, /WhatsApp 推送名 \/ 自称「Example Push Name \/ Example Self Name \/ Example Person」 = 称呼「Example Call Name」 = PUBG 账号「EXAMPLE_PUBG」/u);
  assert.match(text, /不要叫：Example Avoided Name/u);
  assert.doesNotMatch(text.slice(0, text.indexOf('；不要叫：')), /Example Avoided Name/u);
  assert.doesNotMatch(text, /steam/u);
  const rejected = renderGroupRoster([{
    personId: 'example-person-two', displayName: 'Example Person Two', aliases: ['Example Push Name Two'],
    scope: 'group', scopeId: GROUP, addressAs: 'Example Call Name Two', avoid: ['Example Person Two', 'Example Avoided Name Two'],
    externalAccounts: [{ provider: 'pubg', externalId: 'EXAMPLE_PUBG_TWO' }],
  }])!;
  assert.match(rejected, /不要叫：Example Person Two、Example Avoided Name Two/u);
  assert.doesNotMatch(rejected.slice(0, rejected.indexOf('；不要叫：')), /Example Person Two|Example Avoided Name Two/u);
});

test('every turn of that group gets its roster, even after a reset; other conversations get nothing', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'roster-'));
  const presets = join(directory, 'presets.json');
  await writeFile(presets, JSON.stringify({ persons: [
    { personId: 'example-person', displayName: 'Example Person', aliases: ['Example Push Name', 'Example Self Name'], externalAccounts: [{ provider: 'pubg', externalId: 'EXAMPLE_PUBG' }], addressing: [{ scope: 'group', scopeId: GROUP, addressAs: 'Example Call Name' }] },
  ] }));
  const hooks: Array<(event: unknown, context: unknown) => unknown> = [];
  registerGroupRoster({
    pluginConfig: { identityDatabasePath: join(directory, 'identity.sqlite'), identityPresetsFile: presets },
    logger: { info() {}, warn() {} },
    on: (name: string, handler: (event: unknown, context: unknown) => unknown) => { if (name === 'before_prompt_build') hooks.push(handler); },
  } as unknown as OpenClawPluginApi);
  try {
    const turn = (sessionKey: string) => hooks[0]!({}, { sessionKey }) as { appendSystemContext?: string } | undefined;
    assert.match(turn(SESSION)?.appendSystemContext ?? '', /WhatsApp 推送名 \/ 自称「Example Person \/ Example Push Name \/ Example Self Name」 = 称呼「Example Call Name」 = PUBG 账号「EXAMPLE_PUBG」/u);
    assert.match(turn(SESSION)?.appendSystemContext ?? '', /本轮回答身份问题前，必须调用 identity_resolve/u);
    assert.match(turn(SESSION)?.appendSystemContext ?? '', /本轮回答击杀或战绩前，必须调用适用的 PUBG 工具/u);
    assert.ok((turn(SESSION)?.appendSystemContext ?? '').endsWith(GROUP_VOICE_ANCHOR));
    // A reset only changes the session id; the key, and so the roster, stays.
    assert.match(turn(SESSION)?.appendSystemContext ?? '', /Example Push Name/u);
    assert.match(turn('agent:main:whatsapp:group:EXAMPLE_OTHER_ADDRESS@g.us')?.appendSystemContext ?? '', /identity_resolve/u);
    const direct = turn('agent:main:whatsapp:direct:EXAMPLE_ADDRESS');
    assert.equal(direct, undefined, 'private conversations do not receive the group rule');
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
