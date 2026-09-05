import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ActionEngine,
  AuditLogger,
  AuthorizationCore,
  ContextManager,
  DiagnosticEngine,
  HostCollector,
  RuntimeExecutorManager,
  ServiceRegistry,
  type CommandExecution,
  type CommandExecutor,
  type CommandSpec,
} from '@agent/homehub-domain';
import { HomeHubEntry } from '../src/homehub/entry/homehub-entry.js';
import { HomeHubRuntime } from '../src/runtime/homehub-runtime.js';
import { IdentityRegistry } from '../src/platform/core/identity.js';
import { TelegramAdapter } from '../src/platform/telegram/adapter.js';
import { KookAdapter } from '../src/platform/kook/adapter.js';
import { MediaOperations } from '../src/homehub/operations/media-operations.js';

function execution(overrides: Partial<CommandExecution> = {}): CommandExecution {
  return {
    ok: true,
    executorAvailable: true,
    stdout: '',
    stderr: '',
    exitCode: 0,
    ...overrides,
  };
}

class ScriptedExecutor implements CommandExecutor {
  readonly calls: CommandSpec[] = [];

  constructor(
    readonly kind: CommandExecutor['kind'],
    private readonly handler: (spec: CommandSpec) => CommandExecution,
  ) {}

  async execute(spec: CommandSpec): Promise<CommandExecution> {
    this.calls.push(spec);
    return this.handler(spec);
  }
}

function unavailable(kind: CommandExecutor['kind']): ScriptedExecutor {
  return new ScriptedExecutor(kind, () => execution({
    ok: false,
    executorAvailable: false,
    exitCode: null,
    error: `${kind} executor unavailable`,
  }));
}

function unavailableManager(): RuntimeExecutorManager {
  return new RuntimeExecutorManager({
    executors: {
      docker: unavailable('docker'),
      ubuntu: unavailable('ubuntu'),
      'macos-host': unavailable('macos-host'),
      'langbot-component': unavailable('langbot-component'),
    },
  });
}

function healthyDockerExecutor(): ScriptedExecutor {
  return new ScriptedExecutor('docker', (spec) => {
    const args = [...(spec.args ?? [])];
    if (spec.command === 'docker' && args[0] === 'ps') {
      if (args.some((arg) => arg.includes('{{.Names}}|{{.State}}|{{.Status}}'))) {
        return execution({ stdout: 'n8n|running|Up 1 minute\n' });
      }
      return execution({ stdout: 'running\n' });
    }
    if (spec.command === 'curl') return execution({ stdout: '200' });
    if (spec.command === 'docker' && args[0] === 'stats') return execution({ stdout: '0.10%|1.20%\n' });
    if (spec.command === 'docker' && args[0] === 'logs') return execution();
    return execution();
  });
}

function buildEntry(options: {
  identityCore?: AuthorizationCore;
  execution?: RuntimeExecutorManager;
  root: string;
}) {
  const executionManager = options.execution ?? unavailableManager();
  const authorizationCore = options.identityCore ?? new AuthorizationCore();
  const auditLogger = new AuditLogger({ logPath: join(options.root, 'audit') });
  const actionEngine = new ActionEngine({
    execution: executionManager,
    authorizationCore,
    verificationDelayMs: 0,
  });
  const diagnosticEngine = new DiagnosticEngine({ execution: executionManager });
  const entry = new HomeHubEntry({
    contextManager: new ContextManager({ persistPath: join(options.root, 'contexts') }),
    diagnosticEngine,
    actionEngine,
    auditLogger,
    authorizationCore,
    mediaOperations: new MediaOperations({
      downloadsPaths: [join(options.root, 'downloads')],
      libraryPaths: { movies: join(options.root, 'movies'), tv: join(options.root, 'tv') },
      backupPath: join(options.root, 'backups'),
    }),
  });
  return { entry, auditLogger, actionEngine, diagnosticEngine };
}

test('AuthorizationCore defaults to PUBLIC deny and applies shared role policy', () => {
  const registry = new ServiceRegistry();
  const redis = registry.getService('redis')!;
  const emby = registry.getService('emby')!;
  const core = new AuthorizationCore([{
    internalUserId: 'arthur',
    roles: ['ADMIN'],
    identities: { telegram: ['tg-admin'], kook: ['kook-admin'] },
  }, {
    internalUserId: 'trusted-user',
    roles: ['TRUSTED'],
    identities: { kook: ['kook-trusted'] },
  }]);

  const publicIdentity = core.resolve({ platform: 'kook', platformUserId: 'ordinary' });
  const trustedIdentity = core.resolve({ platform: 'kook', platformUserId: 'kook-trusted' });
  const adminIdentity = core.resolve({ platform: 'kook', platformUserId: 'kook-admin' });

  assert.equal(publicIdentity.role, 'PUBLIC');
  assert.equal(core.authorize({ identity: publicIdentity, action: 'restart', service: redis }).authorized, false);
  assert.equal(core.authorize({ identity: publicIdentity, action: 'organize_media', service: emby }).authorized, false);

  const trustedRestart = core.authorize({ identity: trustedIdentity, action: 'restart', service: redis });
  assert.equal(trustedRestart.authorized, false);
  assert.equal(trustedRestart.requiresConfirmation, true);
  const trustedOrganize = core.authorize({ identity: trustedIdentity, action: 'organize_media', service: emby });
  assert.equal(trustedOrganize.requiresConfirmation, true);

  const adminPending = core.authorize({ identity: adminIdentity, action: 'restart', service: redis });
  assert.equal(adminPending.requiresConfirmation, true);
  assert.equal(core.authorize({ identity: adminIdentity, action: 'restart', service: redis, confirmed: true }).authorized, true);

  const noPolicy = new AuthorizationCore().resolve({ platform: 'telegram', platformUserId: 'not-configured' });
  assert.equal(new AuthorizationCore().authorize({ identity: noPolicy, action: 'restart', service: redis }).authorized, false);
});

