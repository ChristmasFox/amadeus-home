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

test('stats reply guide carries the full 战报 shape the agent must retell', async () => {
  const { STATS_REPLY_GUIDE } = await import('../src/reply-guides.js');
  for (const part of ['🏆', '🥇', '• **出战', '• 个人数据：', '• AI 锐评：', '团队合计：', '🔗', '不得编造数字']) {
    assert.ok(STATS_REPLY_GUIDE.includes(part), part);
  }
});

test('every kind of PUBG answer gets the matching reply guide, and failures get an honest one', async () => {
  const guides = await import('../src/reply-guides.js');
  const base = { dataUpdatedAt: '2026-10-19T15:50:00.000Z', evidenceRefs: [] };
  const stats = { ...base, type: 'pubg_stats', status: 'ok', headline: 'x', operation: 'report', groupBy: 'player', summary: 'x', rows: [{ label: 'a', values: {}, evidenceRefs: [] }] } as never;
  assert.equal(guides.replyGuideFor(stats), guides.STATS_REPLY_GUIDE);
  assert.equal(guides.replyGuideFor({ ...base, type: 'pubg_team_damage', status: 'ok', directions: [] } as never), guides.TEAM_DAMAGE_REPLY_GUIDE);
  assert.equal(guides.replyGuideFor({ ...base, type: 'pubg_match_list', status: 'ok', matches: [] } as never), guides.MATCH_LIST_REPLY_GUIDE);
  assert.equal(guides.replyGuideFor({ ...base, type: 'pubg_comparison', status: 'ok' } as never), guides.GENERAL_REPLY_GUIDE);
  assert.match(guides.replyGuideFor({ ...base, type: 'pubg_team_damage', status: 'partial', directions: [] } as never) ?? '', /未知不是 0/u);
  assert.equal(guides.replyGuideFor({ ...base, type: 'pubg_stats', status: 'no_matches', rows: [] } as never), guides.NO_MATCHES_REPLY_GUIDE);
  assert.equal(guides.replyGuideFor({ ...base, type: 'pubg_status', status: 'error' } as never), guides.ERROR_REPLY_GUIDE);
  assert.equal(guides.replyGuideFor({ ...base, type: 'pubg_status', status: 'ok' } as never), undefined);
  assert.match(guides.TEAM_DAMAGE_REPLY_GUIDE, /名场面[\s\S]*清白名单/u);
});
