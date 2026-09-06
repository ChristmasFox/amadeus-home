import type {
  Action,
  DiagnosisIssue,
  DiagnosisResult,
  DiagnosisStatus,
  HealthResult,
  HealthStatus,
  ServiceDefinition,
  ServiceHealth,
  ServiceId,
} from '../schema/types.js';
import { ServiceRegistry } from '../registry/service-registry.js';
import { HostCollector } from '../registry/host-collector.js';
import {
  RuntimeExecutorManager,
  type CommandExecution,
  type RuntimeExecutorManagerOptions,
} from '../execution/runtime-executor.js';

export interface DiagnosticEngineOptions extends RuntimeExecutorManagerOptions {
  /** Deprecated compatibility fields; all commands now use explicit executors. */
  orbHost?: string;
  orbUser?: string;
  casaosAppsPath?: string;
  embyApiKey?: string;
  runtimeBaseUrl?: string;
  execution?: RuntimeExecutorManager;
  executorManager?: RuntimeExecutorManager;
  serviceRegistry?: ServiceRegistry;
  hostCollector?: HostCollector;
}

type Check = DiagnosisResult['checks'][number];
type CheckDetails = Record<string, unknown>;
type FailureCause = 'service_down' | 'health_check_failed' | 'resource_exceeded' | 'log_error' | 'executor_unavailable' | 'observation_failure';

/**
 * Deterministic HomeHub diagnostics. A command/executor failure is represented
 * as an unknown observation and is never converted into a service-down issue.
 */
export class DiagnosticEngine {
  private readonly serviceRegistry: ServiceRegistry;
  private readonly options: {
    runtimeBaseUrl: string;
  };
  private readonly execution: RuntimeExecutorManager;
  private readonly collector: HostCollector;

  constructor(options: DiagnosticEngineOptions = {}) {
    this.serviceRegistry = options.serviceRegistry ?? new ServiceRegistry();
    this.options = {
      runtimeBaseUrl: options.runtimeBaseUrl ?? 'http://localhost:5310',
    };
    this.execution = options.executorManager
      ?? options.execution
      ?? new RuntimeExecutorManager(options);
    this.collector = options.hostCollector ?? new HostCollector({ execution: this.execution });
  }

  get registry(): ServiceRegistry {
    return this.serviceRegistry;
  }

  get executor(): RuntimeExecutorManager {
    return this.execution;
  }

  /** Aggregate system health across all registered services. */
  async systemHealth(_platform = 'kook'): Promise<HealthResult> {
    const host = await this.collector.collect();
    const services = await Promise.all(
      this.serviceRegistry.getAllServices().map((definition) => this.checkServiceHealth(definition)),
    );

    const summary = {
      totalServices: services.length,
      healthy: services.filter((service) => service.status === 'healthy').length,
      degraded: services.filter((service) => service.status === 'degraded').length,
      unhealthy: services.filter((service) => service.status === 'unhealthy').length,
      down: services.filter((service) => service.status === 'down').length,
      unknown: services.filter((service) => service.status === 'unknown').length,
    };
    const abnormal = services
      .filter((service) => ['degraded', 'unhealthy', 'down'].includes(service.status))
      .map((service) => service.serviceId);
    const unknownExecutors = services.reduce((counts, service) => {
      if (service.status !== 'unknown' || service.unknownReason !== 'executor_unavailable') return counts;
      if (service.executor === 'docker') counts.docker += 1;
      else if (service.executor === 'langbot-component') counts.component += 1;
      else if (service.executor === 'macos-host') counts.macos += 1;
      else counts.other += 1;
      return counts;
    }, { docker: 0, component: 0, macos: 0, other: 0 });

    return {
      host,
      services,
      summary,
      abnormal,
      diagnosis: this.diagnoseSystem(summary.healthy, summary.totalServices, abnormal.length, summary.unknown, unknownExecutors),
      timestamp: new Date().toISOString(),
    };
  }

