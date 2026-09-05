import { randomUUID } from 'node:crypto';
import type {
  Action,
  ActionRequest,
  ActionResult,
  ActionStatus,
  ServiceDefinition,
  ServiceId,
} from '../schema/types.js';
import { ActionRequestSchema } from '../schema/types.js';
import { ServiceRegistry } from '../registry/service-registry.js';
import {
  AuthorizationCore,
  identityFromParts,
  type AuthorizationDecision,
  type AuthorizationIdentityLike,
} from '../authorization/authorization-core.js';
import {
  RuntimeExecutorManager,
  type RuntimeExecutorManagerOptions,
} from '../execution/runtime-executor.js';

export interface ActionEngineOptions extends RuntimeExecutorManagerOptions {
  /** Deprecated compatibility fields; actions no longer shell through them. */
  orbHost?: string;
  orbUser?: string;
  casaosAppsPath?: string;
  autoVerify?: boolean;
  verificationDelayMs?: number;
  execution?: RuntimeExecutorManager;
  executorManager?: RuntimeExecutorManager;
  serviceRegistry?: ServiceRegistry;
  authorizationCore?: AuthorizationCore;
}

type ParsedActionRequest = ReturnType<typeof ActionRequestSchema.parse> & {
  platformUserId: string;
  internalUserId: string | null;
  role: 'PUBLIC' | 'TRUSTED' | 'ADMIN';
  chatId: string;
  actionId: string;
};

interface ExecResult {
  success: boolean;
  message: string;
  output?: string;
  error?: string;
}

/** Executes only allowlisted actions through the service's explicit executor. */
export class ActionEngine {
  private readonly serviceRegistry: ServiceRegistry;
  private readonly authorizationCore: AuthorizationCore;
  private readonly execution: RuntimeExecutorManager;
  private readonly autoVerify: boolean;
  private readonly verificationDelayMs: number;

  constructor(options: ActionEngineOptions = {}) {
    this.serviceRegistry = options.serviceRegistry ?? new ServiceRegistry();
    this.authorizationCore = options.authorizationCore ?? new AuthorizationCore();
    this.execution = options.executorManager
      ?? options.execution
      ?? new RuntimeExecutorManager(options);
    this.autoVerify = options.autoVerify ?? true;
    this.verificationDelayMs = Math.max(0, options.verificationDelayMs ?? 2500);
  }

  get registry(): ServiceRegistry {
    return this.serviceRegistry;
  }

  get executor(): RuntimeExecutorManager {
    return this.execution;
  }

  getService(serviceId: ServiceId): ServiceDefinition | undefined {
    return this.serviceRegistry.getService(serviceId);
  }

  isAllowed(serviceId: ServiceId, action: Action): boolean {
    return this.serviceRegistry.isActionAllowed(serviceId, action);
  }

  getRiskLevel(serviceId: ServiceId): string {
    return this.serviceRegistry.getService(serviceId)?.riskLevel ?? 'unknown';
  }

  authorizeAction(request: ActionRequest, identity: AuthorizationIdentityLike): AuthorizationDecision {
    const normalized = this.normalizeRequest(request);
    const service = this.serviceRegistry.getService(normalized.serviceId);
    if (!service) {
      return {
        authorized: false,
        requiresConfirmation: false,
        role: identity.role ?? 'PUBLIC',
        action: normalized.action,
        reason: 'Service not found in registry',
      };
    }
    return this.authorizationCore.authorize({
      identity,
      action: normalized.action,
      service,
      confirmed: normalized.confirmed,
    });
  }

