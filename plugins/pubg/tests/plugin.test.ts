import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { getToolPluginMetadata } from 'openclaw/plugin-sdk/tool-plugin';
import entry from '../src/index.js';

const EXPECTED_TOOLS = [
  'pubg_resolve_players',
  'pubg_search_matches',
  'pubg_query_stats',
  'pubg_compare_stats',
  'pubg_get_match',
  'pubg_get_review_facts',
];

test('native OpenClaw plugin loads with the pinned SDK and declares only the six PUBG tools', () => {
  const metadata = getToolPluginMetadata(entry);
  assert.ok(metadata);
  assert.equal(metadata.id, 'pubg');
  assert.deepEqual(metadata.tools.map((tool) => tool.name), EXPECTED_TOOLS);
  assert.ok(metadata.tools.every((tool) => tool.parameters.type === 'object'));
  assert.equal(metadata.activation.onStartup, true);
  const statsTool = metadata.tools.find((tool) => tool.name === 'pubg_query_stats');
  assert.ok(statsTool);
  assert.match(statsTool.description, /identity_resolve/);
  assert.match(statsTool.description, /personIds/);
});

test('manifest contracts match runtime metadata and do not carry secret values', () => {
  const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../openclaw.plugin.json', import.meta.url)), 'utf8')) as {
    contracts?: { tools?: string[] };
    configSchema?: { properties?: Record<string, unknown> };
  };
  assert.deepEqual(manifest.contracts?.tools, EXPECTED_TOOLS);
  assert.ok(!JSON.stringify(manifest).match(/(?:api[_-]?key|token|secret)\s*[:=]\s*[^"{}]/iu));
  assert.ok(manifest.configSchema?.properties?.apiKeyFile);
});

test('bundled PUBG skill has the OpenClaw-required frontmatter', () => {
  const skill = readFileSync(fileURLToPath(new URL('../skills/pubg/SKILL.md', import.meta.url)), 'utf8');
  assert.match(skill, /^---\n[\s\S]*^name:\s*pubg\s*$/m);
  assert.match(skill, /^description:\s*"[^"\n]+"\s*$/m);
});
