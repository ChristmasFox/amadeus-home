import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractReactTag, normalizeReactEmoji, RunReactions, reactAfterDelivery, runReactions, stripReactFromEnvelope } from '../src/whatsapp-react.js';
import { createTextDelivery } from '../src/delivery-envelope.js';

test('trailing tag is parsed and stripped', () => {
  assert.deepEqual(extractReactTag('笑什么啊笨蛋 [react:😂]'), { text: '笑什么啊笨蛋', emoji: '😂' });
  assert.deepEqual(extractReactTag('好\n\n[react: 🙄 ]'), { text: '好', emoji: '🙄' });
  assert.deepEqual(extractReactTag('ok [REACT：👍]'), { text: 'ok', emoji: '👍' });
  assert.deepEqual(extractReactTag('🤦‍♀️ 真是的 [react:🤦‍♀️]'), { text: '🤦‍♀️ 真是的', emoji: '🤦‍♀️' });
});
test('no tag leaves text untouched', () => {
  assert.deepEqual(extractReactTag('普通回复 [链接]'), { text: '普通回复 [链接]' });
});
test('invalid emoji is stripped but not used', () => {
  assert.deepEqual(extractReactTag('hi [react:thumbsup]'), { text: 'hi' });
  assert.equal(normalizeReactEmoji('<script>'), undefined);
  assert.equal(normalizeReactEmoji('❤️'), '❤️');
});
test('last valid tag wins and mid-text tags are removed', () => {
  assert.deepEqual(extractReactTag('a [react:👍] b [react:😮]'), { text: 'a b', emoji: '😮' });
});
test('envelope text parts are stripped', () => {
  const env = createTextDelivery({ runId: 'r', sessionKey: 's', channel: 'whatsapp', origin: 'external_user' } as never, '在啊 [react:🙄]');
  const out = stripReactFromEnvelope(env);
  assert.equal(out.emoji, '🙄');
  assert.equal((out.envelope.parts[0] as { text: string }).text, '在啊');
  assert.equal(stripReactFromEnvelope(out.envelope).envelope, out.envelope, 'idempotent');
});
test('store reacts once and expires', async () => {
  let t = 0; const store = new RunReactions(1000, () => t);
  store.set('r', '👍'); assert.equal(store.take('r'), '👍'); assert.equal(store.take('r'), undefined);
  store.set('x', '👍'); t = 5000; assert.equal(store.take('x'), undefined);
  const sent: string[] = []; const logs: string[] = [];
  const log = { info: (m: string) => logs.push(m), warn: (m: string) => logs.push(m) };
  runReactions.set('run', '😂');
  await reactAfterDelivery('run', async (e) => { sent.push(e); }, log);
  await reactAfterDelivery('run', async (e) => { sent.push(e); }, log);
  assert.deepEqual(sent, ['😂']);
  runReactions.set('bad', '😂');
  await assert.doesNotReject(reactAfterDelivery('bad', async () => { throw new Error('boom'); }, log));
  assert.match(logs.at(-1)!, /react_failed/u);
});
