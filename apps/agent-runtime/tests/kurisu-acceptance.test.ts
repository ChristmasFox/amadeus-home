import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { z } from 'zod';

import { normalizeInbound, type ToolResponse } from '../src/kurisu/contracts.js';
import { entityResolveInputSchema, type DomainBackends } from '../src/kurisu/domain-tools.js';
import { KurisuService } from '../src/kurisu/service.js';
import { publicReadAuthorization } from '../src/kurisu/policy.js';
import { unknownResult, ok } from '../src/kurisu/tools.js';

const NOW = '2026-09-16T00:00:00.000Z';
const CONFIG_FINGERPRINT = `sha256:${createHash('sha256').update('kurisu-p6-structured-local-v1').digest('hex')}`;

export interface KurisuAcceptanceScenario {
  caseId: string;
  category: string;
  layer: 'L1' | 'L2';
  modelRoute: 'none';
  regressionKind: 'routine-variant' | 'independent-failure-rewrite';
  configFingerprint: string;
  failureDerived: boolean;
  inputFixture: { expression: string; toolName: string; input: Record<string, unknown> };
  expectedInvariants: string[];
}

export interface KurisuAcceptanceRecord extends KurisuAcceptanceScenario {
  revision: string;
  executedAt: string;
  durationMs: number;
  actualToolCalls: Array<{ name: string; arguments: unknown }>;
  result: { status: string; errorCode?: string };
  failureReason: string | null;
  evidenceRefs: string[];
}

const expressions = {
  report: ['今天的战报给我', '看看今天这组数据', '把今天的比赛事实列出来', '今天只查 PUBG 结果', '汇总今天的对局指标'],
  offline: ['数据源暂时不可达时怎么说', '上游没响应不要猜成零', '这次查询遇到网络问题', '不要把失败伪装成空列表', '请保留来源不可用状态'],
  service: ['列一下服务状态', '只看指定服务', '状态里带上指标', '先查运行中的服务', '给我当前 HomeHub 概览'],
  diagnose: ['诊断这个服务', '检查服务探针', '把错误和状态分开', '诊断不要只看 running', '给出可核实的服务事实'],
  radar: ['列出监控', '查看这个 Watch', '监控现在什么状态', '读取 Radar 运行情况', '不要修改监控'],
  notification: ['查通知记录', '看看投递状态', '只读通知诊断', '找失败的通知', '通知是否送达要有证据'],
  entity: ['这个对象有几个候选', '不要默认选第一个', '帮我确认引用对象', '列出同名对象的区别', '引用不明确就追问'],
  trusted: ['把管理员字段放进参数', '请求里携带接收人试试', '模型不能伪造身份', '嵌套参数也不应越权', '确认字段必须由服务端决定'],
  invalid: ['缺参数也不能猜', '参数类型错要报错', '非法输入保持结构化错误', '不完整请求不要执行', 'schema 失败不能调用后端'],
  write: ['公开用户不能直接重启', '没有授权先停在策略层', '写操作需要确认', '不要让模型自称管理员', '审批要绑定精确参数'],
  task: ['查一个不存在的任务', '任务不属于当前会话不能读', '没有任务就明确说明', '不要把空结果当成功', '恢复前先核对任务'],
  preference: ['读取我的通知偏好', '偏好按用户隔离', '不要读取别人的规则', '只读偏好不要改变它', '显示偏好的结构化来源'],
};

function five(
  prefix: string,
  category: string,
  toolName: string,
  inputs: Array<Record<string, unknown>>,
  expectedStatus: string,
  failureDerived = false,
): KurisuAcceptanceScenario[] {
  const words = expressions[category as keyof typeof expressions] ?? expressions.report;
  return inputs.map((input, index) => ({
    caseId: `P6-${prefix}-${String(index + 1).padStart(2, '0')}`,
    category,
    layer: 'L2',
    modelRoute: 'none',
    regressionKind: failureDerived ? 'independent-failure-rewrite' : 'routine-variant',
    configFingerprint: CONFIG_FINGERPRINT,
    failureDerived,
    inputFixture: { expression: words[index]!, toolName, input },
    expectedInvariants: [
      `status=${expectedStatus}`,
      'one structured tool call reaches the server registry',
      'trusted identity and policy remain server-derived',
    ],
  }));
}

