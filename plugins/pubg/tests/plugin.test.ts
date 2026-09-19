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
  'pubg_prefetch_telemetry',
  'pubg_telemetry_sync_report',
];

test('native OpenClaw plugin loads with the pinned SDK and declares the PUBG tools', () => {
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
  assert.match(statsTool.description, /reference=self/);
  assert.match(statsTool.description, /team=true only for an explicit whole-team request/);
  assert.match(statsTool.description, /Every new PUBG factual request must call this tool/);
  assert.match(statsTool.description, /persistent SQLite cache/);
  assert.match(statsTool.description, /dataSourceRange/);
  const searchTool = metadata.tools.find((tool) => tool.name === 'pubg_search_matches');
  assert.ok(searchTool);
  assert.match(searchTool.description, /recentN/);
  assert.match(searchTool.description, /refresh=true/);
  assert.match(searchTool.description, /relative_period/);
  assert.match(searchTool.description, /resultSetId/);
  const reviewTool = metadata.tools.find((tool) => tool.name === 'pubg_get_review_facts');
  assert.ok(reviewTool);
  assert.match(reviewTool.description, /current turn/);
  assert.match(reviewTool.description, /stale/);
  assert.match(reviewTool.description, /instead of quoting prior conversation context/);
  assert.match(reviewTool.description, /directional/);
  assert.match(reviewTool.description, /dataSourceRange/);
  const prefetchTool = metadata.tools.find((tool) => tool.name === 'pubg_prefetch_telemetry');
  assert.ok(prefetchTool);
  assert.match(prefetchTool.description, /status=FETCHED/);
  assert.match(prefetchTool.description, /cacheStatus=FETCHED/);
  assert.match(prefetchTool.description, /availability=AVAILABLE/);
  const reportTool = metadata.tools.find((tool) => tool.name === 'pubg_telemetry_sync_report');
  assert.ok(reportTool);
  assert.match(reportTool.description, /Amadeus • D-mail/);
});

test('manifest contracts match runtime metadata and do not carry secret values', () => {
  const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../openclaw.plugin.json', import.meta.url)), 'utf8')) as {
    contracts?: { tools?: string[] };
    configSchema?: { properties?: Record<string, unknown> };
  };
  assert.deepEqual(manifest.contracts?.tools, EXPECTED_TOOLS);
  assert.ok(!JSON.stringify(manifest).match(/(?:api[_-]?key|token|secret)\s*[:=]\s*[^"{}]/iu));
  assert.ok(manifest.configSchema?.properties?.apiKeyFile);
  assert.equal((manifest.configSchema?.properties?.businessDayStart as { default?: unknown } | undefined)?.default, '06:00');
});

test('bundled PUBG skill has the OpenClaw-required frontmatter', () => {
  const skill = readFileSync(fileURLToPath(new URL('../skills/pubg/SKILL.md', import.meta.url)), 'utf8');
  assert.match(skill, /^---\n[\s\S]*^name:\s*pubg\s*$/m);
  assert.match(skill, /^description:\s*"[^"\n]+"\s*$/m);
  assert.match(skill, /最近一局/);
  assert.match(skill, /Every new PUBG factual request must call the relevant native tool/);
  assert.match(skill, /persistent SQLite cache/);
  assert.match(skill, /refresh: true/);
  assert.match(skill, /数据更新时间/);
  assert.match(skill, /数据来源时间范围/);
  assert.match(skill, /反过来呢/);
});