  private diagnoseSystem(
    healthy: number,
    total: number,
    abnormal: number,
    unknown: number,
    unknownExecutors: { docker: number; component: number; macos: number; other: number },
  ): string {
    if (unknownExecutors.docker > 0) {
      return `HomeHub Docker 执行器不可用，Docker 服务状态未知（${unknownExecutors.docker}/${total}）`;
    }
    if (unknownExecutors.component > 0) {
      return `LangBot 组件执行器不可用，组件服务状态未知（${unknownExecutors.component}/${total}）`;
    }
    if (unknownExecutors.macos > 0) {
      return `macOS 主机执行器不可用，macOS 服务状态未知（${unknownExecutors.macos}/${total}）`;
    }
    if (unknownExecutors.other > 0) {
      return `服务执行器不可用，部分服务状态未知（${unknownExecutors.other}/${total}）`;
    }
    if (abnormal === 0 && total > 0 && healthy === total) return '系统运行正常';
    if (abnormal > 0) return `有 ${abnormal} 个服务异常，其余 ${healthy}/${total} 个服务正常`;
    if (unknown > 0) return `部分服务状态未知（${healthy}/${total} 正常，${unknown} 个未知）`;
    return `服务状态未知（${healthy}/${total} 正常）`;
  }

  /** Check one registered service and preserve the distinction between DOWN and UNKNOWN. */
  async checkServiceHealth(definition: ServiceDefinition): Promise<ServiceHealth> {
    const result = await this.diagnose(definition.serviceId);
    const unknownCheck = result.checks.find((check) => this.isPrimaryUnknownCheck(check));
    const downCheck = result.checks.find((check) => (
      ['container_alive', 'component_alive', 'process_alive'].includes(check.name)
      && this.hasCause(check, 'service_down')
    ));
    const dependencyFailure = result.checks.some((check) => check.name === 'dependencies' && this.hasCause(check, 'service_down'));
    const explicitFailure = result.checks.some((check) => this.hasCause(check, 'health_check_failed')
      || this.hasCause(check, 'resource_exceeded')
      || this.hasCause(check, 'log_error'));

    let status: HealthStatus;
    let unknownReason: string | undefined;
    if (unknownCheck) {
      status = 'unknown';
      unknownReason = String(unknownCheck.details?.cause ?? 'observation_failure');
    } else if (downCheck) {
      status = 'down';
    } else if (explicitFailure || result.issues.some((issue) => issue.severity === 'critical' || issue.severity === 'error')) {
      status = 'unhealthy';
    } else if (dependencyFailure) {
      // The primary container is still running; a missing dependency is a
      // degraded condition, not proof that the service itself is DOWN.
      status = 'degraded';
    } else {
      // Optional resource/log observations may be unavailable while the
      // primary service health check is known to be healthy.
      status = 'healthy';
    }

    const failedCheck = result.checks.find((check) => check.status === 'failed');
    const message = status === 'unknown'
      ? `无法确认 ${definition.displayName} 状态（${unknownCheck?.message ?? '检查不可用'}）`
      : status === 'down'
        ? downCheck?.message ?? `${definition.displayName} 未运行`
        : failedCheck?.message
          ?? result.issues[0]?.message
          ?? '运行正常';

    return {
      serviceId: definition.serviceId,
      status,
      lastCheck: new Date().toISOString(),
      message,
      runtime: definition.runtime,
      executor: definition.executor,
      ...(unknownReason ? { unknownReason } : {}),
      checks: result.checks.map((check) => ({
        name: check.name,
        status: check.status === 'passed'
          ? 'healthy'
          : this.hasCause(check, 'service_down')
            ? 'down'
            : check.status === 'failed'
              ? 'unhealthy'
              : 'unknown',
        message: check.message,
        timestamp: check.timestamp,
      })),
    };
  }

