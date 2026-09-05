import { DEFAULT_TEAM } from './src/config/team.js';
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
const fixturePath = process.env.PUBG_REAL_MATCH_FIXTURE;
if (fixturePath && existsSync(fixturePath)) {
  // try match 9f68b411 (Desert last match, #9), load its telemetry from cache isn't raw; inspect raw fixture if exists
  console.log('fixture exists');
}
const files = fixturePath ? [fixturePath] : [];
if (!files.length) {
  console.log('Set PUBG_REAL_MATCH_FIXTURE to inspect a local telemetry fixture.');
}
for (const f of files) {
  if (!existsSync(f)) continue;
  const raw = JSON.parse(gunzipSync(readFileSync(f)).toString('utf8')) as any[];
  console.log('fixture event count:', raw.length);
}
