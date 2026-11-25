import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

function readDirectOnlyNames(filePath) {
  const source = readFileSync(filePath, 'utf8');
  const declaration = source.match(/const DIRECT_ONLY_TOOL_NAMES:\s*ReadonlySet<string>\s*=\s*new Set\(\[([\s\S]*?)\]\);/u);
  assert.ok(declaration, `direct-only tool names are declared in ${filePath}`);
  assert.match(source, /DIRECT_ONLY_TOOL_NAMES\.has\(name\)\s*\?\s*\{\s*catalogMode:\s*'direct-only'/u);
  return [...declaration[1].matchAll(/'([a-z][a-z0-9_]*)'/gu)].map((match) => match[1]);
}

const amadeusDirectNames = readDirectOnlyNames(join(root, 'plugins/amadeus/src/shared/register-tool.ts'));
const pubgDirectNames = readDirectOnlyNames(join(root, 'plugins/pubg/src/index.ts'));
assert.deepEqual([...amadeusDirectNames].sort(), ['identity_resolve', 'steam_get_playtime']);
assert.deepEqual([...pubgDirectNames].sort(), [
  'pubg_get_review_facts',
  'pubg_query_stats',
  'pubg_query_team_damage',
  'pubg_search_matches',
]);

const configExample = JSON.parse(readFileSync(join(root, 'integrations/openclaw/openclaw.json.example'), 'utf8'));
assert.deepEqual(configExample.tools.toolSearch, { enabled: true, mode: 'directory' });
assert.equal(Object.hasOwn(configExample.tools, 'allow'), false);
const deployScript = readFileSync(join(root, 'scripts/deploy-openclaw.sh'), 'utf8');
assert.match(deployScript, /if 'allow' in config\.get\('tools', \{\}\):/u);

const coreEntry = require.resolve('openclaw/plugin-sdk/core', {
  paths: [join(root, 'plugins/amadeus'), join(root, 'plugins/pubg')],
});
const packageRoot = resolve(dirname(coreEntry), '../..');
const distDir = join(packageRoot, 'dist');
const runtimeBundle = readdirSync(distDir).find((name) => /^local-model-lean-[^.]+\.mjs$/u.test(name));
assert.ok(runtimeBundle, 'the pinned OpenClaw runtime exports its directory catalog implementation');
const runtime = await import(pathToFileURL(join(distDir, runtimeBundle)).href);
const applyToolSchemaDirectoryCatalog = runtime.s;
assert.equal(typeof applyToolSchemaDirectoryCatalog, 'function');

const parameters = {
  type: 'object',
  properties: {
    subject: { type: 'string', minLength: 1, description: 'Neutral test subject.' },
    period: { type: 'string', enum: ['today', 'week'] },
    limit: { type: 'integer', minimum: 1, maximum: 8 },
  },
  required: ['subject'],
  additionalProperties: false,
};
const makeTool = (name, extra = {}) => ({
  name,
  label: name,
  description: 'Neutral catalog test tool.',
  parameters,
  async execute(_toolCallId, args) {
    return { name, args };
  },
  ...extra,
});
const directNames = [...amadeusDirectNames, ...pubgDirectNames];
const deferredNames = ['pubg_get_match', 'steam_get_profile', 'amadeus_market_quote'];
const controls = ['tool_search', 'tool_describe', 'tool_call'].map((name) => makeTool(name));
const catalogRef = {};
const result = applyToolSchemaDirectoryCatalog({
  config: { tools: { toolSearch: { enabled: true, mode: 'directory' } } },
  tools: [
    ...controls,
    ...directNames.map((name) => makeTool(name, { catalogMode: 'direct-only' })),
    ...deferredNames.map((name) => makeTool(name)),
  ],
  catalogRef,
});

const initialNames = result.tools.map((tool) => tool.name);
assert.deepEqual(new Set(initialNames), new Set([...controls.map((tool) => tool.name), ...directNames]));
assert.equal(result.catalogToolCount, deferredNames.length);
assert.deepEqual(catalogRef.current.entries.map((entry) => entry.name).sort(), [...deferredNames].sort());

for (const name of directNames) {
  const visibleTool = result.tools.find((tool) => tool.name === name);
  assert.ok(visibleTool, `${name} is in the initial model tool list`);
  assert.equal(visibleTool.parameters, parameters, `${name} retains its complete schema`);
  const called = await visibleTool.execute('neutral-test-call', { subject: 'neutral' });
  assert.deepEqual(called, { name, args: { subject: 'neutral' } });
}

for (const name of deferredNames) {
  assert.equal(initialNames.includes(name), false, `${name} remains behind directory search`);
}

console.log('OPENCLAW_TOOL_SEARCH_CATALOG=passed');
