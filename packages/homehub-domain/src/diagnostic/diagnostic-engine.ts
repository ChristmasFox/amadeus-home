import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  ServiceDefinition,
  ServiceId,
  ServiceHealth,
  HealthResult,
  DiagnosisResult,
  DiagnosisIssue,
  DiagnosisStatus,
  Action,
} from '../schema/types.js';
import { ServiceRegistry } from '../registry/service-registry.js';
import { HostCollector } from '../registry/host-collector.js';

const execAsync = promisify(exec);

export interface DiagnosticEngineOptions {
  orbHost?: string;
  orbUser?: string;
  casaosAppsPath?: string;
  embyApiKey?: string;
  runtimeBaseUrl?: string;
}

export class DiagnosticEngine {
  private serviceRegistry: ServiceRegistry;
  private options: Required<DiagnosticEngineOptions>;
  private collector: HostCollector;

  constructor(options: DiagnosticEngineOptions = {}) {
    this.serviceRegistry = new ServiceRegistry();
    this.options = {
      orbHost: options.orbHost ?? 'ubuntu',
      orbUser: options.orbUser ?? 'root',
      casaosAppsPath: options.casaosAppsPath ?? '/var/lib/casaos/apps',
      embyApiKey: options.embyApiKey ?? '',
      runtimeBaseUrl: options.runtimeBaseUrl ?? 'http://localhost:5310',
    };
    this.collector = new HostCollector({ orbHost: this.options.orbHost, orbUser: this.options.orbUser });
  }

  get registry(): ServiceRegistry {
    return this.serviceRegistry;
  }

  /**
   * Aggregate system health across all registered services.
   */
  async systemHealth(platform = 'kook'): Promise<HealthResult> {
    const host = await this.collector.collect();
    const serviceDefs = this.serviceRegistry.getAllServices();
    const services: ServiceHealth[] = [];

    for (const def of serviceDefs) {
      services.push(await this.checkServiceHealth(def));
    }

    const summary = {
      totalServices: services.length,
      healthy: services.filter((s) => s.status === 'healthy').length,
      degraded: services.filter((s) => s.status === 'degraded').length,
      unhealthy: services.filter((s) => s.status === 'unhealthy').length,
      unknown: services.filter((s) => s.status === 'unknown').length,
    };

    const abnormal = services
      .filter((s) => s.status === 'degraded' || s.status === 'unhealthy')
      .map((s) => s.serviceId);

    const diagnosis = this.diagnoseSystem(summary.healthy, summary.totalServices, abnormal.length);

    return {
      host,
      services,
      summary,
      abnormal,
      diagnosis,
      timestamp: new Date().toISOString(),
    };
  }

  private diagnoseSystem(healthy: number, total: number, abnormal: number): string {
    if (abnormal === 0 && total > 0 && healthy === total) return '系统运行正常';
    if (abnormal > 0) {
      return `有 ${abnormal} 个服务异常，其余 ${healthy}/${total} 个服务正常`;
    }
    return `服务状态未知（${healthy}/${total} 正常）`;
  }

  /**
   * Check a single service health and return a ServiceHealth.
   */
  async checkServiceHealth(def: ServiceDefinition): Promise<ServiceHealth> {
    const result = await this.diagnose(def.serviceId);
    const status = result.status === 'resolved'
      ? 'healthy'
      : result.issues.some((i) => i.severity === 'critical' || i.severity === 'error')
        ? 'unhealthy'
        : result.status === 'failed' ? 'unknown' : 'degraded';

    return {
      serviceId: def.serviceId,
      status,
      lastCheck: new Date().toISOString(),
      message: result.checks.find((c) => c.status === 'failed')?.message
        ?? result.issues[0]?.message
        ?? '运行正常',
      checks: result.checks.map((c) => ({
        name: c.name,
        status: c.status === 'passed' ? 'healthy' : c.status === 'failed' ? 'unhealthy' : 'unknown',
        message: c.message,
        timestamp: c.timestamp,
      })),
    };
  }