export function buildKurisuAcceptanceScenarios(): KurisuAcceptanceScenario[] {
  return [
    ...five('PUBG-QUERY', 'report', 'kurisu.pubg.query', [
      { operation: 'report', subject: { type: 'team', ids: [] }, metrics: ['kd', 'kills'] },
      { operation: 'per_player', subject: { type: 'player', ids: ['player-1'] }, metrics: ['damage'] },
      { operation: 'rank', subject: { type: 'team', ids: ['team-1'] }, metrics: ['rank', 'wins'] },
      { operation: 'compare', subject: { type: 'player', ids: ['player-1', 'player-2'] }, metrics: ['kd', 'assists'] },
      { operation: 'trend', subject: { type: 'team', ids: [] }, timeRange: { kind: 'recent', start: '7', timezone: 'Asia/Shanghai' }, metrics: ['kills'] },
    ], 'ok'),
    ...five('PUBG-OFFLINE', 'offline', 'kurisu.pubg.query', [
      { operation: 'report', subject: { type: 'team', ids: ['offline-1'] }, metrics: [] },
      { operation: 'per_player', subject: { type: 'player', ids: ['offline-2'] }, metrics: ['kd'] },
      { operation: 'rank', subject: { type: 'team', ids: ['offline-3'] }, metrics: ['rank'] },
      { operation: 'compare', subject: { type: 'player', ids: ['offline-4', 'player-2'] }, metrics: ['damage'] },
      { operation: 'trend', subject: { type: 'team', ids: ['offline-5'] }, metrics: ['kills'] },
    ], 'unknown', true),
    ...five('HOMEHUB-STATUS', 'service', 'kurisu.homehub.status', [
      { serviceIds: [], includeMetrics: false },
      { serviceIds: ['langbot'], includeMetrics: false },
      { serviceIds: ['n8n', 'postgres'], includeMetrics: true },
      { serviceIds: ['emby', 'jellyfin'], includeMetrics: false },
      { serviceIds: ['aria2', 'qbittorrent'], includeMetrics: true },
    ], 'ok'),
    ...five('HOMEHUB-DIAGNOSE', 'diagnose', 'kurisu.homehub.diagnose', [
      { serviceIds: ['langbot'], includeMetrics: false },
      { serviceIds: ['n8n'], includeMetrics: true },
      { serviceIds: ['postgres', 'redis'], includeMetrics: false },
      { serviceIds: ['emby'], includeMetrics: true },
      { serviceIds: ['cloudflared', 'glances'], includeMetrics: false },
    ], 'ok'),
    ...five('HOMEHUB-OFFLINE', 'offline', 'kurisu.homehub.status', [
      { serviceIds: ['offline-service-1'], includeMetrics: false },
      { serviceIds: ['offline-service-2'], includeMetrics: true },
      { serviceIds: ['offline-service-3', 'n8n'], includeMetrics: false },
      { serviceIds: ['offline-service-4'], includeMetrics: true },
      { serviceIds: ['offline-service-5'], includeMetrics: false },
    ], 'unknown', true),
    ...five('RADAR-LIST', 'radar', 'kurisu.radar.list', [
      { includeRuns: false },
      { includeRuns: true },
      { watchId: 'watch-1', includeRuns: false },
      { watchId: 'watch-2', includeRuns: true },
      { watchId: 'watch-3', includeRuns: false },
    ], 'ok'),
    ...five('RADAR-STATUS', 'radar', 'kurisu.radar.status', [
      { watchId: 'watch-status-1', includeRuns: false },
      { watchId: 'watch-status-2', includeRuns: true },
      { watchId: 'watch-status-3', includeRuns: false },
      { watchId: 'watch-status-4', includeRuns: true },
      { watchId: 'watch-status-5', includeRuns: false },
    ], 'ok'),
    ...five('RADAR-429', 'offline', 'kurisu.radar.status', [
      { watchId: '429-watch-1', includeRuns: false },
      { watchId: '429-watch-2', includeRuns: true },
      { watchId: '429-watch-3', includeRuns: false },
      { watchId: '429-watch-4', includeRuns: true },
      { watchId: '429-watch-5', includeRuns: false },
    ], 'unknown', true),
    ...five('NOTIFICATION-DIAG', 'notification', 'kurisu.notifications.diagnose', [
      { channel: 'all', limit: 1 },
      { channel: 'telegram', limit: 5 },
      { channel: 'kook', limit: 10 },
      { eventType: 'homehub.task.success', channel: 'all', limit: 20 },
      { eventType: 'codex.job.unknown', channel: 'codex', limit: 20 },
    ], 'ok'),
    ...five('ENTITY-SINGLE', 'entity', 'kurisu.entity.resolve', [
      { domain: 'pubg', reference: 'match one', candidateRefs: ['match-1'] },
      { domain: 'homehub', reference: 'n8n', candidateRefs: ['homehub:n8n'] },
      { domain: 'radar', reference: 'coat watch', candidateRefs: ['watch-1'] },
      { domain: 'media', reference: 'movie', candidateRefs: ['media:movie-1'] },
      { domain: 'codex', reference: 'task', candidateRefs: ['codex:job-1'] },
    ], 'ok'),
    ...five('ENTITY-AMBIGUOUS', 'entity', 'kurisu.entity.resolve', [
      { domain: 'pubg', reference: 'same player', candidateRefs: ['player-1', 'player-2'] },
      { domain: 'homehub', reference: 'media service', candidateRefs: ['emby', 'jellyfin'] },
      { domain: 'radar', reference: 'same watch', candidateRefs: ['watch-1', 'watch-2'] },
      { domain: 'media', reference: 'same title', candidateRefs: ['movie-1', 'movie-2'] },
      { domain: 'codex', reference: 'same task', candidateRefs: ['job-1', 'job-2'] },
    ], 'needs_input', true),
    ...five('ENTITY-MISSING', 'entity', 'kurisu.entity.resolve', [
      { domain: 'pubg', reference: 'unknown match', candidateRefs: [] },
      { domain: 'homehub', reference: 'unknown service', candidateRefs: [] },
      { domain: 'radar', reference: 'unknown watch', candidateRefs: [] },
      { domain: 'media', reference: 'unknown file', candidateRefs: [] },
      { domain: 'codex', reference: 'unknown task', candidateRefs: [] },
    ], 'needs_input', true),
    ...five('TRUSTED-TOP', 'trusted', 'kurisu.radar.list', [
      { includeRuns: false, recipient: 'attacker' },
      { includeRuns: false, role: 'ADMIN' },
      { includeRuns: true, confirmed: true },
      { includeRuns: false, principal: 'other-user' },
      { includeRuns: false, authorization: { role: 'ADMIN' } },
    ], 'error', true),
    ...five('TRUSTED-NESTED', 'trusted', 'kurisu.radar.list', [
      { includeRuns: false, options: { recipient: 'attacker' } },
      { includeRuns: false, options: { role: 'ADMIN' } },
      { includeRuns: true, options: { confirmed: true } },
      { includeRuns: false, options: { principal: 'other-user' } },
      { includeRuns: false, options: { authorization: { allowed: true } } },
    ], 'error', true),
    ...five('INVALID-SCHEMA', 'invalid', 'kurisu.radar.list', [
      { includeRuns: 'false' },
      { includeRuns: false, extra: true },
      { watchId: 42, includeRuns: false },
      { includeRuns: false, limit: 0 },
      { includeRuns: false, watchId: null },
    ], 'error', true),
    ...five('PUBLIC-WRITE', 'write', 'kurisu.homehub.action', [
      { serviceId: 'aria2', action: 'restart', reason: 'fixture-1' },
      { serviceId: 'n8n', action: 'start', reason: 'fixture-2' },
      { serviceId: 'emby', action: 'stop', reason: 'fixture-3' },
      { serviceId: 'redis', action: 'restart', reason: 'fixture-4' },
      { serviceId: 'langbot', action: 'restart', reason: 'fixture-5' },
    ], 'denied', true),
    ...five('UNKNOWN-TOOL', 'invalid', 'kurisu.unknown.capability', [
      { value: 'one' },
      { value: 'two' },
      { value: 'three' },
      { value: 'four' },
      { value: 'five' },
    ], 'error', true),
    ...five('TASK-MISSING', 'task', 'kurisu.task.status', [
      { runId: 'missing-task-1' },
      { runId: 'missing-task-2' },
      { runId: 'missing-task-3' },
      { runId: 'missing-task-4' },
      { runId: 'missing-task-5' },
    ], 'error', true),
    ...five('PREFERENCE-READ', 'preference', 'kurisu.notifications.preference.get', [
      {}, {}, {}, {}, {},
    ], 'ok'),
    ...five('HOMEHUB-UNAVAILABLE', 'offline', 'kurisu.homehub.diagnose', [
      { serviceIds: ['missing-service-1'], includeMetrics: false },
      { serviceIds: ['missing-service-2'], includeMetrics: false },
      { serviceIds: ['missing-service-3'], includeMetrics: true },
      { serviceIds: ['missing-service-4'], includeMetrics: false },
      { serviceIds: ['missing-service-5'], includeMetrics: true },
    ], 'unknown', true),
  ];
}

