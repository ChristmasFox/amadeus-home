import assert from 'node:assert/strict';
import { createServer } from 'node:http';
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
  RuntimeExecutorManager,
  ServiceRegistry,
  type CommandExecution,
  type CommandExecutor,
  type CommandSpec,
} from '@agent/homehub-domain';
import { HomeHubEntry } from '../src/homehub/entry/homehub-entry.js';
import { homeHubCallbackData } from '../src/homehub/confirmation.js';
import { HomeHubRuntime } from '../src/runtime/homehub-runtime.js';
import { IdentityRegistry } from '../src/platform/core/identity.js';
import { TelegramAdapter } from '../src/platform/telegram/adapter.js';

function execution(overrides: Partial<CommandExecution> = {}): CommandExecution {
  return { ok: true, executorAvailable: true, stdout: '', stderr: '', exitCode: 0, ...overrides };
}

class FakeDocker implements CommandExecutor {
  readonly kind = 'docker' as const;
  readonly calls: CommandSpec[] = [];
  constructor(private readonly logs = '') {}
  async execute(spec: CommandSpec): Promise<CommandExecution> {
    this.calls.push(spec);
    const args = [...(spec.args ?? [])];
    if (args[0] === 'ps') {
      const filter = args.find((arg) => arg.startsWith('name=^'));
      const target = filter ? filter.replace(/^name=\^|\$$/gu, '') : 'aria2';
      if (args.includes('{{.Names}}|{{.State}}|{{.Status}}')) return execution({ stdout: `${target}|running|Up 1 minute\n` });
      return execution({ stdout: 'running\n' });
    }
    if (args[0] === 'stats') return execution({ stdout: '0.10%|1.20%\n' });
    if (args[0] === 'logs') return execution({ stdout: this.logs });
    if (args[0] === 'restart') return execution({ stdout: 'restarted\n' });
    if (args[0] === 'inspect') return execution();
    return execution();
  }
}

function telegramText(userId: number, chatId: number, text: string) {
  return new TelegramAdapter().normalize({
    message: {
      message_id: Math.floor(Math.random() * 100000),
      date: 1788326400,
      text,
      from: { id: userId, first_name: 'Arthur' },
      chat: { id: chatId, type: chatId < 0 ? 'group' : 'private', ...(chatId < 0 ? { title: 'HomeHub' } : {}) },
    },
  });
}

test('Telegram identity maps one user across private and group chats without trusting a group ID', () => {
  const registry = new IdentityRegistry([{
    internalUserId: 'arthur',
    roles: ['ADMIN'],
    identities: { telegram: ['42'] },
  }]);
  const privateMessage = telegramText(42, 42, '/whoami');
  const groupMessage = telegramText(42, -5527996775, '/whoami');
  const otherMember = telegramText(-5527996775, -5527996775, '/whoami');
  assert.equal(registry.resolve(privateMessage).internalUserId, 'arthur');
  assert.equal(registry.resolve(groupMessage).internalUserId, 'arthur');
  assert.equal(registry.resolve(groupMessage).role, 'ADMIN');
  assert.equal(groupMessage.user.platformUserId, '42');
  assert.equal(groupMessage.chat.id, '-5527996775');
  assert.equal(registry.resolve(otherMember).role, 'PUBLIC');
});

