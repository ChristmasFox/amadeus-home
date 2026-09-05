import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
const fixturePath = process.env.PUBG_REAL_MATCH_FIXTURE;
if (!fixturePath) throw new Error('Set PUBG_REAL_MATCH_FIXTURE to a local telemetry fixture.');
const raw = JSON.parse(gunzipSync(readFileSync(fixturePath)).toString('utf8')) as any[];
let count = 0;
for (const e of raw) {
  const weapon = String(e?.weapon?.itemId ?? e?.item?.itemId ?? e?.weapon ?? e?.item ?? '');
  const t = String(e?._T ?? '');
  if (!/StunGun|Taser/i.test(weapon)) continue;
  const a = e?.attacker?.name ?? e?.character?.name ?? e?.killer?.name ?? '';
  const v = e?.victim?.name ?? e?.target?.name ?? '';
  const dmgInfo = e?.damageInfo ?? e?.dBNODamageInfo ?? {};
  const item = {
    t,
    weapon,
    attacker: a,
    victim: v,
    dmg: e?.damage ?? dmgInfo?.damage,
    cat: dmgInfo?.damageTypeCategory ?? e?.damageTypeCategory,
    attackId: e?.attackId ?? dmgInfo?.attackId,
    time: e?._D,
  };
  console.log(JSON.stringify(item));
  count++;
}
console.log('stun total', count);
