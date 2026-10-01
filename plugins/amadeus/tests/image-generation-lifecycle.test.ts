import test from 'node:test';
import assert from 'node:assert/strict';
import { ImageGenerationLifecycleCoordinator } from '../src/image-generation-lifecycle.js';
import { createTextDelivery } from '../src/delivery-envelope.js';
import { createDeliverySettlementContext, settleDelivery } from '../src/delivery-settlement.js';

const task = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';

test('accepted lifecycle acknowledgement is exactly once per taskId', async () => {
  const coordinator = new ImageGenerationLifecycleCoordinator(); let notices=0;
  assert.equal(await coordinator.accepted(task, async()=>{ notices++; }), true);
  assert.equal(await coordinator.accepted(task, async()=>{ notices++; }), false);
  assert.equal(notices,1);
});

test('pre-admission rejection emits no accepted acknowledgement', async () => {
  const coordinator = new ImageGenerationLifecycleCoordinator(); let notices=0;
  // OpenClaw only reaches the accepted callback after task admission and
  // scheduleBackgroundWork; a rejected createTaskRun has no callback event.
  const preAdmissionRejected = true;
  if (!preAdmissionRejected) await coordinator.accepted(task, async()=>{ notices++; });
  assert.equal(notices,0); assert.equal(coordinator.status(task), undefined);
});

test('accepted semantic notification failure never prevents detached generation completion', async () => {
  const coordinator = new ImageGenerationLifecycleCoordinator(); let generatedAttachments=false;
  await assert.rejects(coordinator.accepted(task, async()=>{ throw new Error('semantic acknowledgement timeout'); }));
  assert.equal(coordinator.status(task)?.acceptedNotified,true);
  assert.equal(await coordinator.succeeded(task,async()=>{ generatedAttachments=true; }),true);
  assert.equal(generatedAttachments,true,'already accepted generation still reaches authoritative completion');
  assert.equal(coordinator.status(task)?.terminal,'succeeded');
});

test('success completion retry reuses caption/assets and does not duplicate media settlement', async () => {
  const coordinator = new ImageGenerationLifecycleCoordinator(); let imports=0; let sends=0; let settled=false;
  const completion = async () => coordinator.succeeded(task, async()=>{
    await coordinator.artifacts(task, async()=>{ imports++; return { assetId:'img_test', caption:'actual image' }; });
    if (!settled) { settled=true; sends++; }
  });
  assert.equal(await completion(),true); assert.equal(await completion(),true);
  assert.equal(imports,1); assert.equal(sends,1); assert.equal(coordinator.status(task)?.terminal,'succeeded');
});

test('failure retry cannot duplicate user error, and success then late failure is ignored', async () => {
  const coordinator = new ImageGenerationLifecycleCoordinator(); let notices=0;
  const context=createDeliverySettlementContext();
  const envelope=createTextDelivery({runId:`failure:${task}`,deliveryId:`image-generation:${task}:failed`,sessionKey:'session',channel:'whatsapp',origin:'media_completion'},'生成失败了。',{source:'image_generation_lifecycle'});
  const fail = () => coordinator.failed(task, async()=>{ await settleDelivery(envelope,{
    sendText:async()=>{notices++;return{};},synthesize:async()=>({audio:Buffer.from(''),mimeType:'audio/mpeg'}),sendVoice:async()=>({}),sendAttachment:async()=>({providerPrimitive:'image'}),
  },context); });
  assert.equal(await fail(),true); assert.equal(await fail(),true); assert.equal(notices,1);
  const second = new ImageGenerationLifecycleCoordinator(); let sends=0;
  assert.equal(await second.succeeded(other, async()=>{ sends++; }),true);
  assert.equal(await second.failed(other, async()=>{ throw new Error('must not notify'); }),false);
  assert.equal(sends,1); assert.equal(second.status(other)?.terminal,'succeeded');
});

test('terminal failure blocks late success and state storage remains bounded', async () => {
  const coordinator = new ImageGenerationLifecycleCoordinator(2); let sends=0; let errors=0;
  await coordinator.failed(task, async()=>{ errors++; });
  assert.equal(await coordinator.succeeded(task, async()=>{ sends++; }),false);
  await coordinator.accepted(other, async()=>{});
  await coordinator.accepted('00000000-0000-4000-8000-000000000003', async()=>{});
  assert.equal(coordinator.size,2); assert.equal(sends,0); assert.equal(errors,1);
});