test('HomeHub Telegram confirmation renders buttons and enforces callback ownership/replay', async () => {
  const root = await mkdtemp(join(tmpdir(), 'homehub-v12-buttons-'));
  const docker = new FakeDocker();
  const manager = new RuntimeExecutorManager({ executors: { docker } });
  const identityRegistry = new IdentityRegistry([{
    internalUserId: 'arthur',
    roles: ['ADMIN'],
    identities: { telegram: ['42'] },
  }]);
  const runtime = new HomeHubRuntime({
    identityRegistry,
    executorManager: manager,
    contextPath: join(root, 'contexts'),
    auditLogPath: join(root, 'audit'),
  });
  try {
    const prompt = await runtime.handle({ text: '重启 aria2', message: telegramText(42, -10001, '重启 aria2') });
    assert.equal(prompt.status, 'success');
    assert.equal(prompt.requiresConfirmation, true);
    assert.equal(prompt.messages[0]?.buttons?.length, 2);
    const confirmData = prompt.messages[0]?.buttons?.find((button) => button.text.includes('确认'))?.callbackData;
    assert.ok(confirmData);
    assert.equal(confirmData, homeHubCallbackData('confirm', prompt.pendingActionId!));
    assert.match(confirmData, /^hh1:confirm:/u);
    assert.ok(confirmData.length <= 64);

    const foreign = await runtime.handle({
      text: '',
      message: new TelegramAdapter().normalize({
        callback_query: {
          id: 'foreign-callback',
          data: confirmData,
          from: { id: 99, first_name: 'Member' },
          message: {
            message_id: 2,
            text: '确认执行',
            from: { id: 999, first_name: 'Bot' },
            chat: { id: -10001, type: 'group', title: 'HomeHub' },
          },
        },
      }),
    });
    assert.equal(foreign.status, 'error');
    assert.match(foreign.response, /其他用户|无权|绑定/u);
    assert.equal(docker.calls.some((call) => call.args?.[0] === 'restart'), false);

    const owner = await runtime.handle({
      text: '',
      message: new TelegramAdapter().normalize({
        callback_query: {
          id: 'owner-callback',
          data: confirmData,
          from: { id: 42, first_name: 'Arthur' },
          message: {
            message_id: 2,
            text: '确认执行',
            from: { id: 999, first_name: 'Bot' },
            chat: { id: -10001, type: 'group', title: 'HomeHub' },
          },
        },
      }),
    });
    assert.equal(owner.responseType, 'action');
    assert.equal(docker.calls.some((call) => call.args?.[0] === 'restart' && call.args?.[1] === 'aria2'), true);

    const replay = await runtime.handle({
      text: '',
      message: new TelegramAdapter().normalize({
        callback_query: {
          id: 'replay-callback', data: confirmData, from: { id: 42 },
          message: { message_id: 2, text: '确认执行', from: { id: 999 }, chat: { id: -10001, type: 'group' } },
        },
      }),
    });
    assert.match(replay.response, /没有待确认|已处理|重复/u);
    assert.equal(docker.calls.filter((call) => call.args?.[0] === 'restart').length, 1);
  } finally {
    runtime.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test('HomeHub text confirmation fallback executes the unique pending action', async () => {
  const root = await mkdtemp(join(tmpdir(), 'homehub-v12-text-confirm-'));
  const docker = new FakeDocker();
  const identityRegistry = new IdentityRegistry([{
    internalUserId: 'arthur', roles: ['ADMIN'], identities: { telegram: ['42'] },
  }]);
  const runtime = new HomeHubRuntime({
    identityRegistry,
    executorManager: new RuntimeExecutorManager({ executors: { docker } }),
    contextPath: join(root, 'contexts'),
    auditLogPath: join(root, 'audit'),
  });
  try {
    const prompt = await runtime.handle({ text: '重启 aria2', message: telegramText(42, 42, '重启 aria2') });
    assert.equal(prompt.requiresConfirmation, true);
    const confirmation = await runtime.handle({ text: '确认', message: telegramText(42, 42, '确认') });
    assert.equal(confirmation.status, 'success');
    assert.equal(confirmation.responseType, 'action');
    assert.equal(docker.calls.some((call) => call.args?.[0] === 'restart' && call.args?.[1] === 'aria2'), true);
  } finally {
    runtime.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test('pending confirmation expires before execution', async () => {
  const root = await mkdtemp(join(tmpdir(), 'homehub-v12-expiry-'));
  const docker = new FakeDocker();
  const registry = new ServiceRegistry();
  const core = new AuthorizationCore([{ internalUserId: 'arthur', roles: ['ADMIN'], identities: { kook: ['42'] } }]);
  const audit = new AuditLogger({ logPath: join(root, 'audit') });
  const context = new ContextManager({ persistPath: join(root, 'contexts'), pendingActionTtl: 1 });
  const entry = new HomeHubEntry({
    contextManager: context,
    diagnosticEngine: new DiagnosticEngine({ serviceRegistry: registry, execution: new RuntimeExecutorManager({ executors: { docker } }) }),
    actionEngine: new ActionEngine({ serviceRegistry: registry, authorizationCore: core, execution: new RuntimeExecutorManager({ executors: { docker } }), verificationDelayMs: 0 }),
    auditLogger: audit,
    mediaOperations: {} as never,
    authorizationCore: core,
  });
  try {
    const prompt = await entry.handleRequest('重启 aria2', 'kook', '42', 'chat-42');
    assert.equal(prompt.requiresConfirmation, true);
    const pending = context.getContextRecord('homehub:kook:chat-42')?.pendingAction;
    assert.ok(pending);
    pending.timestamp = new Date(Date.now() - 1000).toISOString();
    const result = await entry.handleRequest('确认', 'kook', '42', 'chat-42');
    assert.equal(result.success, false);
    assert.match(result.message, /过期/u);
    assert.equal(docker.calls.some((call) => call.args?.[0] === 'restart'), false);
  } finally {
    audit.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test('running container with recent ERROR logs is DEGRADED, not DOWN', async () => {
  const server = createServer((_request, response) => {
    response.statusCode = 200;
    response.end('ok');
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const registry = new ServiceRegistry();
  const service = registry.getService('jellyfin')!;
  registry.registerService({ ...service, healthCheck: { type: 'http', target: `http://127.0.0.1:${address.port}/health`, timeout: 1000, expected: 'response' } });
  const docker = new FakeDocker('ERROR media library scan failed\n');
  const engine = new DiagnosticEngine({ serviceRegistry: registry, execution: new RuntimeExecutorManager({ executors: { docker } }) });
  try {
    const health = await engine.checkServiceHealth(registry.getService('jellyfin')!);
    assert.equal(health.status, 'degraded');
    assert.match(health.message, /错误日志/u);
    assert.notEqual(health.status, 'down');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