  /**
   * The identity argument is trusted server-side state. If omitted, the
   * request is always evaluated as PUBLIC; inbound role/internal fields never
   * grant access by themselves.
   */
  async executeAction(request: ActionRequest, identity?: AuthorizationIdentityLike): Promise<ActionResult> {
    const normalizedRequest = this.normalizeRequest(request);
    const requestId = this.generateId();
    const startTime = Date.now();
    const service = this.serviceRegistry.getService(normalizedRequest.serviceId);

    if (!service) return this.createErrorResult(requestId, normalizedRequest, 'Service not found in registry', startTime);

    // A dry run has no side effects and is useful for rendering a confirmation
    // prompt. Real execution still passes through the full authorization gate.
    if (normalizedRequest.dryRun) return this.createDryRunResult(requestId, normalizedRequest, service, startTime);

    const authorizationIdentity = identity ?? identityFromParts(
      normalizedRequest.platform,
      normalizedRequest.platformUserId,
      null,
      ['PUBLIC'],
    );
    const decision = this.authorizationCore.authorize({
      identity: authorizationIdentity,
      action: normalizedRequest.action,
      service,
      confirmed: normalizedRequest.confirmed,
    });
    if (!decision.authorized) return this.createDeniedResult(requestId, normalizedRequest, decision, startTime);

    const executedAt = new Date().toISOString();
    try {
      const executionResult = await this.performAction(normalizedRequest, service);
      if (!executionResult.success) {
        return {
          requestId,
          serviceId: normalizedRequest.serviceId,
          action: normalizedRequest.action,
          status: 'failed',
          result: executionResult,
          verification: { passed: false, checks: [], message: 'Action execution failed, verification skipped' },
          timestamp: new Date().toISOString(),
          executedAt,
          verifiedAt: new Date().toISOString(),
          duration: Date.now() - startTime,
        };
      }

      const verification = this.autoVerify
        ? await this.verifyAction(normalizedRequest, service)
        : { passed: true, checks: [], message: 'Verification disabled by configuration' };
      const status: ActionStatus = verification.passed ? 'success' : 'failed';
      return {
        requestId,
        serviceId: normalizedRequest.serviceId,
        action: normalizedRequest.action,
        status,
        result: executionResult,
        verification,
        timestamp: new Date().toISOString(),
        executedAt,
        verifiedAt: new Date().toISOString(),
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        requestId,
        serviceId: normalizedRequest.serviceId,
        action: normalizedRequest.action,
        status: 'failed',
        result: {
          success: false,
          message: error instanceof Error ? error.message : 'Action execution failed',
          error: error instanceof Error ? error.stack : String(error),
        },
        verification: { passed: false, checks: [], message: 'Action failed, verification skipped' },
        timestamp: new Date().toISOString(),
        executedAt,
        verifiedAt: new Date().toISOString(),
        duration: Date.now() - startTime,
      };
    }
  }

  private normalizeRequest(request: ActionRequest): ParsedActionRequest {
    const parsed = ActionRequestSchema.parse(request);
    return {
      ...parsed,
      platformUserId: parsed.platformUserId ?? parsed.userId,
      internalUserId: parsed.internalUserId ?? null,
      role: parsed.role ?? 'PUBLIC',
      chatId: parsed.chatId ?? 'unknown-chat',
      actionId: parsed.actionId ?? `action-${randomUUID()}`,
    };
  }

  private async performAction(request: ParsedActionRequest, service: ServiceDefinition): Promise<ExecResult> {
    switch (request.action) {
      case 'start':
        return this.runServiceCommand(service, ['up', '-d'], `启动 ${service.displayName}`);
      case 'restart':
        return service.runtime === 'langbot-component'
          ? this.restartLangBotComponent(service)
          : this.runServiceCommand(service, ['restart'], `重启 ${service.displayName}`);
      case 'stop':
        return this.runServiceCommand(service, ['stop'], `停止 ${service.displayName}`);
      case 'rotate_logs':
        return this.rotateLogs(service);
      case 'check':
        return { success: true, message: `检查完成: ${service.displayName}`, output: '未发现需要执行的变更' };
      case 'cleanup':
        return { success: false, message: 'cleanup 未配置显式安全执行器，默认拒绝' };
      case 'organize_media':
      case 'organize':
        return { success: false, message: '媒体整理由 MediaOperations 的确认流程执行' };
      default:
        return { success: false, message: `不支持的操作: ${request.action}` };
    }
  }

  private async runServiceCommand(service: ServiceDefinition, composeArgs: readonly string[], label: string): Promise<ExecResult> {
    if (service.runtime === 'langbot-component') {
      return { success: false, message: `${label}失败: LangBot component 不支持通用 Compose 操作` };
    }
    if (service.runtime !== 'docker' || !service.container) {
      return { success: false, message: `${label}失败: 该服务没有安全的 Docker Compose 执行定义` };
    }
    const result = await this.execution.executeForService(service, {
      command: 'docker',
      args: ['compose', '-f', service.container.composePath, ...composeArgs],
      timeoutMs: 120_000,
    });
    return this.toExecResult(result, `${label}${result.ok ? '成功' : '失败'}`);
  }

