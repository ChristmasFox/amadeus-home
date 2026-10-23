import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqlitePubgRepository } from '@rine-kit/pubg-domain';
import { RawTelemetryArchive } from '@rine-kit/pubg-intelligence/archive';
import { highlightMatch, highlightTelemetry } from './fixtures/highlight-fixture.js';
import { startServer } from '../src/server/server.js';

/** Isolated, synthetic archive: three analysed matches, one missing match, and one excluded normal match. */
export async function startHighlightFixture() {
  const root = mkdtempSync(join(tmpdir(), 'pubg-highlights-'));
  const keys = ['PUBG_INTELLIGENCE_DB', 'PUBG_INTELLIGENCE_EXPERIMENT_DB', 'PUBG_TELEMETRY_ARCHIVE_DIR', 'PUBG_INTELLIGENCE_MAP_DIR', 'PUBG_INTELLIGENCE_STATE_DIR', 'PUBG_INTELLIGENCE_ANALYSIS_WORKERS', 'PORT', 'HOST', 'PUBG_INTELLIGENCE_AI_CONFIG_FILE', 'PUBG_INTELLIGENCE_AI_BASE_URL', 'PUBG_INTELLIGENCE_AI_API_KEY', 'PUBG_INTELLIGENCE_PUBLIC_HOST', 'PUBG_INTELLIGENCE_PUBLIC_AUTH_FILE'] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const source = join(root, 'source.sqlite');
  const hash = () => createHash('sha256').update(readFileSync(source)).digest('hex');
  const dates = ['2026-10-19T15:00:00.000Z', '2026-10-19T18:00:00.000Z', '2026-10-20T22:00:00.000Z'];
  const matches = dates.map((date, index) => ({ ...highlightMatch(`highlight-${index + 1}`, date), telemetryUrl: `https://telemetry-cdn.pubg.com/highlight-${index + 1}.json` }));
  const repository = new SqlitePubgRepository(source);
  repository.upsertMatches([...matches, highlightMatch('highlight-missing', '2026-10-20T22:45:00.000Z'), { ...highlightMatch('highlight-normal', '2026-10-20T23:00:00.000Z'), matchType: 'official', isCompetitive: false }]);
  repository.close();
  const before = hash();
  const archiveDir = join(root, 'archive');
  const archive = new RawTelemetryArchive(archiveDir);
  for (const match of matches) await archive.write(match.matchId, Buffer.from(JSON.stringify(highlightTelemetry(match.createdAt!))));
  const mapDir = join(root, 'maps'); mkdirSync(mapDir);
  writeFileSync(join(mapDir, 'Baltic_Main.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
  Object.assign(process.env, { PUBG_INTELLIGENCE_DB: source, PUBG_INTELLIGENCE_EXPERIMENT_DB: join(root, 'experiments.sqlite'), PUBG_TELEMETRY_ARCHIVE_DIR: archiveDir,
    PUBG_INTELLIGENCE_MAP_DIR: mapDir, PUBG_INTELLIGENCE_STATE_DIR: join(root, 'state'), PUBG_INTELLIGENCE_ANALYSIS_WORKERS: '1', PORT: '0', HOST: '127.0.0.1', PUBG_INTELLIGENCE_AI_CONFIG_FILE: join(root, 'no-ai.json') });
  delete process.env.PUBG_INTELLIGENCE_AI_BASE_URL; delete process.env.PUBG_INTELLIGENCE_AI_API_KEY;
  delete process.env.PUBG_INTELLIGENCE_PUBLIC_HOST; delete process.env.PUBG_INTELLIGENCE_PUBLIC_AUTH_FILE;
  let server: Awaited<ReturnType<typeof startServer>>;
  try { server = await startServer(); }
  catch (error) { for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } rmSync(root, { recursive: true, force: true }); throw error; }
  return { ...server, root, sourceUnchanged: () => before === hash(), close: async () => {
    try { await server.close(); }
    finally { for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } rmSync(root, { recursive: true, force: true }); }
  } };
}
