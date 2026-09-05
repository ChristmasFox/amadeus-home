import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
const fixturePath = process.env.PUBG_REAL_MATCH_FIXTURE;
if (!fixturePath) throw new Error('Set PUBG_REAL_MATCH_FIXTURE to a local telemetry fixture.');
const raw = JSON.parse(gunzipSync(readFileSync(fixturePath)).toString('utf8')) as any[];
const cats = new Set<string>();
let count = 0;
for (const e of raw) {
  const infos = [e?.damageInfo, e?.dBNODamageInfo, e?.killerDamageInfo, e?.finishDamageInfo].filter(Boolean);
  for (const i of infos) {
    const c = i?.damageTypeCategory ?? '';
    if (c) cats.add(String(c));
  }
  const c2 = e?.damageTypeCategory ?? '';
  if (c2) cats.add(String(c2));
  if (/electric|shock|stun|taser|zap/i.test(String(c2) + infos.map(i=>i?.damageTypeCategory ?? '').join(' '))) count++;
}
console.log('categories count:', cats.size);
console.log([...cats].sort().join('\n'));
console.log('electric-like:', count);
