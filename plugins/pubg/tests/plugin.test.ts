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
  'pubg_get_period_review',
  'pubg_query_team_damage',
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
  assert.match(statsTool.description, /validated presentation\/displayText/);
  const searchTool = metadata.tools.find((tool) => tool.name === 'pubg_search_matches');
  assert.ok(searchTool);
  assert.match(searchTool.description, /resultSetId/);
  const reviewTool = metadata.tools.find((tool) => tool.name === 'pubg_get_review_facts');
  assert.ok(reviewTool);
  assert.match(reviewTool.description, /fresh search resultSetId/);
  assert.match(reviewTool.description, /validated presentation\/displayText/);
  const periodReviewTool = metadata.tools.find((tool) => tool.name === 'pubg_get_period_review');
  assert.ok(periodReviewTool);
  assert.match(periodReviewTool.description, /fresh search resultSetId/);
  assert.match(periodReviewTool.description, /partial coverage/);
  const teamDamageTool = metadata.tools.find((tool) => tool.name === 'pubg_query_team_damage');
  assert.ok(teamDamageTool);
  assert.match(teamDamageTool.description, /actor\/victim together/);
  const prefetchTool = metadata.tools.find((tool) => tool.name === 'pubg_prefetch_telemetry');
  assert.ok(prefetchTool);
  assert.match(prefetchTool.description, /team=true/);
  const reportTool = metadata.tools.find((tool) => tool.name === 'pubg_telemetry_sync_report');
  assert.ok(reportTool);
  assert.match(reportTool.description, /owner-notification/);
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
  assert.match(skill, /dataUpdatedAtLocal/);
  assert.match(skill, /fromLocal/);
  assert.match(skill, /pubg_query_team_damage/);
  assert.match(skill, /meleeKind/);
  assert.match(skill, /pubg_get_period_review/);
  assert.match(skill, /validated `presentation`/);
});