test('runtime authorization uses Telegram from.id and KOOK author_id, not names', () => {
  const registry = new IdentityRegistry([{
    internalUserId: 'arthur',
    roles: ['ADMIN'],
    identities: { telegram: ['telegram-admin'], kook: ['kook-admin'] },
  }]);
  const runtime = new HomeHubRuntime({
    identityRegistry: registry,
    auditLogPath: '/tmp/homehub-v1-security-runtime-audit',
    contextPath: '/tmp/homehub-v1-security-runtime-contexts',
  });
  try {
    const telegram = new TelegramAdapter().normalize({
      message: {
        message_id: 1,
        from: { id: 'telegram-admin', first_name: 'Same Name' },
        chat: { id: -100, type: 'group', title: 'HomeHub' },
        text: '重启 Redis',
      },
    });
    const telegramDecision = runtime.authorize({ text: telegram.message.text, message: telegram }, 'redis', 'restart');
    assert.equal(telegramDecision.role, 'ADMIN');
    assert.equal(telegramDecision.internalUser, 'arthur');

    const kook = new KookAdapter().normalize({
      channel_type: 'GROUP',
      target_id: 'kook-chat',
      author_id: 'kook-admin',
      sender_name: 'Same Name',
      content: '重启 Redis',
    });
    const kookDecision = runtime.authorize({ text: kook.message.text, message: kook }, 'redis', 'restart');
    assert.equal(kookDecision.role, 'ADMIN');

    const impersonator = new TelegramAdapter().normalize({
      message: {
        message_id: 2,
        from: { id: 'not-admin', first_name: 'Same Name' },
        chat: { id: -100, type: 'group', title: 'HomeHub' },
        text: '重启 Redis',
      },
    });
    const impersonatorDecision = runtime.authorize({ text: impersonator.message.text, message: impersonator }, 'redis', 'restart');
    assert.equal(impersonatorDecision.role, 'PUBLIC');
    assert.equal(impersonatorDecision.authorized, false);
  } finally {
    runtime.stop();
  }
});

