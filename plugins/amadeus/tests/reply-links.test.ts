import test from 'node:test';
import assert from 'node:assert/strict';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import { createDeliveryEnvelope, createVoiceDelivery } from '../src/delivery-envelope.js';
import { applyReplyLink, trustedReplyLink, turnReplyLink } from '../src/reply-links.js';
import { registerVoiceReplyPrompt } from '../src/voice-reply-prompt.js';
import { DELIVERY_BOUNDARY_GLOBAL, type WhatsAppDeliveryPort } from '../src/delivery-boundary.js';

const ORIGINS = ['https://pubg.example.test'];
const LINK = 'https://pubg.example.test/s/3Xpoo-lXol4pf4Mgy4dpWA';
const FAKE = 'https://pubg.example.test/s/AAAAAAAAAAAAAAAAAAAAAA';
const user = (text: string) => ({ role: 'user', content: text });
const tool = (toolName: string, body: Record<string, unknown>) => ({ role: 'toolResult', toolName, content: [{ type: 'text', text: JSON.stringify(body) }] });
const shared = (url = LINK) => tool('pubg_query_stats', { status: 'ok', displayText: `📊 昨日战绩\n\n🔗 ${url}`, replyLink: { kind: 'share', url } });
const context = { runId: 'run', deliveryId: 'run:delivery', sessionKey: 'group', channel: 'whatsapp', origin: 'external_user' as const };
const text = (value: string) => createDeliveryEnvelope({ ...context, silent: false, source: 'agent_structured_output', parts: [{ kind: 'text', text: value }] });

test('only a share-page link on a configured https origin is trusted', () => {
  assert.equal(trustedReplyLink(LINK, ORIGINS), LINK);
  for (const value of [
    'http://pubg.example.test/s/3Xpoo-lXol4pf4Mgy4dpWA',
    'https://evil.example/s/3Xpoo-lXol4pf4Mgy4dpWA',
    'https://pubg.example.test/api/share/view',
    `${LINK}?x=1`,
    'https://pubg.example.test/s/short',
    42,
  ]) assert.equal(trustedReplyLink(value, ORIGINS), undefined, String(value));
  assert.equal(trustedReplyLink(LINK, []), undefined);
});

test('the turn link comes from the last successful tool result after the latest user message', () => {
  assert.equal(turnReplyLink([user('昨日战绩'), shared()], ORIGINS), LINK);
  assert.equal(turnReplyLink([user('今日战绩'), shared(), user('谁误伤了我'), tool('pubg_query_team_damage', { status: 'ok', displayText: '误伤 2 次' })], ORIGINS), undefined);
  assert.equal(turnReplyLink([user('昨日战绩'), tool('pubg_query_stats', { status: 'error', replyLink: { kind: 'share', url: LINK } })], ORIGINS), undefined);
  assert.equal(turnReplyLink([user('昨日战绩'), shared('https://evil.example/s/3Xpoo-lXol4pf4Mgy4dpWA')], ORIGINS), undefined);
  assert.equal(turnReplyLink([user('昨日战绩'), shared()], []), undefined);
});

test('a retold answer gains the link as its last line, once; invented share links are dropped', () => {
  const restored = applyReplyLink(text('昨天全队 12 局，吃鸡 1 场！'), LINK);
  assert.deepEqual(restored.parts, [{ kind: 'text', text: `昨天全队 12 局，吃鸡 1 场！\n\n🔗 ${LINK}` }]);
  const kept = text(`昨天 12 局\n\n🔗 ${LINK}`);
  assert.equal(applyReplyLink(kept, LINK), kept);
  assert.deepEqual(applyReplyLink(text(`昨天 12 局\n\n🔗 ${FAKE}`), LINK).parts, [{ kind: 'text', text: `昨天 12 局\n\n🔗 ${LINK}` }]);
  assert.deepEqual(applyReplyLink(text(`昨天 12 局，详情见 ${FAKE} 哦\n🔗 ${FAKE}`), undefined).parts, [{ kind: 'text', text: '昨天 12 局，详情见  哦' }]);
  const plain = text('普通聊天 https://example.com/s/page');
  assert.equal(applyReplyLink(plain, undefined), plain);
  const voice = createVoiceDelivery(context, '昨天 12 局', 'きのうは十二戦よ');
  assert.deepEqual(applyReplyLink(voice, LINK).parts.map((part) => part.kind), ['voice', 'text']);
  assert.equal((applyReplyLink(voice, LINK).parts[1] as { text: string }).text, `昨天 12 局\n\n🔗 ${LINK}`);
});

