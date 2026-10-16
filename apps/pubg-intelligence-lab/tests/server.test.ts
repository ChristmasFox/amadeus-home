import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { SqlitePubgRepository } from '@agent/pubg-domain';
import { startServer } from '../src/server/server.js';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (path: string) => { prepare(sql: string): { get(): { count?: number; question?: string } }; close(): void } };

const fixture = {
  schemaVersion: 3,
  shard: 'steam',
  matchType: 'competitive',
  gameMode: 'squad-fpp',
  isCompetitive: true,
  mapName: 'Erangel',
  duration: 1400,
  patchVersion: 'test',
  players: [
    { accountId: 'private-player-1', playerName: 'Alpha', displayName: 'Alpha', rank: 3, kills: 2, assists: 0, damage: 180, dbnos: 2, revives: 0, headshotKills: 1, survivalTime: 1200, longestKill: 40, deaths: 1, deathSemantics: 'placement_proxy' },
    { accountId: 'private-player-2', playerName: 'Beta', displayName: 'Beta', rank: 3, kills: 1, assists: 1, damage: 90, dbnos: 1, revives: 1, headshotKills: 0, survivalTime: 1200, longestKill: 30, deaths: 1, deathSemantics: 'placement_proxy' },
  ],
};

test('local API serves history and research from a read-only source and stores experiments separately', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pubg-intelligence-app-'));
  const source = join(root, 'source.sqlite');
  const experiments = join(root, 'experiments.sqlite');
  const previous = {
    db: process.env.PUBG_INTELLIGENCE_DB,
    experiment: process.env.PUBG_INTELLIGENCE_EXPERIMENT_DB,
    port: process.env.PORT,
    host: process.env.HOST,
    base: process.env.PUBG_INTELLIGENCE_AI_BASE_URL,
    key: process.env.PUBG_INTELLIGENCE_AI_API_KEY,
    model: process.env.PUBG_INTELLIGENCE_AI_MODEL,
  };
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    const writable = new SqlitePubgRepository(source);
    writable.upsertMatches([
      { ...fixture, matchId: 'app-match-1', createdAt: '2026-10-10T12:00:00.000Z', players: fixture.players },
      { ...fixture, matchId: 'app-match-2', createdAt: '2026-10-12T12:00:00.000Z', players: fixture.players.map((player) => ({ ...player, rank: 7, kills: 1 })) },
    ]);
    writable.close();
    const sourceHash = createHash('sha256').update(readFileSync(source)).digest('hex');

    process.env.PUBG_INTELLIGENCE_DB = source;
    process.env.PUBG_INTELLIGENCE_EXPERIMENT_DB = experiments;
    process.env.PORT = '0';
    process.env.HOST = '127.0.0.1';
    delete process.env.PUBG_INTELLIGENCE_AI_BASE_URL;
    delete process.env.PUBG_INTELLIGENCE_AI_API_KEY;
    delete process.env.PUBG_INTELLIGENCE_AI_MODEL;

    server = await startServer();
    const page = await fetch(server.url).then((response) => response.text());
    assert.match(page, /PUBG Intelligence Lab/u);
    const mainModule = await fetch(`${server.url}/src/client/main.tsx`).then((response) => response.text());
    assert.match(mainModule, /\/node_modules\/\.vite\/deps\/react-dom_client\.js/u);
    assert.match(mainModule, /const createRoot = __vite__cjsImport\d+_reactDom_client\["createRoot"\]/u);
    const bootstrap = await fetch(`${server.url}/api/bootstrap`).then((response) => response.json()) as { matchCount: number; telemetryCachedMatchCount: number; modelEnabled: boolean };
    assert.equal(bootstrap.matchCount, 2);
    assert.equal(bootstrap.telemetryCachedMatchCount, 0);
    assert.equal(bootstrap.modelEnabled, false);

    const matches = await fetch(`${server.url}/api/matches`).then((response) => response.json()) as { total: number; matches: Array<{ matchId: string }> };
    assert.equal(matches.total, 2);
    assert.equal(matches.matches.length, 2);

    const research = await fetch(`${server.url}/api/research`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: '最近比赛平均伤害趋势', from: '2026-10-01', to: '2026-10-31' }),
    }).then((response) => response.json()) as { runId: string; report: { scope: { selectedMatches: number }; answer: string } };
    assert.ok(research.runId);
    assert.equal(research.report.scope.selectedMatches, 2);
    assert.match(research.report.answer, /逐周趋势/u);

    const detail = await fetch(`${server.url}/api/matches/app-match-1`).then((response) => response.json()) as { telemetry: { status: string }; analysis: { summary: string } };
    assert.equal(detail.telemetry.status, 'MISSING');
    assert.ok(detail.analysis.summary.length > 0);
    const experimentDatabase = new DatabaseSync(experiments);
    const mobile = '13' + '8' + '0'.repeat(8);
    const credential = 'sk-' + 'z'.repeat(24);
    const sanitizedResearch = await fetch(`${server.url}/api/research`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: `比较队员伤害，联系人 ${mobile}，api_key=${credential}`, from: '2026-10-01', to: '2026-10-31' }),
    }).then((response) => response.json()) as { runId: string };
    assert.ok(sanitizedResearch.runId);
    const latestQuestion = experimentDatabase.prepare('SELECT question FROM research_runs ORDER BY rowid DESC LIMIT 1').get().question ?? '';
    assert.equal(latestQuestion.includes(mobile), false);
    assert.equal(latestQuestion.includes(credential), false);
    assert.equal(experimentDatabase.prepare('SELECT COUNT(*) AS count FROM research_runs').get().count, 2);
    experimentDatabase.close();
    assert.equal(createHash('sha256').update(readFileSync(source)).digest('hex'), sourceHash);
  } finally {
    if (server) await server.close();
    const restore = (key: string, value: string | undefined) => value === undefined ? delete process.env[key] : process.env[key] = value;
    restore('PUBG_INTELLIGENCE_DB', previous.db);
    restore('PUBG_INTELLIGENCE_EXPERIMENT_DB', previous.experiment);
    restore('PORT', previous.port);
    restore('HOST', previous.host);
    restore('PUBG_INTELLIGENCE_AI_BASE_URL', previous.base);
    restore('PUBG_INTELLIGENCE_AI_API_KEY', previous.key);
    restore('PUBG_INTELLIGENCE_AI_MODEL', previous.model);
    rmSync(root, { recursive: true, force: true });
  }
});