test('HomeHub entry permits public status but denies public restart and organize', async () => {
  const root = await mkdtemp(join(tmpdir(), 'homehub-security-public-'));
  const { entry, auditLogger } = buildEntry({ root });
  try {
    const status = await entry.handleRequest('服务器状态', 'kook', 'ordinary-user', 'group-1');
    assert.equal(status.success, true);
    assert.equal(status.responseType, 'status');

    const restart = await entry.handleRequest('重启 Redis', 'kook', 'ordinary-user', 'group-1');
    assert.equal(restart.success, false);
    assert.match(restart.message, /PUBLIC|无权|allowlist|允许/u);

    const organize = await entry.handleRequest('请整理 "Example Movie 2024"', 'kook', 'ordinary-user', 'group-1');
    assert.equal(organize.success, false);
    assert.match(organize.message, /PUBLIC|无权|allowlist|允许/u);

    const audit = await auditLogger.getRecentAuditLogs(10);
    assert.equal(audit.length >= 2, true);
    for (const auditEntry of audit.slice(0, 2)) {
      assert.equal(auditEntry.platform, 'kook');
      assert.equal(auditEntry.platformUserId, 'ordinary-user');
      assert.equal(auditEntry.internalUser, null);
      assert.equal(auditEntry.role, 'PUBLIC');
      assert.equal(auditEntry.chatId, 'group-1');
      assert.equal(auditEntry.authorized, false);
      assert.equal(auditEntry.denied, true);
      assert.ok(auditEntry.action);
      assert.ok(auditEntry.timestamp);
    }
  } finally {
    auditLogger.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test('pending action is bound to platform, chat, user and action ID', async () => {
  const root = await mkdtemp(join(tmpdir(), 'homehub-security-confirm-'));
  const docker = healthyDockerExecutor();
  const manager = new RuntimeExecutorManager({
    executors: { docker, ubuntu: unavailable('ubuntu'), 'macos-host': unavailable('macos-host') },
  });
  const core = new AuthorizationCore([{
    internalUserId: 'arthur',
    roles: ['ADMIN'],
    identities: { kook: ['admin-user'] },
  }]);
  const { entry, auditLogger } = buildEntry({ root, identityCore: core, execution: manager });
  try {
    const prompt = await entry.handleRequest('重启 Redis', 'kook', 'admin-user', 'shared-chat');
    assert.equal(prompt.requiresConfirmation, true);
    const pending = entry['contextManager'].getContextRecord('homehub:kook:shared-chat')?.pendingAction;
    assert.equal(pending?.platform, 'kook');
    assert.equal(pending?.chatId, 'shared-chat');
    assert.equal(pending?.platformUserId, 'admin-user');
    assert.ok(pending?.actionId);

    const foreignConfirmation = await entry.handleRequest('确认', 'kook', 'ordinary-user', 'shared-chat');
    assert.equal(foreignConfirmation.success, false);
    assert.match(foreignConfirmation.message, /其他用户|无权|绑定/u);
    assert.equal(docker.calls.some((call) => call.command === 'docker' && call.args?.[0] === 'compose'), false);

    const confirmed = await entry.handleRequest('确认', 'kook', 'admin-user', 'shared-chat');
    assert.equal(confirmed.success, true);
    assert.equal(confirmed.responseType, 'action');
    assert.equal(docker.calls.some((call) => call.command === 'docker' && call.args?.[0] === 'compose'), true);
  } finally {
    auditLogger.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test('Docker health states distinguish healthy, stopped, unhealthy and executor failure', async () => {
  const registry = new ServiceRegistry();
  const n8n = registry.getService('n8n')!;

  const healthy = healthyDockerExecutor();
  const healthyEngine = new DiagnosticEngine({
    serviceRegistry: registry,
    execution: new RuntimeExecutorManager({ executors: { docker: healthy } }),
  });
  assert.equal((await healthyEngine.checkServiceHealth(n8n)).status, 'healthy');

  const stopped = new ScriptedExecutor('docker', (spec) => {
    if (spec.command === 'docker' && spec.args?.[0] === 'ps') return execution({ stdout: 'n8n|exited|Exited (0) 1 minute ago\n' });
    return execution();
  });
  const stoppedEngine = new DiagnosticEngine({
    serviceRegistry: registry,
    execution: new RuntimeExecutorManager({ executors: { docker: stopped } }),
  });
  assert.equal((await stoppedEngine.checkServiceHealth(n8n)).status, 'down');

  const unhealthy = new ScriptedExecutor('docker', (spec) => {
    if (spec.command === 'docker' && spec.args?.[0] === 'ps') return execution({ stdout: 'n8n|running|Up 1 minute\n' });
    if (spec.command === 'curl') return execution({ stdout: '500' });
    if (spec.command === 'docker' && spec.args?.[0] === 'stats') return execution({ stdout: '0.10%|1.20%\n' });
    return execution();
  });
  const unhealthyEngine = new DiagnosticEngine({
    serviceRegistry: registry,
    execution: new RuntimeExecutorManager({ executors: { docker: unhealthy } }),
  });
  assert.equal((await unhealthyEngine.checkServiceHealth(n8n)).status, 'unhealthy');

  const failedEngine = new DiagnosticEngine({
    serviceRegistry: registry,
    execution: new RuntimeExecutorManager({ executors: { docker: unavailable('docker') } }),
  });
  assert.equal((await failedEngine.checkServiceHealth(n8n)).status, 'unknown');
});

test('executor failure yields UNKNOWN and is excluded from abnormal service count', async () => {
  const engine = new DiagnosticEngine({ execution: unavailableManager() });
  const health = await engine.systemHealth();
  assert.equal(health.summary.totalServices, 13);
  assert.equal(health.summary.unknown, 13);
  assert.equal(health.abnormal.length, 0);
  assert.match(health.diagnosis, /HomeHub Executor unavailable|services status unknown/u);
  assert.doesNotMatch(health.diagnosis, /13.*异常/u);
  assert.equal(health.services.every((service) => service.status === 'unknown'), true);
});

test('macOS host executor unavailable yields UNKNOWN rather than DOWN', async () => {
  const registry = new ServiceRegistry();
  const engine = new DiagnosticEngine({ execution: unavailableManager(), serviceRegistry: registry });
  const cloudflared = await engine.checkServiceHealth(registry.getService('cloudflared')!);
  assert.equal(cloudflared.runtime, 'macos');
  assert.equal(cloudflared.executor, 'macos-host');
  assert.equal(cloudflared.status, 'unknown');
});

test('metrics executor failure returns null instead of zero', async () => {
  const host = await new HostCollector({ execution: unavailableManager() }).collect();
  assert.equal(host.cpu.usage, null);
  assert.equal(host.memory.percentage, null);
  assert.deepEqual(host.disk, []);
  assert.equal(host.uptime, null);
});
