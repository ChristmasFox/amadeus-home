#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const envelopeSource = await readFile(new URL('../plugins/amadeus/src/reply-envelope.ts', import.meta.url), 'utf8');
const plannerSource = await readFile(new URL('../plugins/amadeus/src/reply-planner.ts', import.meta.url), 'utf8');
const deliverySource = await readFile(new URL('../plugins/amadeus/src/reply-delivery.ts', import.meta.url), 'utf8');
for (const token of ['ReplyEnvelope', 'validateReplyEnvelope', 'createSilentEnvelope', 'createTextEnvelope', 'createVoiceEnvelope']) assert.match(envelopeSource, new RegExp(token));
for (const token of ['parseTypedReplyPlan', 'resolveReplyEnvelope']) assert.match(plannerSource, new RegExp(token));
for (const token of ['deliverReplyEnvelope', 'deliveryId', 'final_status']) assert.match(deliverySource, new RegExp(token));
assert.match(envelopeSource, /ReplyModality = 'text' \| 'voice'/u);
assert.match(envelopeSource, /origin: ReplyOrigin/u);
assert.match(envelopeSource, /speechText/u);
assert.match(deliverySource, /context\.settled\.has\(envelope\.deliveryId\)/u);
assert.match(deliverySource, /final_status: 'silent'/u);
assert.match(deliverySource, /final_status: 'text_fallback'/u);
console.log('REPLY_ENVELOPE_POLICY_TEST=passed');