  async diagnose(serviceId: ServiceId): Promise<DiagnosisResult> {
    const service = this.serviceRegistry.getService(serviceId);
    if (!service) return this.createErrorDiagnosis(serviceId, 'Service not found in registry');

    const checks: DiagnosisResult['checks'] = [];
    const issues: DiagnosisIssue[] = [];

    const aliveCheck = await this.checkAlive(service);
    checks.push(aliveCheck);
    if (this.hasCause(aliveCheck, 'service_down')) {
      issues.push({
        severity: 'critical',
        category: 'process',
        component: service.serviceId,
        message: `${service.displayName} 未运行（${aliveCheck.message}）`,
        suggestion: `尝试重启 ${service.displayName}`,
        actionable: true,
      });
    }

    // Do not run dependent checks after an unknown alive observation: doing so
    // would turn a missing executor into a chain of false service failures.
    if (aliveCheck.status === 'passed' && (service.healthCheck.type === 'http' || service.healthCheck.type === 'tcp')) {
      // Docker services are observed from the runtime container. Their host
      // published ports (for example localhost:5679) are not reachable via
      // the runtime container's loopback, so use the Docker health/status
      // boundary instead of pretending that a local curl is authoritative.
      const reachable = service.runtime === 'docker' && service.container
        ? await this.checkContainerHealth(service)
        : await this.checkReachable(service);
      checks.push(reachable);
      if (this.hasCause(reachable, 'health_check_failed')) {
        issues.push({
          severity: 'error',
          category: 'connectivity',
          component: service.serviceId,
          message: reachable.message,
          suggestion: `检查 ${service.displayName} 的网络/端口配置`,
          actionable: true,
        });
      }
    }

    if (aliveCheck.status === 'passed' && service.dependencies.length > 0) {
      const dependencyCheck = await this.checkDependencies(service);
      checks.push(dependencyCheck);
      if (this.hasCause(dependencyCheck, 'service_down')) {
        const failed = (dependencyCheck.details?.failed as string[] | undefined) ?? [];
        issues.push({
          severity: 'warning',
          category: 'dependency',
          component: service.serviceId,
          message: `依赖服务异常: ${failed.join('、')}`,
          suggestion: '先恢复依赖服务再重试',
          actionable: true,
        });
      }
    }

    if (aliveCheck.status === 'passed' && service.container) {
      const resourceCheck = await this.checkResourceUsage(service);
      checks.push(resourceCheck);
      if (this.hasCause(resourceCheck, 'resource_exceeded')) {
        issues.push({
          severity: 'warning',
          category: 'resource',
          component: service.serviceId,
          message: String(resourceCheck.details?.problem ?? resourceCheck.message),
          suggestion: '重启服务释放资源',
          actionable: true,
        });
      }
    }

    if (aliveCheck.status === 'passed' && service.container) {
      const logCheck = await this.checkRecentLogs(service);
      checks.push(logCheck);
      if (this.hasCause(logCheck, 'log_error')) {
        issues.push({
          severity: 'warning',
          category: 'data',
          component: service.serviceId,
          message: logCheck.message,
          suggestion: '查看容器日志定位错误',
          actionable: true,
        });
      }
    }

    const hasUnknownObservation = checks.some((check) => this.isUnknownCheck(check));
    const status: DiagnosisStatus = hasUnknownObservation && issues.length === 0
      ? 'failed'
      : issues.length === 0
        ? 'resolved'
        : issues.some((issue) => issue.severity === 'critical') ? 'diagnosed' : 'uncertain';

    return {
      serviceId,
      status,
      issues,
      checks,
      recommendedActions: this.generateRecommendedActions(service, issues),
      timestamp: new Date().toISOString(),
    };
  }

