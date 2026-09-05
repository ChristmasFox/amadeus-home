import { DEFAULT_TEAM } from './src/config/team.js';
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
const fixturePath = process.env.PUBG_REAL_MATCH_FIXTURE;
const files: [string,string][] = [
  ...(fixturePath ? [[fixturePath, '226bb2d9-a83f-49db-ae85-965fcd9ec302'] as [string, string]] : []),
];
if (!files.length) console.log('Set PUBG_REAL_MATCH_FIXTURE to inspect a local telemetry fixture.');
for (const [fp] of files) {
  if (!existsSync(fp)) { console.log('skip missing', fp); continue; }
  const raw = JSON.parse(gunzipSync(readFileSync(fp)).toString('utf8')) as any[];
  let count = 0;
  for (const e of raw) {
    const t = String(e?._T ?? '');
    if (!/LogPlayerMakeGroggy|LogPlayerKill|LogPlayerTakeDamage|LogVehicleDamage|LogVehicleDestroy/.test(t)) continue;
    const infos = [e?.damageInfo, e?.dBNODamageInfo, e?.killerDamageInfo].filter(Boolean);
    const cat = infos.map(i=>i?.damageTypeCategory ?? '').concat(e?.damageTypeCategory ?? '').join(' ');
    if (!/Damage_Vehicle/.test(cat)) continue;
    const a = e?.attacker?.name ?? e?.killer?.name ?? e?.dBNOMaker?.name ?? '';
    const v = e?.victim?.name ?? e?.target?.name ?? '';
    if (!a || !v) continue;
    console.log(JSON.stringify({t, s:e?._D, a, v, cat, veh:e?.vehicle?.vehicleId ?? e?.vehicle?.id, dmg:e?.damage ?? infos[0]?.damage}));
    count++;
  }
  console.log('vehicle damage events:', count);
}
