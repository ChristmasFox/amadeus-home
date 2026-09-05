import { gunzipSync } from 'node:zlib';
import { readFileSync, existsSync } from 'node:fs';
const fixturePath = process.env.PUBG_REAL_MATCH_FIXTURE;
if (!fixturePath) throw new Error('Set PUBG_REAL_MATCH_FIXTURE to a local telemetry fixture.');
const raw = JSON.parse(gunzipSync(readFileSync(fixturePath)).toString('utf8')) as any[];
// 226bb2d9 is the known fixture: find melee punch + vehicle events between the team in THIS fixture
const canonNames = ['SG_LabmemNo004', 'SG_LabmemNo007', 'SG_LabmemNo008', 'kim_kkl'];
let punch = 0, vehicle = 0;
for (const e of raw) {
  const t = String(e?._T ?? '');
  const infos = [e?.damageInfo, e?.dBNODamageInfo, e?.killerDamageInfo, e?.finishDamageInfo].filter(Boolean);
  const a = e?.attacker?.name ?? e?.killer?.name ?? e?.character?.name ?? e?.dBNOMaker?.name ?? '';
  const v = e?.victim?.name ?? e?.target?.name ?? e?.damagedPlayer?.name ?? '';
  const cat = [e?.damageTypeCategory, ...infos.map(i => i?.damageTypeCategory)].filter(Boolean).join(' ');
  const weapon = String(e?.weapon?.itemId ?? e?.damageCauserName ?? infos.map(i=>i?.damageCauserName).find(Boolean) ?? '');
  const isPunch = /Damage_Punch/.test(cat);
  const isVehicleCat = /Damage_Vehicle/.test(cat);
  if (isPunch && canonNames.includes(a) && canonNames.includes(v) && a !== v) {
    console.log('PUNCH', a, '->', v, t, weapon, e?._D);
    punch++;
  }
  if (isVehicleCat && canonNames.includes(a) && canonNames.includes(v) && a !== v) {
    console.log('VEH', a, '->', v, t, weapon, e?._D);
    vehicle++;
  }
}
console.log('punch', punch, 'vehicle', vehicle);