  /** Specialized Telegram polling diagnosis used by the self-healing flow. */
  async diagnoseTelegramPolling(): Promise<DiagnosisResult> {
    const service = this.serviceRegistry.getService('telegram-adapter');
    if (!service) return this.createErrorDiagnosis('telegram-adapter', 'Telegram adapter not in registry');

    const checks: DiagnosisResult['checks'] = [];
    const issues: DiagnosisIssue[] = [];
    const aliveCheck = await this.checkAlive(service);
    checks.push(aliveCheck);
    if (this.hasCause(aliveCheck, 'service_down')) {
      issues.push({
        severity: 'critical',
        category: 'process',
        component: 'telegram-adapter',
        message: 'Telegram adapter 进程未运行',
        suggestion: '重启 Telegram adapter',
        actionable: true,
      });
    }

    const langbot = this.serviceRegistry.getService('langbot');
    if (langbot && aliveCheck.status === 'passed') {
      const langbotCheck = await this.checkAlive(langbot);
      checks.push({ ...langbotCheck, name: 'langbot_host' });
      if (this.hasCause(langbotCheck, 'service_down')) {
        issues.push({
          severity: 'error',
          category: 'dependency',
          component: 'langbot',
          message: 'LangBot 未运行，Telegram adapter 无法工作',
          suggestion: '先重启 LangBot',
          actionable: true,
        });
      }
    }

    const pollCheck = await this.checkPollingStaleness();
    checks.push(pollCheck);
    const staleSeconds = pollCheck.details?.staleSeconds;
    if (pollCheck.status === 'failed' && typeof staleSeconds === 'number' && staleSeconds > 0) {
      const minutes = Math.round(staleSeconds / 60);
      issues.push({
        severity: staleSeconds > 300 ? 'critical' : 'warning',
        category: 'connectivity',
        component: 'telegram-adapter',
        message: `Telegram polling 已 ${minutes} 分钟无成功轮询`,
        suggestion: staleSeconds > 300 ? '重启 Telegram adapter 恢复轮询' : '继续观察',
        actionable: true,
      });
    }

    if (aliveCheck.status === 'passed') {
      const apiCheck = await this.checkTelegramBotApi();
      checks.push(apiCheck);
      if (this.hasCause(apiCheck, 'health_check_failed')) {
        issues.push({
          severity: 'error',
          category: 'external',
          component: 'telegram-bot-api',
          message: 'Telegram Bot API 无法连通',
          suggestion: '检查出网与代理配置',
          actionable: false,
        });
      }
    }

    const hasUnknownObservation = checks.some((check) => this.isUnknownCheck(check));
    const status: DiagnosisStatus = hasUnknownObservation && issues.length === 0
      ? 'failed'
      : issues.length === 0
        ? 'resolved'
        : issues.some((issue) => issue.severity === 'critical') ? 'diagnosed' : 'uncertain';
    const recommendedActions = issues.some((issue) => issue.category === 'connectivity' && issue.severity === 'critical')
      ? [{ action: 'restart' as Action, reason: 'Telegram polling stale，重启 adapter 可恢复轮询', confidence: 0.85, requiresConfirmation: true }]
      : [];

    return {
      serviceId: 'telegram-adapter',
      status,
      issues,
      checks,
      recommendedActions,
      timestamp: new Date().toISOString(),
    };
  }

  private async checkAlive(service: ServiceDefinition): Promise<Check> {
    if (service.runtime === 'langbot-component') {
      const containerName = service.component?.containerName;
      if (!containerName) return this.skipped('component_alive', 'LangBot component container 未配置', 'observation_failure');
      const result = await this.execution.execute('docker', {
        command: 'docker',
        args: ['ps', '-a', '--filter', `name=^${containerName}$`, '--format', '{{.Names}}|{{.State}}|{{.Status}}'],
        timeoutMs: service.healthCheck.timeout,
      });
      return this.containerCheck(result, containerName, 'component_alive');
    }

    if (service.container) {
      const result = await this.execution.executeForService(service, {
        command: 'docker',
        args: ['ps', '-a', '--filter', `name=^${service.container.name}$`, '--format', '{{.Names}}|{{.State}}|{{.Status}}'],
        timeoutMs: service.healthCheck.timeout,
      });
      return this.containerCheck(result, service.container.name, 'container_alive');
    }

    const target = service.process?.name ?? service.healthCheck.target;
    const result = await this.execution.executeForService(service, {
      command: 'pgrep',
      args: ['-f', target],
      timeoutMs: service.healthCheck.timeout,
    });
    if (result.executorAvailable && (result.ok || result.exitCode === 1)) {
      const alive = result.ok && result.stdout.trim().length > 0;
      return alive
        ? this.passed('process_alive', `进程 ${target} 运行中`, { target })
        : this.failed('process_alive', `进程 ${target} 未运行`, 'service_down', { target });
    }
    return this.skipped('process_alive', `无法检查进程 ${target}`, result.executorAvailable ? 'observation_failure' : 'executor_unavailable');
  }

