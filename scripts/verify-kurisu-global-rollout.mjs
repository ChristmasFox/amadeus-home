import { readFileSync } from 'node:fs';

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

const legacyManifests = [
  'integrations/langbot/plugins/pubg-stats-v3/manifest.yaml',
  'integrations/langbot/plugins/product-radar/manifest.yaml',
];

for (const path of legacyManifests) {
  const manifest = read(path);
  if (/^\s*EventListener\s*:/mu.test(manifest)) {
    throw new Error(`${path} still registers a natural-language EventListener`);
  }
  if (!/^\s*Command\s*:/mu.test(manifest)) {
    throw new Error(`${path} must retain deterministic protocol commands`);
  }
}

const gatewayManifest = read('integrations/langbot/plugins/kurisu-gateway/manifest.yaml');
if (/^\s*EventListener\s*:/mu.test(gatewayManifest) || !/^\s*Tool\s*:/mu.test(gatewayManifest)) {
  throw new Error('kurisu-gateway must expose tools only and never register a natural-language listener');
}

console.log('KURISU_GLOBAL_ROLLOUT_PASS');