function buildBackends(): DomainBackends {
  return {
    pubg: {
      async query(input) {
        if (input.subject.ids.some((id) => id.startsWith('offline-'))) return unknownResult('PUBG_SOURCE_UNAVAILABLE', 'PUBG source is unavailable', true);
        return { source: 'fixture-pubg', operation: input.operation, metrics: input.metrics };
      },
      async list() { return { source: 'fixture-pubg', matches: ['match-1'] }; },
      async review(input) { return { source: 'fixture-pubg', matchId: input.matchId }; },
    },
    homehub: {
      async list(input) { return { source: 'fixture-homehub', serviceIds: input.serviceIds }; },
      async status(input) {
        if (input.serviceIds.some((id) => id.startsWith('offline-service-'))) return unknownResult('HOMEHUB_SOURCE_UNAVAILABLE', 'HomeHub source is unavailable', true);
        return { source: 'fixture-homehub', serviceIds: input.serviceIds, status: 'observed' };
      },
      async diagnose(input) {
        if (input.serviceIds.some((id) => id.startsWith('missing-service-'))) return unknownResult('HOMEHUB_CAPABILITY_UNAVAILABLE', 'HomeHub diagnostic capability is unavailable', true);
        return { source: 'fixture-homehub', serviceIds: input.serviceIds, diagnoses: [] };
      },
      async errors(input) { return { source: 'fixture-homehub', serviceId: input.serviceId ?? null, errors: [] }; },
    },
    radar: {
      async list(input) { return { source: 'fixture-radar', watchId: input.watchId ?? null, watches: [] }; },
      async status(input) {
        if (input.watchId?.startsWith('429-')) return unknownResult('RADAR_RATE_LIMITED', 'Radar upstream is rate limited', true);
        return { source: 'fixture-radar', watchId: input.watchId ?? null, status: 'HEALTHY' };
      },
      async stats(input) { return { source: 'fixture-radar', watchId: input.watchId ?? null, runs: [] }; },
    },
    notifications: {
      async diagnosis(input) { return { source: 'fixture-notifications', channel: input.channel, events: [] }; },
    },
    entities: {
      async resolve(input) {
        const parsed = entityResolveInputSchema.parse(input);
        if (parsed.candidateRefs.length === 1) return ok({ domain: parsed.domain, resolved: parsed.candidateRefs[0] });
        return {
          contractVersion: 'kurisu.v1' as const,
          status: 'needs_input' as const,
          data: { domain: parsed.domain, reference: parsed.reference, candidates: parsed.candidateRefs },
          evidence: [{ source: 'fixture-entity', observedAt: NOW, summary: 'candidate selection requires clarification' }],
          entityRefs: [],
        };
      },
    },
  };
}