  private async restartLangBotComponent(service: ServiceDefinition): Promise<ExecResult> {
    const containerName = service.component?.containerName;
    if (!containerName) return { success: false, message: 'LangBot component 未配置宿主容器' };
    const result = await this.execution.execute('docker', {
      command: 'docker',
      args: ['restart', containerName],
      timeoutMs: 60_000,
    });
    return this.toExecResult(result, result.ok
      ? `${service.displayName} 已重启（重启其 LangBot 宿主容器）`
      : `${service.displayName} 重启失败`);
  }

  private async rotateLogs(service: ServiceDefinition): Promise<ExecResult> {
    if (!service.container) return { success: false, message: '无容器日志可轮转' };
    const ids = await this.execution.executeForService(service, {
      command: 'docker',
      args: ['ps', '-q', '--filter', `name=^${service.container.name}$`],
      timeoutMs: 30_000,
    });
    if (!ids.ok) return this.toExecResult(ids, '日志轮转失败');
    const containerId = ids.stdout.trim().split(/\s+/u).find(Boolean);
    if (!containerId) return { success: true, message: '没有运行中的容器，未轮转日志' };
    const logPath = await this.execution.executeForService(service, {
      command: 'docker',
      args: ['inspect', '--format', '{{.LogPath}}', containerId],
      timeoutMs: 30_000,
    });
    if (!logPath.ok) return this.toExecResult(logPath, '日志路径读取失败');
    const path = logPath.stdout.trim();
    if (!path || !path.startsWith('/')) return { success: false, message: '日志路径无效，拒绝轮转' };
    const truncated = await this.execution.executeForService(service, {
      command: 'truncate',
      args: ['-s', '0', path],
      timeoutMs: 30_000,
    });
    return this.toExecResult(truncated, truncated.ok ? '日志轮转完成' : '日志轮转失败');
  }

  private async verifyAction(request: ParsedActionRequest, service: ServiceDefinition): Promise<ActionResult['verification']> {
    const checks: ActionResult['verification']['checks'] = [];
    if (this.verificationDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.verificationDelayMs));

    if (request.action === 'stop') {
      if (service.runtime === 'docker' && service.container) {
        const state = await this.containerState(service);
        const stopped = state.available && (!state.value || state.value !== 'running');
        checks.push({
          name: 'container_stopped',
          status: stopped ? 'passed' : 'failed',
          message: stopped ? '容器已停止' : state.available ? `容器仍处于 ${state.value ?? 'unknown'}` : '验证 executor 不可用',
        });
      } else {
        checks.push({ name: 'process_stopped', status: 'failed', message: '该服务没有可验证的停止边界' });
      }
    } else if (request.action === 'check' || request.action === 'rotate_logs' || request.action === 'cleanup' || request.action === 'organize_media' || request.action === 'organize') {
      checks.push({ name: 'command_completed', status: 'passed', message: '指令完成' });
    } else if (service.runtime === 'docker' && service.container) {
      const state = await this.containerState(service);
      const running = state.available && state.value === 'running';
      checks.push({
        name: 'container_running',
        status: running ? 'passed' : 'failed',
        message: running ? `容器运行中 (${state.value})` : state.available ? `容器未运行 (${state.value ?? 'missing'})` : '验证 executor 不可用',
      });
    } else if (service.runtime === 'langbot-component') {
      const state = await this.containerStateForComponent(service);
      checks.push({
        name: 'langbot_host_running',
        status: state.available && state.value === 'running' ? 'passed' : 'failed',
        message: state.available && state.value === 'running' ? 'LangBot 宿主容器运行中' : 'LangBot 宿主容器未通过验证',
      });
    } else {
      checks.push({ name: 'executor_verification', status: 'failed', message: '该运行位置没有可用的验证 Agent' });
    }

    if (service.dependencies.length > 0) {
      const down: string[] = [];
      let unavailable = false;
      for (const dependencyId of service.dependencies) {
        const dependency = this.serviceRegistry.getService(dependencyId);
        if (!dependency) {
          unavailable = true;
          continue;
        }
        const state = dependency.runtime === 'langbot-component'
          ? await this.containerStateForComponent(dependency)
          : await this.containerState(dependency);
        if (!state.available) unavailable = true;
        else if (state.value !== 'running') down.push(dependencyId);
      }
      checks.push({
        name: 'dependencies_up',
        status: down.length || unavailable ? 'failed' : 'passed',
        message: down.length ? `依赖未恢复: ${down.join('、')}` : unavailable ? '依赖验证 executor 不可用' : '依赖服务正常',
      });
    }

