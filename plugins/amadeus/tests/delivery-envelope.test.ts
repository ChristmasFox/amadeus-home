import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeAgentReply, INVALID_STRUCTURED_OUTPUT_MESSAGE } from '../src/delivery-decoder.js';
import { createAttachmentPart, createDeliveryEnvelope, createSilentDelivery, validateDeliveryEnvelope, type DeliveryPart } from '../src/delivery-envelope.js';
import { createDeliverySettlementContext, settleDelivery, type DeliverySettlementAdapters } from '../src/delivery-settlement.js';
import { createWhatsAppAttachmentSender } from '../src/whatsapp-delivery.js';
import { createTelegramAttachmentSender } from '../src/telegram-delivery.js';
import { DeliveryRuns } from '../src/delivery-runs.js';

const context = { runId: 'run-1', deliveryId: 'delivery-1', sessionKey: 'session-1', channel: 'whatsapp', origin: 'external_user' as const };
const wire = (parts: DeliveryPart[], silent = false) => JSON.stringify({ version: 2, silent, parts });
const text: DeliveryPart = { kind: 'text', text: '中文：结论。\n\n日本語：結論です。' };
const voice: DeliveryPart = { kind: 'voice', speechText: '結論です。', emotion: 'soft' };
const attachment = (mimeType: string, disposition: 'inline' | 'document') => createAttachmentPart({ assetId: `img_${'a'.repeat(32)}`, mimeType, fileName: 'image.png', disposition, byteSize: 4, sha256: 'a'.repeat(64) });
const asset = { bytes: Buffer.from('image'), mimeType: 'image/png', fileName: 'image.png', byteSize: 5, sha256: 'a'.repeat(64) };
function adapters(calls: string[]): DeliverySettlementAdapters {
  return { sendText: async (part) => { calls.push(`text:${part.text}`); return {}; }, synthesize: async (input) => { calls.push(`tts:${input.text}`); return { audio: Buffer.from('audio'), mimeType: 'audio/mpeg' }; }, sendVoice: async () => { calls.push('voice'); return {}; }, sendAttachment: async (part) => { calls.push(part.disposition); return { providerPrimitive: part.disposition === 'document' ? 'document' : 'image' }; } };
}

