import { DEFAULT_TIMEZONE, localDateLabel, SqlitePubgRepository } from '@agent/pubg-domain';
import { RawTelemetryArchive } from '@agent/pubg-intelligence/archive';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { realpathSync, statSync } from 'node:fs';
import { startServer } from '../src/server/server.js';

async function main(): Promise<void> {
  const source = process.env.PUBG_INTELLIGENCE_DB?.trim();
  if (!source) throw new Error('PUBG_INTELLIGENCE_DB_REQUIRED_READ_ONLY_SNAPSHOT');
  const sourcePath = realpathSync(source);
  if (!statSync(sourcePath).isFile()) throw new Error('PUBG_INTELLIGENCE_DB_INVALID');
  const archiveDirectory = process.env.PUBG_TELEMETRY_ARCHIVE_DIR?.trim()
    || join(homedir(), '.local', 'share', 'amadeus', 'pubg-telemetry-archive');
  const archive = new RawTelemetryArchive(archiveDirectory);
  const repository = new SqlitePubgRepository(sourcePath, { readOnly: true });
  let matchId: string | undefined;
  try {
    const candidates = repository.listMatches({ limit: 100, order: 'desc' });
    const archivedIds = new Set(await archive.listMatchIds());
    matchId = candidates.find((match) => match.telemetryUrl && archivedIds.has(match.matchId))?.matchId;
  } finally {
    repository.close();
  }
  if (!matchId) throw new Error('real_archive_e2e_no_recent_archived_match');
  const archived = await archive.read(matchId);
  if (!archived || archived.byteLength === 0) throw new Error('real_archive_e2e_archive_integrity_failed');

  const previous = {
    port: process.env.PORT,
    host: process.env.HOST,
    archive: process.env.PUBG_TELEMETRY_ARCHIVE_DIR,
  };
  const originalFetch = globalThis.fetch;
  let cdnRequests = 0;
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    process.env.PORT = '0';
    process.env.HOST = '127.0.0.1';
    process.env.PUBG_TELEMETRY_ARCHIVE_DIR = archiveDirectory;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const target = input instanceof Request ? input.url : String(input);
      if (new URL(target).hostname === 'telemetry-cdn.pubg.com') cdnRequests += 1;
      return originalFetch(input, init);
    }) as typeof fetch;
    server = await startServer();
    const page = await fetch(server.url);
    if (!page.ok) throw new Error('real_archive_e2e_page_failed');
    const selected = repositoryDate(sourcePath, matchId);
    const episodesResponse = await fetch(`${server.url}/api/matches/${encodeURIComponent(matchId)}/episodes?squadId=all&from=${selected}&to=${selected}`);
    if (!episodesResponse.ok) throw new Error('real_archive_e2e_episode_http_failed');
    const episodes = await episodesResponse.json() as { status?: string };
    const passed = episodes.status === 'available' && cdnRequests === 0;
    console.log(JSON.stringify({ pageHttp: page.status, episodeStatus: episodes.status, archivedBytes: archived.byteLength, cdnRequestsDuringReplay: cdnRequests, passed }));
    if (!passed) process.exitCode = 1;
  } finally {
    if (server) await server.close();
    globalThis.fetch = originalFetch;
    if (previous.port === undefined) delete process.env.PORT; else process.env.PORT = previous.port;
    if (previous.host === undefined) delete process.env.HOST; else process.env.HOST = previous.host;
    if (previous.archive === undefined) delete process.env.PUBG_TELEMETRY_ARCHIVE_DIR; else process.env.PUBG_TELEMETRY_ARCHIVE_DIR = previous.archive;
  }
}

function repositoryDate(sourcePath: string, matchId: string): string {
  const repository = new SqlitePubgRepository(sourcePath, { readOnly: true });
  try {
    const match = repository.getMatch(matchId);
    if (!match) throw new Error('real_archive_e2e_match_missing');
    return localDateLabel(match.timestamp, DEFAULT_TIMEZONE);
  } finally {
    repository.close();
  }
}

main().catch(() => {
  console.error('REAL_ARCHIVE_E2E=failed');
  process.exitCode = 1;
});