    const passed = checks.every((check) => check.status === 'passed');
    return {
      passed,
      checks,
      message: passed ? '服务已恢复并通过验证' : checks.find((check) => check.status === 'failed')?.message ?? '部分验证未通过',
    };
  }

  private async containerState(service: ServiceDefinition): Promise<{ value: string | null; available: boolean }> {
    if (!service.container) return { value: null, available: false };
    const result = await this.execution.executeForService(service, {
      command: 'docker',
      args: ['ps', '-a', '--filter', `name=^${service.container.name}$`, '--format', '{{.State}}'],
      timeoutMs: 30_000,
    });
    if (!result.executorAvailable) return { value: null, available: false };
    if (!result.ok) return { value: null, available: true };
    const value = result.stdout.trim().split('\n').map((line) => line.trim()).find(Boolean) ?? null;
    return { value, available: true };
  }

  private async containerStateForComponent(service: ServiceDefinition): Promise<{ value: string | null; available: boolean }> {
    const containerName = service.component?.containerName;
    if (!containerName) return { value: null, available: false };
    const result = await this.execution.execute('docker', {
      command: 'docker',
      args: ['ps', '-a', '--filter', `name=^${containerName}$`, '--format', '{{.State}}'],
      timeoutMs: 30_000,
    });
    if (!result.executorAvailable) return { value: null, available: false };
    if (!result.ok) return { value: null, available: true };
    return { value: result.stdout.trim().split('\n').map((line) => line.trim()).find(Boolean) ?? null, available: true };
  }

  private toExecResult(result: { ok: boolean; executorAvailable: boolean; stdout: string; stderr: string; error?: string }, message: string): ExecResult {
    return {
      success: result.ok,
      message,
      ...(result.stdout || result.stderr ? { output: `${result.stdout}${result.stderr}`.trim().slice(0, 2000) } : {}),
      ...(!result.ok ? { error: result.executorAvailable ? result.error ?? result.stderr : `Executor unavailable: ${result.error ?? 'command failed'}` } : {}),
    };
  }

  private createDryRunResult(requestId: string, request: ParsedActionRequest, service: ServiceDefinition, startTime: number): ActionResult {
    const labels: Record<Action, string> = {
      start: '启动',
      restart: '重启',
      stop: '停止',
      check: '检查',
      cleanup: '清理',
      rotate_logs: '轮转日志',
      organize_media: '整理媒体',
      organize: '整理媒体',
    };
    return {
      requestId,
      serviceId: request.serviceId,
      action: request.action,
      status: 'pending',
      result: {
        success: true,
        message: `DRY RUN: ${labels[request.action] ?? request.action} ${service.displayName}`,
        output: `服务: ${service.serviceId}\n运行位置: ${service.runtime}\nExecutor: ${service.executor}\n操作: ${request.action}\n风险: ${service.riskLevel}\n\n这是预演，未执行任何变更。`,
      },
      verification: { passed: true, checks: [], message: 'Dry run 完成' },
      timestamp: new Date().toISOString(),
      executedAt: new Date().toISOString(),
      verifiedAt: new Date().toISOString(),
      duration: Date.now() - startTime,
    };
  }

  private createDeniedResult(requestId: string, request: ParsedActionRequest, decision: AuthorizationDecision, startTime: number): ActionResult {
    return {
      requestId,
      serviceId: request.serviceId,
      action: request.action,
      status: 'cancelled',
      result: { success: false, message: decision.reason ?? 'Action denied' },
      verification: { passed: false, checks: [], message: 'Authorization failed, action not executed' },
      timestamp: new Date().toISOString(),
      executedAt: new Date().toISOString(),
      verifiedAt: new Date().toISOString(),
      duration: Date.now() - startTime,
    };
  }

  private createErrorResult(requestId: string, request: ParsedActionRequest, message: string, startTime: number): ActionResult {
    return {
      requestId,
      serviceId: request.serviceId,
      action: request.action,
      status: 'failed',
      result: { success: false, message, error: message },
      verification: { passed: false, checks: [], message: '错误发生，跳过验证' },
      timestamp: new Date().toISOString(),
      executedAt: new Date().toISOString(),
      verifiedAt: new Date().toISOString(),
      duration: Date.now() - startTime,
    };
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }
}