test('strict v2 decoder: text protocol serialization cannot reach text', async () => {
  const envelope = decodeAgentReply(context, wire([text])).envelope; const calls: string[] = [];
  const result = await settleDelivery(envelope, adapters(calls), createDeliverySettlementContext());
  assert.deepEqual(calls, [`text:${text.text}`]); assert.equal(result.final_status, 'sent');
});
test('voice + visible text preserves explicit order without JSON', async () => {
  const calls: string[] = []; const envelope = decodeAgentReply(context, wire([voice, text])).envelope;
  await settleDelivery(envelope, adapters(calls), createDeliverySettlementContext());
  assert.deepEqual(calls, ['tts:結論です。', 'voice', `text:${text.text}`]);
});
test('decoder accepts reordered keys and whitespace, freezes parts', () => {
  const result = decodeAgentReply(context, ` { "parts": [ {"text":"ok", "kind":"text"} ], "silent": false, "version": 2 } `);
  assert.equal(result.status, 'structured'); assert.ok(Object.isFrozen(result.envelope.parts)); assert.ok(Object.isFrozen(result.envelope.parts[0]));
});
test('decoder repairs literal JSON control characters inside text strings', () => {
  const valid = wire([{ kind: 'text', text: 'line one\nline two\twith a tab' }]);
  const malformed = valid.replace(/\\n/gu, '\n').replace(/\\t/gu, '\t');
  const decoded = decodeAgentReply(context, malformed);
  assert.equal(decoded.status, 'structured');
  assert.equal(decoded.envelope.parts[0]?.kind, 'text');
  assert.equal((decoded.envelope.parts[0] as { text: string }).text, 'line one\nline two\twith a tab');
});
test('control-prefixed silent sentinels are suppressed before channel delivery', async () => {
  const rawText = '[[amadeus:reply-modality=default]]\nNO_REPLY';
  for (const raw of [rawText, wire([{ kind: 'text', text: rawText }])]) {
    const decoded = decodeAgentReply(context, raw);
    assert.equal(decoded.status, 'silent');
    assert.equal(decoded.envelope.silent, true);
    const calls: string[] = [];
    await settleDelivery(decoded.envelope, adapters(calls), createDeliverySettlementContext());
    assert.deepEqual(calls, []);
  }
});
test('decoder does not repair control characters outside JSON strings', () => {
  const malformed = `{"version":2,\u0001"silent":false,"parts":[{"kind":"text","text":"ok"}]}`;
  const decoded = decodeAgentReply(context, malformed);
  assert.equal(decoded.status, 'malformed');
  assert.equal(decoded.envelope.silent, false);
  assert.equal(decoded.envelope.fallbackReason, 'invalid_structured_output');
  assert.deepEqual(decoded.envelope.parts, [{ kind: 'text', text: INVALID_STRUCTURED_OUTPUT_MESSAGE }]);
});
for (const [name, raw] of Object.entries({
  truncated: '{"version":2,"parts":', fenced: '```json\n'+wire([text])+'\n```', embedded: 'prefix\n'+wire([text]),
  extra: '{"version":2,"silent":false,"parts":[{"kind":"text","text":"ok"}],"extra":true}',
  missing: '{"version":2,"parts":[{"kind":"text","text":"ok"}]}', old: '{"visibleText":"private","modality":"voice","speechText":"秘密です。"}',
  wrongVersion: '{"version":1,"silent":false,"parts":[{"kind":"text","text":"ok"}]}',
  invalidEmotion: wire([{ ...voice, emotion: 'invented' } as never, text]),
  invalidSpeech: wire([{ ...voice, speechText: '中文' } as never, text]),
  extraPartKey: '{"version":2,"silent":false,"parts":[{"kind":"text","text":"ok","modality":"voice"}]}',
  modelAttachment: wire([attachment('image/png','document')]),
  unstructured: 'ordinary raw answer', silenceContent: wire([text],true),
})) test(`malformed ${name} uses a bounded visible fallback`, async () => {
  const decoded = decodeAgentReply(context, raw); assert.equal(decoded.status, 'malformed');
  assert.equal(decoded.envelope.silent, false);
  assert.equal(decoded.envelope.fallbackReason, 'invalid_structured_output');
  assert.deepEqual(decoded.envelope.parts, [{ kind: 'text', text: INVALID_STRUCTURED_OUTPUT_MESSAGE }]);
  assert.equal(JSON.stringify(decoded.envelope).includes(raw), false);
  const calls: string[] = []; await settleDelivery(decoded.envelope, adapters(calls), createDeliverySettlementContext()); assert.deepEqual(calls, [`text:${INVALID_STRUCTURED_OUTPUT_MESSAGE}`]);
});
test('user-requested JSON, including protocol-looking keys, is normal text inside a part', async () => {
  const requested = '{"visibleText":"user example","modality":"text"}'; const calls: string[] = [];
  const envelope = decodeAgentReply(context, wire([{ kind:'text',text:requested }])).envelope;
  await settleDelivery(envelope, adapters(calls), createDeliverySettlementContext()); assert.deepEqual(calls, [`text:${requested}`]);
});
test('internal origins always silence, inbound voice policy uses the visible fallback', () => {
  for (const origin of ['heartbeat','cron','internal_handoff','system'] as const) assert.equal(decodeAgentReply({ ...context, origin }, wire([voice,text])).envelope.silent,true);
  const decoded = decodeAgentReply({ ...context, origin:'inbound_voice' }, wire([text]));
  assert.equal(decoded.status,'malformed');
  assert.deepEqual(decoded.envelope.parts, [{ kind: 'text', text: INVALID_STRUCTURED_OUTPUT_MESSAGE }]);
});
test('TTS failure uses only typed text fallback, no implicit speech or raw JSON', async () => {
  const calls: string[] = []; const result = await settleDelivery(decodeAgentReply(context,wire([voice,text])).envelope, { ...adapters(calls), synthesize: async () => { throw new Error('private provider detail'); } }, createDeliverySettlementContext());
  assert.deepEqual(calls,[`text:${text.text}`]); assert.equal(result.final_status,'text_fallback'); assert.equal(result.fallback_reason,'tts_failed');
});
test('text/voice/attachment send failures cannot trigger duplicate text or compression fallback', async () => {
  for (const stage of ['text','voice','attachment'] as const) {
    const calls: string[] = []; const env = createDeliveryEnvelope({ ...context,silent:false,source:'tool_result',parts:[voice,text,attachment('image/png','document')] });
    const a = adapters(calls); const result = await settleDelivery(env,{ ...a,
      ...(stage==='text'?{sendText:async()=>{calls.push('text-failed');throw new Error('fail');}}:{}),
      ...(stage==='voice'?{sendVoice:async()=>{calls.push('voice-failed');throw new Error('fail');}}:{}),
      ...(stage==='attachment'?{sendAttachment:async()=>{calls.push('document-failed');throw new Error('fail');}}:{}),
    },createDeliverySettlementContext()); assert.equal(result.final_status,'failed'); assert.equal(result.failure_stage,stage); assert.equal(calls.filter(x=>x.startsWith('text:')).length,stage==='attachment'?1:0);
  }
});
for (const [mimeType, disposition] of [['image/png','document'],['image/jpeg','document'],['image/png','inline']] as const) test(`${mimeType} ${disposition} survives tool -> envelope -> WhatsApp`, async () => {
  const calls: string[]=[]; const part=attachment(mimeType,disposition); const env=createDeliveryEnvelope({ ...context,silent:false,parts:[part],source:'tool_result' });
  const send=createWhatsAppAttachmentSender(async()=>({ ...asset,mimeType }),{sendImage:async()=>{calls.push('image');return{};},sendDocument:async()=>{calls.push('document');return{};}});
  await settleDelivery(env,{...adapters(calls),sendAttachment:send},createDeliverySettlementContext()); assert.deepEqual(calls,[disposition==='document'?'document':'image']);
});
test('document rejection is not downgraded to inline', async () => {
  let imageCalls=0; const send=createWhatsAppAttachmentSender(async()=>asset,{sendImage:async()=>{imageCalls++;return{};},sendDocument:async()=>{throw new Error('rejected');}});
  await assert.rejects(send(attachment('image/png','document'))); assert.equal(imageCalls,0);
});
test('attachment caption preserves Kurisu-selected length while filtering protocol', () => {
  const captioned = createAttachmentPart({ ...attachment('image/png', 'inline'), caption: '  画像\r\nできたわ。  ' });
  assert.equal(captioned.caption, '画像 できたわ。');
  assert.equal(validateDeliveryEnvelope(createDeliveryEnvelope({ ...context, silent:false, source:'tool_result', parts:[captioned] })), true);
  const longCaption = '库瑞斯认真看完这张图后决定把细节说清楚。'.repeat(80);
  const longCaptionPart = createAttachmentPart({ ...attachment('image/png', 'inline'), caption: longCaption });
  assert.equal(longCaptionPart.caption, longCaption);
  assert.throws(() => createAttachmentPart({ ...attachment('image/png', 'inline'), caption: '{"caption":"raw model JSON"}' }), /caption_protocol_rejected/u);
  assert.throws(() => createAttachmentPart({ ...attachment('image/png', 'inline'), caption: '"raw protocol string"' }), /caption_protocol_rejected/u);
  assert.equal(validateDeliveryEnvelope({ ...createDeliveryEnvelope({ ...context, silent:false, source:'tool_result', parts:[captioned] }), parts:[{ ...captioned, filePath:'/tmp/private' }] }), false);
  assert.throws(() => createAttachmentPart({ ...attachment('image/png', 'document'), caption:'must stay a document' }), /invalid_delivery_attachment/u);
});
for (const mimeType of ['image/png', 'image/jpeg']) test(`${mimeType} + caption is one WhatsApp image provider send`, async () => {
  const texts: string[] = []; const provider: Array<{ image:Buffer; mimetype:string; caption?:string }> = [];
  const captionPart = createAttachmentPart({ ...attachment(mimeType, 'inline'), caption:'Kurisu sees the actual generated scene.' });
  const envelope = createDeliveryEnvelope({ ...context, silent:false, source:'tool_result', parts:[captionPart] });
  const send = createWhatsAppAttachmentSender(async () => ({ ...asset, mimeType }), {
    sendImage: async (resolved, caption) => { provider.push({ image:resolved.bytes, mimetype:resolved.mimeType, ...(caption ? { caption } : {}) }); return {}; },
    sendDocument: async () => { throw new Error('document primitive must not be used'); },
  });
  await settleDelivery(envelope, { ...adapters(texts), sendAttachment:send }, createDeliverySettlementContext());
  assert.equal(provider.length, 1);
  assert.deepEqual(provider[0], { image:asset.bytes, mimetype:mimeType, caption:captionPart.caption });
  assert.deepEqual(texts, [], 'successful caption has zero independent text sends');
});
test('Telegram photo/document primitives obey the same disposition without voice regression', async () => {
  const calls:string[]=[]; const send=createTelegramAttachmentSender(async()=>asset,{sendPhoto:async(_asset,caption)=>{calls.push(`photo:${caption ?? ''}`);return{};},sendDocument:async()=>{calls.push('document');return{};}});
  await send(attachment('image/png','document'));await send(createAttachmentPart({...attachment('image/png','inline'),caption:'同じ写真の説明'}));assert.deepEqual(calls,['document','photo:同じ写真の説明']);
});
test('complete-envelope concurrent and repeated idempotency', async () => {
  const calls:string[]=[];const env=createDeliveryEnvelope({...context,silent:false,source:'tool_result',parts:[text,attachment('image/png','document')]});const state=createDeliverySettlementContext();
  const results=await Promise.all([settleDelivery(env,adapters(calls),state),settleDelivery(env,adapters(calls),state)]);await settleDelivery(env,adapters(calls),state);
  assert.deepEqual(calls,[`text:${text.text}`,'document']);assert.equal(results[1]?.final_status,'duplicate');
});
test('run preparation decodes once, waits for registration and deduplicates exact assets', async()=>{
  const runs=new DeliveryRuns();runs.start(context);let resolveJob!:(parts:readonly ReturnType<typeof attachment>[])=>void; const job=new Promise<readonly ReturnType<typeof attachment>[]>(resolve=>{resolveJob=resolve;});runs.addAssets(context.runId,job);
  runs.decode(context.runId,wire([text]));const pending=runs.prepare(context.runId,'raw serialization must not be reconsidered');resolveJob([attachment('image/png','document'),attachment('image/png','document')]);const envelope=await pending;
  assert.deepEqual(envelope.parts,[text,attachment('image/png','document')]);
});
test('image completion fallback reclaims unprepared assets without hijacking the session route', async () => {
  const runs = new DeliveryRuns();
  const completion = attachment('image/png', 'inline');
  runs.registerMediaCompletion({ taskId: 'task-1', sourceSessionKey: 'image_generate:task-1', parts: Promise.resolve([completion]), expiresAt: Date.now() + 60_000 });
  runs.start({ runId: 'native-completion', sessionKey: 'session-1', channel: 'whatsapp', origin: 'media_completion' });
  assert.equal(runs.claimMediaCompletion('native-completion', 'image_generate:task-1'), true);
  runs.start({ runId: 'typed-fallback', sessionKey: 'session-1', channel: 'whatsapp', origin: 'media_completion', deliveryId: 'image-completion:task-1' }, { bindSession: false });
  assert.equal(runs.claimMediaCompletion('typed-fallback', 'image_generate:task-1'), true);
  assert.equal(runs.runIdFor('session-1'), 'native-completion');
  const envelope = await runs.prepareToolOnly('typed-fallback');
  assert.deepEqual(envelope.parts, [completion]);
});
test('silent envelope cannot contain parts or accept v1 contract',()=>{
  const env=createSilentDelivery(context);assert.equal(validateDeliveryEnvelope({...env,version:1}),false);assert.throws(()=>createDeliveryEnvelope({...env,version:1} as never),/invalid_delivery_version/u);assert.equal(validateDeliveryEnvelope({...env,parts:[text]}),false);assert.equal(validateDeliveryEnvelope({...env,silent:false}),false);
});
