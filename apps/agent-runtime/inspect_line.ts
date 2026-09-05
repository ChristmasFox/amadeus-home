import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
const fixturePath = process.env.PUBG_REAL_MATCH_FIXTURE;
if (!fixturePath) throw new Error('Set PUBG_REAL_MATCH_FIXTURE to a local telemetry fixture.');
const raw = JSON.parse(gunzipSync(readFileSync(fixturePath)).toString('utf8')) as any[];
// find attack records around teamDamage timestamps 785-817 and melee weapons
const times = new Set<number>();
const hitEvents: any[] = [];
for (const e of raw) {
  const t = e?._T ?? '';
  const ts = e?._D ?? '';
  if (!/LogPlayerAttack|LogPlayerTakeDamage|LogPlayerMakeGroggy|LogPlayerKill|LogPlayerRevive/i.test(t)) continue;
  const sec = new Date(ts).getTime() / 1000 - new Date('2026-09-02T13:10:29Z').getTime() / 1000;
  // print all events with melee/fist weapons or time window 750-830
  const dmg = e?.damageInfo ?? e?.dBNODamageInfo ?? {};
  const weapon = e?.weapon?.itemId ?? dmg?.damageCauser ?? e?.damageCauserName ?? '';
  if (/fist|pan|melee|playerfemale|playermale/i.test(String(weapon)) || (sec > 700 && sec < 840)) {
    const attacker = e?.attacker?.name ?? e?.character?.name ?? e?.killer?.name ?? '';
    const victim = e?.victim?.name ?? e?.target?.name ?? e?.dBNOMaker?.name ?? '';
    const item = { _T: t, s: Math.round(sec*100)/100, attacker, victim, weapon, dmg: e?.damage ?? dmg?.damage, cat: dmg?.damageTypeCategory ?? e?.damageTypeCategory };
    hitEvents.push(item);
  }
}
console.log('interesting count:', hitEvents.length);
for (const h of hitEvents.slice(-120)) console.log(JSON.stringify(h));