  private containerCheck(result: CommandExecution, target: string, name: string): Check {
    if (!result.ok) {
      return this.skipped(
        name,
        result.executorAvailable ? `无法检查容器 ${target}` : `Docker executor 不可用，无法检查容器 ${target}`,
        result.executorAvailable ? 'observation_failure' : 'executor_unavailable',
      );
    }
    const line = result.stdout.trim().split('\n').map((value) => value.trim()).find(Boolean);
    if (!line) return this.failed(name, `容器 ${target} 未找到或已停止`, 'service_down', { target, state: 'missing' });
    const [nameValue, state, status] = line.split('|');
    if (state === 'running' || /^Up\b/u.test(status ?? '')) {
      return this.passed(name, `容器 ${nameValue ?? target} 运行中`, { state: state ?? 'running', status: status ?? '' });
    }
    return this.failed(name, `容器 ${nameValue ?? target} 状态异常: ${status ?? state ?? 'unknown'}`, 'service_down', { state, status });
  }

  private async checkContainerHealth(service: ServiceDefinition): Promise<Check> {
    if (!service.container) return this.skipped('container_health', '无容器信息', 'observation_failure');
    const result = await this.execution.executeForService(service, {
      command: 'docker',
      args: ['inspect', '--format', '{{.State.Health.Status}}', service.container.name],
      timeoutMs: service.healthCheck.timeout,
    });
    if (!result.executorAvailable) return this.skipped('container_health', 'Docker executor 不可用', 'executor_unavailable');
    if (!result.ok) return this.skipped('container_health', '容器健康状态检查失败', 'observation_failure');
    const health = result.stdout.trim().toLowerCase();
    if (!health) return this.passed('container_health', '容器运行中（未配置 Docker HEALTHCHECK）', { status: 'none' });
    if (health === 'healthy') return this.passed('container_health', 'Docker HEALTHCHECK 通过', { status: health });
    if (health === 'unhealthy') return this.failed('container_health', 'Docker HEALTHCHECK 失败', 'health_check_failed', { status: health });
    return this.skipped('container_health', `Docker HEALTHCHECK 状态：${health}`, 'observation_failure', { status: health });
  }