  async diagnose(serviceId: ServiceId): Promise<DiagnosisResult> {
    const service = this.serviceRegistry.getService(serviceId);
    if (!service) {
      return this.createErrorDiagnosis(serviceId, 'Service not found in registry');
    }

    const checks: DiagnosisResult['checks'] = [];
    const issues: DiagnosisIssue[] = [];

    // 1. Container/process alive
    const aliveCheck = await this.checkAlive(service);
    checks.push(aliveCheck);
    if (aliveCheck.status === 'failed') {
      issues.push({
        severity: 'critical',
        category: 'process',
        component: service.serviceId,
        message: `${service.displayName} 未运行（${aliveCheck.message}）`,
        suggestion: `尝试重启 ${service.displayName}`,
        actionable: true,
      });
    }

    // 2. HTTP/TCP endpoint reachable (when applicable)
    if (aliveCheck.status === 'passed' && (service.healthCheck.type === 'http' || service.healthCheck.type === 'tcp')) {
      const reachable = await this.checkReachable(service);
      checks.push(reachable);
      if (reachable.status === 'failed') {
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

    // 3. Dependencies
    if (service.dependencies.length > 0) {
      const dependencyCheck = await this.checkDependencies(service);
      checks.push(dependencyCheck);
      if (dependencyCheck.status === 'failed') {
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

    // 4. Resource usage (CPU/mem by container)
    if (service.container) {
      const resourceCheck = await this.checkResourceUsage(service);
      checks.push(resourceCheck);
      if (resourceCheck.status === 'failed') {
        issues.push({
          severity: 'warning',
          category: 'resource',
          component: service.serviceId,
          message: String(resourceCheck.details?.problem ?? '资源占用异常'),
          suggestion: '重启服务释放资源',
          actionable: true,
        });
      }
    }

    // 5. Recent logs scan
    if (aliveCheck.status === 'passed') {
      const logCheck = await this.checkRecentLogs(service);
      checks.push(logCheck);
      if (logCheck.status === 'failed') {
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

    const status: DiagnosisStatus = issues.length === 0
      ? 'resolved'
      : issues.some((i) => i.severity === 'critical') ? 'diagnosed' : 'uncertain';

    return {
      serviceId,
      status,
      issues,
      checks,
      recommendedActions: this.generateRecommendedActions(service, issues),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Specialized Telegram polling diagnosis used by the V1 self-healing flow.
   */
  async diagnoseTelegramPolling(): Promise<DiagnosisResult> {
    const service = this.serviceRegistry.getService('telegram-adapter');
    if (!service) {
      return this.createErrorDiagnosis('telegram-adapter', 'Telegram adapter not in registry');
    }

    const checks: DiagnosisResult['checks'] = [];
    const issues: DiagnosisIssue[] = [];

    // 1. Adapter container/process alive
    const aliveCheck = await this.checkAlive(service);
    checks.push(aliveCheck);
    if (aliveCheck.status === 'failed') {
      issues.push({
        severity: 'critical',
        category: 'process',
        component: 'telegram-adapter',
        message: 'Telegram adapter 进程未运行',
        suggestion: '重启 Telegram adapter',
        actionable: true,
      });
    }

    // 2. LangBot host up (adapter runs inside LangBot)
    const langbot = this.serviceRegistry.getService('langbot');
    if (langbot) {
      const langbotCheck = await this.checkAlive(langbot);
      checks.push({ ...langbotCheck, name: 'langbot_host' });
      if (langbotCheck.status === 'failed') {
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

    // 3. Polling staleness via runtime health endpoint
    const pollCheck = await this.checkPollingStaleness();
    checks.push(pollCheck);
    const staleSeconds = pollCheck.details?.staleSeconds;
    if (typeof staleSeconds === 'number' && staleSeconds > 0) {
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

    // 4. Bot API reachability
    if (aliveCheck.status === 'passed') {
      const apiCheck = await this.checkTelegramBotApi();
      checks.push(apiCheck);
      if (apiCheck.status === 'failed') {
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

    const status: DiagnosisStatus = issues.length === 0
      ? 'resolved'
      : issues.some((i) => i.severity === 'critical') ? 'diagnosed' : 'uncertain';

    const recommendedActions = issues.some((i) => i.category === 'connectivity' && i.severity === 'critical')
      ? [{
          action: 'restart' as Action,
          reason: 'Telegram polling stale，重启 adapter 可恢复轮询',
          confidence: 0.85,
          requiresConfirmation: false,
        }]
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

  private async checkAlive(service: ServiceDefinition): Promise<DiagnosisResult['checks'][0]> {
    const target = service.container?.name
      ?? service.process?.name
      ?? service.serviceId;

    try {
      if (service.container) {
        const { stdout } = await execAsync(
          `orb -m ${this.options.orbHost} -u ${this.options.orbUser} bash -lc "docker ps --filter name=${target} --format '{{.Names}}|{{.Status}}' | head -n1"`,
          { timeout: 15_000, shell: '/bin/bash' },
        );
        const line = stdout.trim();
        if (!line) {
          return { name: 'container_alive', status: 'failed', message: `容器 ${target} 未运行`, timestamp: new Date().toISOString() };
        }
        const [name, state] = line.split('|');
        if (/^Up/.test(state ?? '')) {
          return { name: 'container_alive', status: 'passed', message: `容器 ${name} 运行中`, timestamp: new Date().toISOString(), details: { state } };
        }
        return { name: 'container_alive', status: 'failed', message: `容器 ${name} 状态异常: ${state}`, timestamp: new Date().toISOString(), details: { state } };
      }

      const { stdout } = await execAsync(
        `orb -m ${this.options.orbHost} -u ${this.options.orbUser} bash -lc "pgrep -f ${target} >/dev/null && echo alive || echo dead"`,
        { timeout: 10_000, shell: '/bin/bash' },
      );
      const alive = stdout.trim() === 'alive';
      return {
        name: 'process_alive',
        status: alive ? 'passed' : 'failed',
        message: alive ? `进程 ${target} 运行中` : `进程 ${target} 未运行`,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        name: 'container_alive',
        status: 'failed',
        message: `无法检查容器状态: ${error instanceof Error ? error.message : 'unknown'}`,
        timestamp: new Date().toISOString(),
      };
    }
  }

  private async checkReachable(service: ServiceDefinition): Promise<DiagnosisResult['checks'][0]> {
    if (service.healthCheck.type === 'http') {
      try {
        const response = await fetch(service.healthCheck.target, {
          signal: AbortSignal.timeout(service.healthCheck.timeout ?? 8000),
        });
        if (response.ok) {
          return { name: 'http_reachable', status: 'passed', message: `HTTP ${response.status}`, timestamp: new Date().toISOString() };
        }
        return { name: 'http_reachable', status: 'failed', message: `HTTP ${response.status} ${response.statusText}`, timestamp: new Date().toISOString() };
      } catch (error) {
        return { name: 'http_reachable', status: 'failed', message: `HTTP 不可达: ${error instanceof Error ? error.message : 'timeout'}`, timestamp: new Date().toISOString() };
      }
    }

    // TCP reachability via host bash
    const [host, port] = service.healthCheck.target.split(':');
    try {
      const { stdout } = await execAsync(
        `orb -m ${this.options.orbHost} -u ${this.options.orbUser} bash -lc "timeout 5 bash -c 'echo > /dev/tcp/${host}/${port}' >/dev/null 2>&1 && echo open || echo closed"`,
        { timeout: 10_000, shell: '/bin/bash' },
      );
      const open = stdout.trim() === 'open';
      return { name: 'tcp_reachable', status: open ? 'passed' : 'failed', message: open ? `TCP ${host}:${port} 可达` : `TCP ${host}:${port} 不可达`, timestamp: new Date().toISOString() };
    } catch (error) {
      return { name: 'tcp_reachable', status: 'failed', message: `TCP 检查失败: ${error instanceof Error ? error.message : 'unknown'}`, timestamp: new Date().toISOString() };
    }
  }

  private async checkDependencies(service: ServiceDefinition): Promise<DiagnosisResult['checks'][0]> {
    const failed: string[] = [];
    for (const depId of service.dependencies) {
      const dep = this.serviceRegistry.getService(depId);
      if (!dep) { failed.push(depId); continue; }
      const check = await this.checkAlive(dep);
      if (check.status === 'failed') failed.push(depId);
    }
    return failed.length
      ? { name: 'dependencies', status: 'failed', message: `依赖异常: ${failed.join('、')}`, timestamp: new Date().toISOString(), details: { failed } }
      : { name: 'dependencies', status: 'passed', message: '依赖正常', timestamp: new Date().toISOString() };
  }

  private async checkResourceUsage(service: ServiceDefinition): Promise<DiagnosisResult['checks'][0]> {
    const container = service.container?.name;
    if (!container) return { name: 'resource_usage', status: 'skipped', message: '无容器信息', timestamp: new Date().toISOString() };

    try {
      const { stdout } = await execAsync(
        `orb -m ${this.options.orbHost} -u ${this.options.orbUser} docker stats --no-stream --format '{{.CPUPerc}}|{{.MemPerc}}' ${container}`,
        { timeout: 15_000, shell: '/bin/bash' },
      );
      const line = stdout.trim();
      const match = line.match(/([\d.]+)%\|([\d.]+)%/);
      if (!match) return { name: 'resource_usage', status: 'skipped', message: '无法读取资源', timestamp: new Date().toISOString() };
      const cpu = Number(match[1]);
      const mem = Number(match[2]);
      const problem = cpu > 90 ? `CPU 使用率 ${cpu}%` : mem > 90 ? `内存使用率 ${mem}%` : undefined;
      return problem
        ? { name: 'resource_usage', status: 'failed', message: problem, timestamp: new Date().toISOString(), details: { problem, cpu, mem } }
        : { name: 'resource_usage', status: 'passed', message: `CPU ${cpu}% 内存 ${mem}%`, timestamp: new Date().toISOString(), details: { cpu, mem } };
    } catch {
      return { name: 'resource_usage', status: 'skipped', message: '资源检查不可用', timestamp: new Date().toISOString() };
    }
  }

  private async checkRecentLogs(service: ServiceDefinition): Promise<DiagnosisResult['checks'][0]> {
    const container = service.container?.name;
    if (!container) return { name: 'recent_logs', status: 'skipped', message: '无容器可查日志', timestamp: new Date().toISOString() };

    try {
      const { stdout } = await execAsync(
        `orb -m ${this.options.orbHost} -u ${this.options.orbUser} docker logs --tail 200 ${container} 2>&1 | grep -iE 'error|exception|traceback|fatal|panic' | tail -n 5`,
        { timeout: 15_000, shell: '/bin/bash' },
      );
      if (!stdout.trim()) {
        return { name: 'recent_logs', status: 'passed', message: '最近日志无错误', timestamp: new Date().toISOString() };
      }
      const firstLine = stdout.trim().split('\n')[0] ?? '未知错误';
      return { name: 'recent_logs', status: 'failed', message: `最近日志发现错误: ${firstLine.slice(0, 300)}`, timestamp: new Date().toISOString(), details: { sample: firstLine.slice(0, 300) } };
    } catch {
      return { name: 'recent_logs', status: 'skipped', message: '日志检查不可用', timestamp: new Date().toISOString() };
    }
  }

  private async checkPollingStaleness(): Promise<DiagnosisResult['checks'][0]> {
    // Ask the agent runtime for Telegram polling health. The runtime exposes
    // /homehub/telegram/polling with lastSuccessfulPollAt when available.
    try {
      const response = await fetch(`${this.options.runtimeBaseUrl}/homehub/telegram/polling`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        return { name: 'polling_staleness', status: 'skipped', message: 'runtime 未暴露 polling 指标', timestamp: new Date().toISOString() };
      }
      const body = await response.json() as Record<string, unknown>;
      const lastPoll = body.lastSuccessfulPollAt ? Date.parse(String(body.lastSuccessfulPollAt)) : NaN;
      const staleSeconds = Number.isFinite(lastPoll)
        ? Math.max(0, (Date.now() - lastPoll) / 1000)
        : -1;

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
      return { name: 'polling_staleness', status: 'skipped', message: '无法读取 polling 指标', timestamp: new Date().toISOString(), details: { staleSeconds: -1 } };
    }
  }

  private async checkTelegramBotApi(): Promise<DiagnosisResult['checks'][0]> {
    try {
      const response = await fetch('https://api.telegram.org', { signal: AbortSignal.timeout(8000) });
      return response.ok || response.status < 500
        ? { name: 'bot_api_reachable', status: 'passed', message: 'Bot API 可达', timestamp: new Date().toISOString() }
        : { name: 'bot_api_reachable', status: 'failed', message: `Bot API HTTP ${response.status}`, timestamp: new Date().toISOString() };
    } catch {
      return { name: 'bot_api_reachable', status: 'failed', message: 'Bot API 不可达', timestamp: new Date().toISOString() };
    }
  }

  private generateRecommendedActions(
    service: ServiceDefinition,
    issues: DiagnosisIssue[],
  ): DiagnosisResult['recommendedActions'] {
    const actions: DiagnosisResult['recommendedActions'] = [];
    const critical = issues.some((i) => i.severity === 'critical' && i.category === 'process');
    const dependency = issues.some((i) => i.category === 'dependency');
    const resource = issues.some((i) => i.category === 'resource');

    if (critical && service.allowedActions.includes('restart')) {
      actions.push({
        action: 'restart',
        reason: `${service.displayName} 进程异常，重启恢复`,
        confidence: 0.8,
        requiresConfirmation: service.riskLevel === 'high' || service.riskLevel === 'critical',
      });
    }
    if (dependency && service.allowedActions.includes('restart')) {
      actions.push({
        action: 'restart',
        reason: '依赖服务恢复后重启主服务',
        confidence: 0.6,
        requiresConfirmation: true,
      });
    }
    if (resource && service.allowedActions.includes('restart')) {
      actions.push({
        action: 'restart',
        reason: '资源占用异常，重启释放',
        confidence: 0.7,
        requiresConfirmation: service.riskLevel === 'high' || service.riskLevel === 'critical',
      });
    }
    if (resource && service.allowedActions.includes('rotate_logs')) {
      actions.push({ action: 'rotate_logs', reason: '清理日志释放空间', confidence: 0.6, requiresConfirmation: false });
    }
    if (issues.length && !actions.length && service.allowedActions.includes('check')) {
      actions.push({ action: 'check', reason: '进一步人工检查', confidence: 0.4, requiresConfirmation: false });
    }
    return actions;
  }

  private createErrorDiagnosis(serviceId: string, message: string): DiagnosisResult {
    return {
      serviceId: serviceId as ServiceId,
      status: 'failed',
      issues: [{
        severity: 'critical',
        category: 'external',
        component: serviceId,
        message,
        suggestion: '检查服务注册表与运行环境',
        actionable: false,
      }],
      checks: [],
      recommendedActions: [],
      timestamp: new Date().toISOString(),
    };
  }
}
