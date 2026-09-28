import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const config = JSON.parse(await readFile(new URL('../experiments/kurisu-ac-emotion-poc/config.json', import.meta.url), 'utf8'));
const expectedIds = ['A0', 'C0', 'C1', 'C2', 'C3', 'C4', 'C5'];
assert.deepEqual(config.samples.map((sample) => sample.id), expectedIds);
assert.equal(config.targetText, 'ねえ、さっきから何度も言ってるでしょう。予定が変わったならちゃんと先に教えてくれればよかったのに、何も知らないまま待たされるこっちの気持ちも少しは考えてよ。それでも、無事に帰ってきたなら今回はもういいから、次からはちゃんと連絡して。');
assert.equal(config.targetText.length, 116);
assert.equal(config.cPath.upstreamRevision, '4988a3fcfa48b8cb5d0780a501b92c6a41401523');
assert.equal(config.cPath.api, 'synthesize_voice_clone_instruct');
assert.equal(config.cPath.modelFamily, 'Qwen3-TTS 12Hz 1.7B Base');
assert.equal(config.cPath.seed, 424242);
assert.equal(config.output.bitrate, '96k');
assert.equal(config.output.normalization, 'none');
assert.equal(config.subjectiveStatus, 'pending_owner_listening');
assert.ok(config.samples.find(({ id }) => id === 'C0').instruct === null);
for (const sample of config.samples.slice(2)) {
  assert.equal(sample.path, 'ominix-base-1.7b-x-vector-instruct');
  assert.equal(typeof sample.instruct, 'string');
}
assert.ok(!JSON.stringify(config).match(/(token|secret|owner_whatsapp|jid|reference\.wav)/iu));
console.log('kurisu-ac-emotion-poc config: PASS');