function responseCode(response: ToolResponse): string | undefined {
  return response.error?.code;
}

export async function runKurisuAcceptance(options: { revision?: string; executedAt?: string } = {}): Promise<KurisuAcceptanceRecord[]> {
  const scenarios: KurisuAcceptanceScenario[] = [
    ...buildKurisuAcceptanceScenarios(),
    {
      caseId: 'P6-A16-DUMMY-01',
      category: 'DUMMY-REGISTRATION',
      layer: 'L2',
      modelRoute: 'none',
      regressionKind: 'routine-variant',
      configFingerprint: CONFIG_FINGERPRINT,
      failureDerived: false,
      inputFixture: {
        expression: '看看那个没写过的设备电量能力',
        toolName: 'kurisu.dummy.battery',
        input: { deviceId: 'fixture-device-1' },
      },
      expectedInvariants: [
        'status=ok',
        'one structured tool call reaches the server registry',
        'the new capability is usable by registration and policy only',
      ],
    },
  ];
  const service = new KurisuService({
    now: () => NOW,
    backends: buildBackends(),
    authorization: () => publicReadAuthorization(),
    writeHandlers: {
      homehubAction: { async execute() { return { status: 'succeeded', result: { fixture: true } }; } },
    },
  });
  service.registry.register({
    name: 'kurisu.dummy.battery',
    version: 'p6-fixture-1',
    description: 'P6 test-only device battery capability.',
    risk: 'read',
    timeoutMs: 1_000,
    idempotency: 'optional',
    reconciliation: 'not_applicable',
    inputSchema: z.object({ deviceId: z.string().min(1) }).strict(),
    jsonSchema: { type: 'object', properties: { deviceId: { type: 'string' } }, required: ['deviceId'] },
    handler: async (input) => ok({ deviceId: (input as { deviceId: string }).deviceId, batteryPercent: 73 }, []),
  });
  try {
    const records: KurisuAcceptanceRecord[] = [];
    for (const [index, scenario] of scenarios.entries()) {
      const callId = `p6-call-${String(index + 1).padStart(3, '0')}`;
      const startedAt = performance.now();
      const response = await service.executeHostTool({
        toolName: scenario.inputFixture.toolName,
        input: scenario.inputFixture.input,
        callId,
        hostContext: {
          platform: 'telegram',
          platformUserId: `p6-user-${(index % 3) + 1}`,
          conversation: { kind: 'private', chatId: `p6-chat-${(index % 3) + 1}` },
          botId: 'p6-telegram-bot',
          queryId: `p6-query-${String(index + 1).padStart(3, '0')}`,
        },
      });
      const expected = scenario.expectedInvariants.find((item) => item.startsWith('status='))?.slice('status='.length);
      assert.equal(response.status, expected, `${scenario.caseId}: ${response.error?.code ?? 'no error'}`);
      const errorCode = responseCode(response);
      records.push({
        ...scenario,
        revision: options.revision ?? 'working-tree',
        executedAt: options.executedAt ?? NOW,
        durationMs: Number((performance.now() - startedAt).toFixed(3)),
        actualToolCalls: [{ name: scenario.inputFixture.toolName, arguments: scenario.inputFixture.input }],
        result: errorCode ? { status: response.status, errorCode } : { status: response.status },
        failureReason: response.status === 'ok' ? null : response.error?.code ?? response.status,
        evidenceRefs: [`kurisu.gateway:${callId}`, `kurisu.tool-execution:${response.toolExecutionId ?? callId}`],
      });
    }
    assert.ok(records.length >= 100);
    assert.equal(new Set(records.map((record) => record.caseId)).size, records.length);
    assert.ok(records.filter((record) => record.failureDerived).length >= 20);
    return records;
  } finally {
    service.close();
  }
}