  private async checkReachable(service: ServiceDefinition): Promise<Check> {
    const timeoutSeconds = Math.max(1, Math.ceil((service.healthCheck.timeout ?? 8000) / 1000));
    if (service.healthCheck.type === 'http') {
      const result = await this.execution.executeForService(service, {
        command: 'curl',
        args: ['-sS', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', String(timeoutSeconds), service.healthCheck.target],
        timeoutMs: service.healthCheck.timeout,
      });
      if (!result.executorAvailable) return this.skipped('http_reachable', 'HTTP executor 不可用', 'executor_unavailable');
      if (!result.ok) return this.skipped('http_reachable', 'HTTP 检查执行失败', 'observation_failure');
      const code = Number(result.stdout.trim());
      if (Number.isInteger(code) && code >= 200 && code < 400) {
        return this.passed('http_reachable', `HTTP ${code}`, { statusCode: code });
      }
      return this.failed('http_reachable', `HTTP ${Number.isFinite(code) ? code : '无响应'}`, 'health_check_failed', { statusCode: code });
    }

    const [host, port] = service.healthCheck.target.split(':');
    if (!host || !port) return this.skipped('tcp_reachable', 'TCP 目标格式无效', 'observation_failure');
    const result = await this.execution.executeForService(service, {
      command: 'nc',
      args: ['-z', '-w', String(timeoutSeconds), host, port],
      timeoutMs: service.healthCheck.timeout,
    });
    if (!result.executorAvailable) return this.skipped('tcp_reachable', 'TCP executor 不可用', 'executor_unavailable');
    if (result.ok) return this.passed('tcp_reachable', `TCP ${host}:${port} 可达`, { host, port });
    if (result.exitCode === 1) return this.failed('tcp_reachable', `TCP ${host}:${port} 不可达`, 'health_check_failed', { host, port });
    return this.skipped('tcp_reachable', 'TCP 检查执行失败', 'observation_failure', { host, port });
  }

  private async checkDependencies(service: ServiceDefinition): Promise<Check> {
    const failed: string[] = [];
    const unknown: string[] = [];
    for (const dependencyId of service.dependencies) {
      const dependency = this.serviceRegistry.getService(dependencyId);
      if (!dependency) {
        unknown.push(dependencyId);
        continue;
      }
      const check = await this.checkAlive(dependency);
      if (this.hasCause(check, 'service_down')) failed.push(dependencyId);
      else if (check.status !== 'passed') unknown.push(dependencyId);
    }
    if (failed.length) {
      return this.failed('dependencies', `依赖异常: ${failed.join('、')}`, 'service_down', { failed, ...(unknown.length ? { unknown } : {}) });
    }
    if (unknown.length) return this.skipped('dependencies', `依赖状态未知: ${unknown.join('、')}`, 'observation_failure', { unknown });
    return this.passed('dependencies', '依赖正常');
  }

  private async checkResourceUsage(service: ServiceDefinition): Promise<Check> {
    const container = service.container?.name;
    if (!container) return this.skipped('resource_usage', '无容器信息', 'observation_failure');
    const result = await this.execution.executeForService(service, {
      command: 'docker',
      args: ['stats', '--no-stream', '--format', '{{.CPUPerc}}|{{.MemPerc}}', container],
      timeoutMs: service.healthCheck.timeout,
    });
    if (!result.executorAvailable) return this.skipped('resource_usage', 'Docker executor 不可用', 'executor_unavailable');
    if (!result.ok) return this.skipped('resource_usage', '资源检查执行失败', 'observation_failure');
    const match = result.stdout.trim().match(/([\d.]+)%\|([\d.]+)%/u);
    if (!match) return this.skipped('resource_usage', '无法读取资源', 'observation_failure');
    const cpu = Number(match[1]);
    const memory = Number(match[2]);
    const problem = cpu > 90 ? `CPU 使用率 ${cpu}%` : memory > 90 ? `内存使用率 ${memory}%` : undefined;
    return problem
      ? this.failed('resource_usage', problem, 'resource_exceeded', { problem, cpu, memory })
      : this.passed('resource_usage', `CPU ${cpu}% 内存 ${memory}%`, { cpu, memory });
  }

  private async checkRecentLogs(service: ServiceDefinition): Promise<Check> {
    const container = service.container?.name;
    if (!container) return this.skipped('recent_logs', '无容器可查日志', 'observation_failure');
    const result = await this.execution.executeForService(service, {
      command: 'docker',
      args: ['logs', '--tail', '200', container],
      timeoutMs: service.healthCheck.timeout,
    });
    if (!result.executorAvailable) return this.skipped('recent_logs', 'Docker executor 不可用', 'executor_unavailable');
    if (!result.ok) return this.skipped('recent_logs', '日志检查执行失败', 'observation_failure');
    const errors = `${result.stdout}\n${result.stderr}`.split('\n')
      .filter((line) => /error|exception|traceback|fatal|panic/iu.test(line));
    if (!errors.length) return this.passed('recent_logs', '最近日志无错误');
    const sample = errors[0]!.slice(0, 300);
    return this.failed('recent_logs', `最近日志发现错误: ${sample}`, 'log_error', { sample });
  }

  private async checkPollingStaleness(): Promise<Check> {
    try {
      const response = await fetch(`${this.options.runtimeBaseUrl}/homehub/telegram/polling`, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) return this.skipped('polling_staleness', 'runtime 未暴露 polling 指标', 'observation_failure');
      const body = await response.json() as Record<string, unknown>;
      const lastPoll = body.lastSuccessfulPollAt ? Date.parse(String(body.lastSuccessfulPollAt)) : NaN;
      const staleSeconds = Number.isFinite(lastPoll) ? Math.max(0, (Date.now() - lastPoll) / 1000) : -1;
      return {
        name: 'polling_staleness',
        status: staleSeconds > 300 ? 'failed' : 'passed',
        message: staleSeconds > 300
          ? `最后一次成功轮询在 ${Math.round(staleSeconds / 60)} 分钟前`
          : `轮询正常（${staleSeconds < 0 ? '无指标' : `${Math.round(staleSeconds / 60)} 分钟前`}）`,
        timestamp: new Date().toISOString(),
        details: { staleSeconds },
      };
    } catch {
      return this.skipped('polling_staleness', '无法读取 polling 指标', 'observation_failure', { staleSeconds: -1 });
    }
  }

  private async checkTelegramBotApi(): Promise<Check> {
    try {
      const response = await fetch('https://api.telegram.org', { signal: AbortSignal.timeout(8000) });
      return response.ok || response.status < 500
        ? this.passed('bot_api_reachable', 'Bot API 可达', { statusCode: response.status })
        : this.failed('bot_api_reachable', `Bot API HTTP ${response.status}`, 'health_check_failed', { statusCode: response.status });
    } catch {
      return this.skipped('bot_api_reachable', 'Bot API 检查执行失败', 'observation_failure');
    }
  }

  private generateRecommendedActions(service: ServiceDefinition, issues: DiagnosisIssue[]): DiagnosisResult['recommendedActions'] {
    const actions: DiagnosisResult['recommendedActions'] = [];
    const critical = issues.some((issue) => issue.severity === 'critical' && issue.category === 'process');
    const dependency = issues.some((issue) => issue.category === 'dependency');
    const resource = issues.some((issue) => issue.category === 'resource');
    if (critical && service.allowedActions.includes('restart')) {
      actions.push({ action: 'restart', reason: `${service.displayName} 进程异常，重启恢复`, confidence: 0.8, requiresConfirmation: true });
    }
    if (dependency && service.allowedActions.includes('restart')) {
      actions.push({ action: 'restart', reason: '依赖服务恢复后重启主服务', confidence: 0.6, requiresConfirmation: true });
    }
    if (resource && service.allowedActions.includes('restart')) {
      actions.push({ action: 'restart', reason: '资源占用异常，重启释放', confidence: 0.7, requiresConfirmation: true });
    }
    if (resource && service.allowedActions.includes('rotate_logs')) {
      actions.push({ action: 'rotate_logs', reason: '清理日志释放空间', confidence: 0.6, requiresConfirmation: true });
    }
    if (issues.length && !actions.length && service.allowedActions.includes('check')) {
      actions.push({ action: 'check', reason: '进一步人工检查', confidence: 0.4, requiresConfirmation: false });
    }
    return actions;
  }

  private passed(name: string, message: string, details?: CheckDetails): Check {
    return { name, status: 'passed', message, timestamp: new Date().toISOString(), ...(details ? { details } : {}) };
  }

  private failed(name: string, message: string, cause: FailureCause, details: CheckDetails = {}): Check {
    return { name, status: 'failed', message, timestamp: new Date().toISOString(), details: { cause, ...details } };
  }

  private skipped(name: string, message: string, cause: FailureCause, details: CheckDetails = {}): Check {
    return { name, status: 'skipped', message, timestamp: new Date().toISOString(), details: { cause, ...details } };
  }

  private hasCause(check: Check, cause: FailureCause): boolean {
    return check.details?.cause === cause;
  }

  private isUnknownCheck(check: Check): boolean {
    return check.status === 'skipped'
      || this.hasCause(check, 'executor_unavailable')
      || this.hasCause(check, 'observation_failure');
  }

  private isPrimaryUnknownCheck(check: Check): boolean {
    if (!this.isUnknownCheck(check)) return false;
    return ['container_alive', 'component_alive', 'process_alive', 'http_reachable', 'tcp_reachable', 'dependencies'].includes(check.name);
  }

  private createErrorDiagnosis(serviceId: ServiceId, message: string): DiagnosisResult {
    return {
      serviceId,
      status: 'failed',
      issues: [{ severity: 'critical', category: 'external', component: serviceId, message, suggestion: '检查服务注册表与运行环境', actionable: false }],
      checks: [],
      recommendedActions: [],
      timestamp: new Date().toISOString(),
    };
  }
}
