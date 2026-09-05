import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ServiceRegistry, HomeHubDomain, DiagnosticEngine, ActionEngine, ContextManager, AuditLogger } from '@agent/homehub-domain';
import type { ActionRequest } from '@agent/homehub-domain';
import { classifyPubgRequest } from '../src/runtime/router.js';
import { MediaOperations } from '../src/homehub/operations/media-operations.js';
import { HomeHubEntry } from '../src/homehub/entry/homehub-entry.js';

test('HomeHub ServiceRegistry contains all V1 services with correct definitions', () => {
  const registry = new ServiceRegistry();
  const services = registry.getAllServices();
  assert.equal(services.length, 13);
  const ids = services.map((s) => s.serviceId).sort();
  assert.deepEqual(ids, [
    'aria2', 'cloudflared', 'emby', 'glances', 'jellyfin', 'kook-adapter',
    'langbot', 'mastra-pubg-runtime', 'n8n', 'postgres', 'qbittorrent',
    'redis', 'telegram-adapter',
  ].sort());

  // Risk levels & allowed actions
  const postgres = registry.getService('postgres');
  assert.equal(postgres?.riskLevel, 'high');
  assert.deepEqual(postgres?.allowedActions, ['check']);
  const telegram = registry.getService('telegram-adapter');
  assert.equal(telegram?.riskLevel, 'low');
  assert.ok(telegram?.allowedActions.includes('restart'));
  const n8n = registry.getService('n8n');
  assert.deepEqual(n8n?.dependencies, ['postgres']);
});

test('HomeHub domain parse classifies status/diagnosis/action/history queries', () => {
  const domain = new HomeHubDomain({ userId: 'u1', platform: 'kook' });

  const status = domain.parseQuery('家里服务器怎么样？');
  assert.equal(status.queryType, 'status');

  const diagnosis = domain.parseQuery('Telegram 怎么不回复了？');
  assert.equal(diagnosis.queryType, 'diagnosis');
  assert.equal(diagnosis.serviceId, 'telegram-adapter');

  const action = domain.parseQuery('重启 Telegram');
  assert.equal(action.queryType, 'action');

  const history = domain.parseQuery('看下最近操作记录');
  assert.equal(history.queryType, 'history');

  const media = domain.parseQuery('请整理 "Example Movie 2024"');
  assert.equal(media.queryType, 'media');
});

test('HomeHub diagnostic produces structured checks and issues without guessing', async () => {
  const engine = new DiagnosticEngine({ orbHost: 'ubuntu', orbUser: 'root' });
  // In this sandboxed test environment orb/network are unavailable, so the
  // checks must still be produced deterministically (status failed/skipped).
  const result = await engine.diagnose('telegram-adapter');
  assert.ok(Array.isArray(result.checks));
  assert.ok(result.checks.length >= 1);
  assert.ok(['investigating', 'diagnosed', 'resolved', 'uncertain', 'failed'].includes(result.status));
  for (const check of result.checks) {
    assert.ok(['passed', 'failed', 'skipped'].includes(check.status));
    assert.ok(check.name.length > 0);
    assert.ok(check.timestamp.length > 0);
  }
});

test('HomeHub action engine requires authorization and confirmation for high-risk services', async () => {
  const engine = new ActionEngine({ orbHost: 'ubuntu', orbUser: 'root' });

  // postgres is high risk: dry-run should be pending + manual confirm required
  const request: ActionRequest = {
    serviceId: 'postgres',
    action: 'restart',
    userId: 'u1',
    platform: 'kook',
    dryRun: true,
  };
  const dry = await engine.executeAction(request);
  // Dry run is a preview only; it must be pending/success without touching postgres
  assert.equal(dry.status, 'pending');
  assert.equal(dry.result.success, true);
  assert.match(dry.result.message ?? '', /DRY RUN/);

  // Real restart without confirmation is refused for high-risk postgres
  const real = await engine.executeAction({ ...request, dryRun: false });
  assert.equal(real.status, 'cancelled');
  assert.match(real.result.message, /确认|confirmation/i);
});

test('HomeHub router routes service health questions to homehub and keeps PUBG weather pass', () => {
  // HomeHub status query routes mandatory
  const healthRoute = classifyPubgRequest('家里服务器怎么样？', null);
  assert.equal(healthRoute.domain, 'homehub');
  assert.equal(healthRoute.route, 'mandatory');

  // Specific service diagnosis
  const embyRoute = classifyPubgRequest('Emby 怎么了？', null);
  assert.equal(embyRoute.domain, 'homehub');

  // Telegram polling
  const tgRoute = classifyPubgRequest('Telegram 又挂了', null);
  assert.equal(tgRoute.domain, 'homehub');

  // PUBG must still be mandatory for pubg signals
  const pubgRoute = classifyPubgRequest('昨天战绩', null);
  assert.equal(pubgRoute.domain, 'pubg');
  assert.equal(pubgRoute.route, 'mandatory');

  // Weather remains pass (no homehub capture)
  const weatherRoute = classifyPubgRequest('帮我查天气', null);
  assert.equal(weatherRoute.domain, 'unknown');
  assert.equal(weatherRoute.route, 'pass');
});