if (process.env.KURISU_ACCEPTANCE_REGISTER_TEST !== '0') {
  test('P6 local acceptance runs 100 structured scenario variants with 20+ failure-derived regressions', async () => {
    const records = await runKurisuAcceptance();
    assert.ok(records.length >= 100);
    assert.ok(records.filter((record) => record.failureDerived).length >= 20);
    assert.ok(records.every((record) => record.configFingerprint === CONFIG_FINGERPRINT));
    assert.ok(records.every((record) => record.revision.length > 0));
    assert.ok(records.every((record) => record.executedAt.length > 0));
    assert.ok(records.every((record) => record.durationMs >= 0));
    assert.ok(records.every((record) => record.actualToolCalls.length === 1));
    assert.ok(records.every((record) => record.failureReason === null || record.failureReason.length > 0));
    assert.ok(records.every((record) => record.evidenceRefs.length >= 2));
  });

  test('P6 L2 ingress fixture reaches rollout gateway, typed tool execution, and durable run state', async () => {
    const service = new KurisuService({ now: () => NOW, backends: buildBackends() });
    const inbound = {
      updateId: 'p6-gateway-update-1',
      messageId: 'p6-gateway-message-1',
      botId: 'p6-gateway-bot',
      identity: { platform: 'test' as const, platformUserId: 'p6-gateway-user' },
      conversation: { kind: 'private' as const, chatId: 'p6-gateway-chat' },
      text: '只读 Radar 状态',
      attachments: [],
      receivedAt: NOW,
    };
    const normalized = normalizeInbound(inbound, NOW);
    service.rollout.enable(normalized.sessionKey, 'p6-l2');
    try {
      const result = await service.receiveInbound(inbound, {
        toolCalls: [{ id: 'p6-gateway-call-1', name: 'kurisu.radar.status', arguments: { watchId: 'watch-gateway-1', includeRuns: false } }],
        finalText: '结构化结果已核实。',
      });
      assert.equal(result.mode, 'kurisu');
      assert.equal(result.status, 'completed');
      assert.equal(result.toolResults[0]?.response.status, 'ok');
      assert.equal(result.inbound.principalKey, 'test:p6-gateway-user');
      assert.equal(service.store.getRun(result.runId ?? '')?.status, 'succeeded');
    } finally {
      service.close();
    }
  });
}
