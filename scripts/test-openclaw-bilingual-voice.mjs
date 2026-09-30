#!/usr/bin/env node
import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
const skill=await readFile(new URL('../plugins/amadeus/skills/voice-reply/SKILL.md',import.meta.url),'utf8');
for(const phrase of ['DeliveryEnvelope v2','spoken audio MUST be Japanese','verified inbound WhatsApp voice lease','one faithful, concise Chinese sentence','For typed input that does not explicitly request voice output']) assert.ok(skill.includes(phrase),phrase);
assert.ok(skill.includes('"kind": "voice"'));assert.ok(skill.includes('"version": 2'));assert.equal(skill.includes('[[tts:'),false);
console.log('DELIVERY_V2_BILINGUAL_SKILL=passed');