test('reproduced 昨日战绩: the WhatsApp delivery ends a paraphrased answer with the tool link', async () => {
  const hooks = new Map<string, Array<(...args: any[]) => any>>();
  const api = {
    rootDir: new URL('../', import.meta.url).pathname,
    config: {},
    pluginConfig: { replyLinkOrigins: ORIGINS },
    logger: { info() {}, warn() {} },
    on(name: string, handler: (...args: any[]) => any) { hooks.set(name, [...(hooks.get(name) ?? []), handler]); },
  } as unknown as OpenClawPluginApi;
  registerVoiceReplyPrompt(api);
  const boundary = (globalThis as Record<string, unknown>)[DELIVERY_BOUNDARY_GLOBAL] as { createWhatsAppPlan(port: WhatsAppDeliveryPort): any };
  const sent: string[] = [];
  const turn = async (sessionKey: string, messages: unknown[], answer: string) => {
    const plan = boundary.createWhatsAppPlan({
      sessionKey, accountId: 'secondary', conversationId: 'group', messageId: `m-${sessionKey}`, inboundVoice: false,
      sendText: async (value: string) => { sent.push(value); return { messageId: `s-${sessionKey}` }; },
      sendVoice: async () => ({ messageId: 'v' }), sendImage: async () => ({ messageId: 'i' }), sendDocument: async () => ({ messageId: 'd' }),
      start() {}, stop() {},
    });
    const runId = `${sessionKey}-run`;
    plan.replyOptions.onAgentRunStart(runId);
    for (const hook of hooks.get('before_prompt_build') ?? []) hook({}, { runId, sessionKey, channel: 'whatsapp', inputProvenance: { kind: 'external_user' } });
    const wire = JSON.stringify({ version: 2, silent: false, parts: [{ kind: 'text', text: answer }] });
    for (const hook of hooks.get('before_agent_finalize') ?? []) hook({ runId, sessionKey, lastAssistantMessage: wire, messages: [...messages, { role: 'assistant', content: [{ type: 'text', text: wire }] }] }, { sessionKey, trigger: 'user' });
    await plan.delivery.deliver({ text: wire }, { kind: 'final' });
  };
  await turn('links-yesterday', [user('昨日战绩'), shared()], '昨天全队一共 12 局，吃鸡 1 场！');
  await turn('links-friendly-fire', [user('谁误伤了我'), tool('pubg_query_team_damage', { status: 'ok', displayText: '误伤 2 次' })], `你被误伤 2 次\n🔗 ${FAKE}`);
  assert.deepEqual(sent, [`昨天全队一共 12 局，吃鸡 1 场！\n\n🔗 ${LINK}`, '你被误伤 2 次']);
});

test('reply link origins are read as https origins only', async () => {
  const { configFor } = await import('../src/config.js');
  const config = (pluginConfig: Record<string, unknown>) => configFor({ pluginConfig } as unknown as OpenClawPluginApi).replyLinkOrigins;
  assert.deepEqual(config({ replyLinkOrigins: ['https://pubg.example.test/', 'http://plain.example', 'nonsense', 'https://pubg.example.test'] }), ['https://pubg.example.test']);
  assert.deepEqual(config({}), []);
});
