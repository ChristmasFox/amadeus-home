import { readFile } from 'node:fs/promises';
import { verifyInstallation } from '/opt/amadeus/patch-runtime-policy.mjs';
const policy=JSON.parse(await readFile('/opt/amadeus/runtime-policy.json','utf8'));
await verifyInstallation('/usr/local/lib/node_modules/9router',policy);
console.log('LIVE_9ROUTER_POLICY=verified');