test('ContextManager supports active service, diagnosis, pending action follow-up', () => {
  const manager = new ContextManager({ persistPath: '/tmp/homehub-test-contexts' });
  const session = 'session-u1';
  const context = manager.getContext(session, 'u1', 'kook');
  assert.equal(context.activeService, null);

  manager.setLastDiagnosis(session, 'emby', {
    serviceId: 'emby',
    status: 'diagnosed',
    issues: [{ severity: 'error', category: 'process', component: 'emby', message: 'Emby down', actionable: true }],
    checks: [],
    recommendedActions: [{ action: 'restart', reason: 'restart', confidence: 0.9, requiresConfirmation: true }],
    timestamp: new Date().toISOString(),
  });

  const ref = manager.getContextForReference(session);
  assert.equal(ref.activeService, 'emby');
  assert.equal(ref.lastService, 'emby');

  // pending action + confirmation follow-up
  const request: ActionRequest = { serviceId: 'emby', action: 'restart', userId: 'u1', platform: 'kook', dryRun: false };
  manager.setPendingAction(session, request);
  const pending = manager.getPending(session);
  assert.equal(pending.action, 'restart');
  assert.equal(pending.request?.serviceId, 'emby');
});

test('AuditLogger records action entries with verification', async () => {
  const logger = new AuditLogger({ logPath: '/tmp/homehub-test-audit' });
  const result = {
    requestId: 'r1',
    serviceId: 'emby' as const,
    action: 'restart' as const,
    status: 'success' as const,
    result: { success: true, message: 'restarted' },
    verification: { passed: true, checks: [], message: 'ok' },
    timestamp: new Date().toISOString(),
    executedAt: new Date().toISOString(),
    verifiedAt: new Date().toISOString(),
    duration: 100,
  };
  const request: ActionRequest = { serviceId: 'emby', action: 'restart', userId: 'u1', platform: 'kook' };
  await logger.logAction(request, result, true);
  const logs = await logger.getUserAuditLogs('u1');
  assert.equal(logs.length, 1);
  assert.equal(logs[0]?.verificationPassed, true);
  assert.equal(logs[0]?.serviceId, 'emby');
  logger.stop();
});

test('MediaOperations scopes preview and execution to download and library roots', async () => {
  const root = await mkdtemp(join(tmpdir(), 'homehub-media-'));
  const downloads = join(root, 'downloads');
  const source = join(downloads, 'Example.Movie.2024');
  const movies = join(root, 'movies');
  const tv = join(root, 'tv');
  const backups = join(root, 'backups');
  const video = join(source, 'Example.Movie.2024.mkv');

  try {
    await mkdir(source, { recursive: true });
    await writeFile(video, 'test-video');

    const operations = new MediaOperations({
      downloadsPaths: [downloads],
      libraryPaths: { movies, tv },
      backupPath: backups,
    });
    const items = await operations.scanDownloads('Example.Movie.2024');
    assert.equal(items.length, 1);

    const plan = await operations.createOperationPlan(items[0]!);
    const preview = await operations.previewPlan(plan);
    assert.equal(preview.success, true);
    assert.match(preview.message, /准备整理/);

    const result = await operations.executePlan(plan);
    assert.equal(result.success, true);
    assert.equal(result.operationsExecuted, 2);

    const destination = join(movies, 'Example Movie (2024)', 'Example Movie (2024).mkv');
    assert.equal(await readFile(destination, 'utf8'), 'test-video');
    await stat(plan.backupPath);

    await assert.rejects(
      operations.createOperationPlan({ ...items[0]!, sourcePath: join(root, 'outside'), files: [join(root, 'outside.mkv')] }),
      /无法安全处理|不在允许的下载目录/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('HomeHub media entry requires an explicit target and confirmation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'homehub-entry-media-'));
  const downloads = join(root, 'downloads');
  const source = join(downloads, 'Example.Show.S01E01');
  const movies = join(root, 'movies');
  const tv = join(root, 'tv');
  const backups = join(root, 'backups');
  const video = join(source, 'Example.Show.S01E01.mkv');
  const auditLogger = new AuditLogger({ logPath: join(root, 'audit') });

  try {
    await mkdir(source, { recursive: true });
    await writeFile(video, 'episode');
    const entry = new HomeHubEntry({
      contextManager: new ContextManager({ persistPath: join(root, 'contexts') }),
      diagnosticEngine: new DiagnosticEngine({ orbHost: 'ubuntu', orbUser: 'root' }),
      actionEngine: new ActionEngine({ orbHost: 'ubuntu', orbUser: 'root' }),
      auditLogger,
      mediaOperations: new MediaOperations({
        downloadsPaths: [downloads],
        libraryPaths: { movies, tv },
        backupPath: backups,
      }),
    });

    const missingTarget = await entry.handleRequest('请整理下载好了的媒体', 'kook', 'u1', 'sender-1');
    assert.equal(missingTarget.success, false);
    assert.match(missingTarget.message, /明确指定/);

    const preview = await entry.handleRequest('请整理 "Example.Show.S01E01"', 'kook', 'u1', 'sender-1');
    assert.equal(preview.success, true);
    assert.equal(preview.requiresConfirmation, true);
    assert.match(preview.message, /回复「确认」执行/);

    const confirmed = await entry.handleRequest('确认', 'kook', 'u1', 'sender-1');
    assert.equal(confirmed.success, true);
    assert.match(confirmed.message, /已执行/);
    assert.equal(await readFile(join(tv, 'Example Show', 'Season 01', 'Example Show - S01E01.mkv'), 'utf8'), 'episode');
  } finally {
    auditLogger.stop();
    await rm(root, { recursive: true, force: true });
  }
});
