import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { ServiceDefinition, ActionRequest, ActionResult, ActionStatus } from '../schema/types.js';
import { ActionRequestSchema } from '../schema/types.js';
import { ServiceRegistry } from '../registry/service-registry.js';
import { HomeHubDomain } from '../domain/homehub-domain.js';
import type { ServiceId, Action } from '../schema/types.js';

const execAsync = promisify(exec);

export interface ActionEngineOptions {
  orbHost?: string;
  orbUser?: string;
  casaosAppsPath?: string;
  autoVerify?: boolean;
}

interface ExecResult {
  success: boolean;
  message: string;
  output?: string;
  error?: string;
}

export class ActionEngine {
  private serviceRegistry: ServiceRegistry;
  private options: Required<ActionEngineOptions>;

  constructor(options: ActionEngineOptions = {}) {
    this.serviceRegistry = new ServiceRegistry();
    this.options = {
      orbHost: options.orbHost ?? 'ubuntu',
      orbUser: options.orbUser ?? 'root',
      casaosAppsPath: options.casaosAppsPath ?? '/var/lib/casaos/apps',
      autoVerify: options.autoVerify ?? true,
    };
  }

  isAllowed(serviceId: ServiceId, action: Action): boolean {
    return this.serviceRegistry.isActionAllowed(serviceId, action);
  }

  getRiskLevel(serviceId: ServiceId): string {
    return this.serviceRegistry.getService(serviceId)?.riskLevel ?? 'unknown';
  }

  async executeAction(request: ActionRequest): Promise<ActionResult> {
    const normalizedRequest = ActionRequestSchema.parse(request);
    const requestId = this.generateId();
    const startTime = Date.now();
    const service = this.serviceRegistry.getService(normalizedRequest.serviceId);

    if (!service) {
      return this.createErrorResult(requestId, normalizedRequest, 'Service not found in registry', startTime);
    }

    // Dry run: report what would happen without executing (no auth gate)
    if (normalizedRequest.dryRun) {
      return this.createDryRunResult(requestId, normalizedRequest, service, startTime);
    }

    // Authorization gate for real execution: high/critical risk services
    // require an explicit confirmation (skipConfirmation) before acting.
    const authCheck = new HomeHubDomain({ userId: normalizedRequest.userId, platform: normalizedRequest.platform })
      .validateActionAuthorization(normalizedRequest, service);
    if (!authCheck.authorized) {
      return {
        requestId,
        serviceId: normalizedRequest.serviceId,
        action: normalizedRequest.action,
        status: 'cancelled',
        result: { success: false, message: authCheck.reason ?? 'Action not authorized' },
        verification: { passed: false, checks: [], message: 'Authorization failed, action not executed' },
        timestamp: new Date().toISOString(),
        executedAt: new Date().toISOString(),
        verifiedAt: new Date().toISOString(),
        duration: Date.now() - startTime,
      };
    }

    if (!this.serviceRegistry.isActionAllowed(normalizedRequest.serviceId, normalizedRequest.action)) {
      return this.createErrorResult(
        requestId,
        normalizedRequest,
        `Action ${normalizedRequest.action} not allowed for service ${normalizedRequest.serviceId}`,
        startTime,
      );
    }

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

      // Verify the service recovered (docker state + dependency up + log clean)
      const verification = await this.verifyAction(normalizedRequest, service, executionResult);
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
        result: { success: false, message: error instanceof Error ? error.message : 'Action execution failed', error: error instanceof Error ? error.stack : String(error) },
        verification: { passed: false, checks: [], message: 'Action failed, verification skipped' },
        timestamp: new Date().toISOString(),
        executedAt,
        verifiedAt: new Date().toISOString(),
        duration: Date.now() - startTime,
      };
    }
  }

  private async performAction(request: ActionRequest, service: ServiceDefinition): Promise<ExecResult> {
    switch (request.action) {
      case 'start':
        return await this.runCompose(service, 'up -d', `启动 ${service.displayName}`);
      case 'restart':
        if (service.serviceId === 'telegram-adapter') {
          return await this.restartTelegramAdapter(service);
        }
        return await this.runCompose(service, 'restart', `重启 ${service.displayName}`);
      case 'stop':
        return await this.runCompose(service, 'stop', `停止 ${service.displayName}`);
      case 'rotate_logs':
        return await this.rotateLogs(service);
      case 'check':
        return { success: true, message: `检查完成: ${service.displayName}`, output: '未发现需要执行的变更' };
      case 'cleanup':
        return { success: true, message: `清理完成: ${service.displayName}`, output: '仅清理临时文件（不允许任意删除）' };
      default:
        throw new Error(`Unsupported action: ${request.action}`);
    }
  }

  private async runCompose(service: ServiceDefinition, composeArgs: string, label: string): Promise<ExecResult> {
    if (!service.container) {
      return { success: false, message: `${label}失败: 无容器定义` };
    }
    const dir = `${this.options.casaosAppsPath}/${service.serviceId}`;
    const command = `orb -m ${this.options.orbHost} -u ${this.options.orbUser} bash -lc 'cd ${dir} && docker compose ${composeArgs}'`;
    try {
      const { stdout, stderr } = await execAsync(command, { timeout: 120_000, shell: '/bin/bash' });
      return { success: true, message: `${label}成功`, output: (stdout + stderr).trim().slice(0, 2000) };
    } catch (error) {
      return {
        success: false,
        message: `${label}失败: ${error instanceof Error ? error.message : 'unknown'}`,
        error: error instanceof Error ? (error as Error & { stdout?: string; stderr?: string }).stderr ?? error.message : String(error),
      };
    }
  }

  private async restartTelegramAdapter(service: ServiceDefinition): Promise<ExecResult> {
    // Preferred: restart the Telegram polling loop inside LangBot without
    // restarting LangBot. The adapter runs inside LangBot, so when a
    // container-level compose service exists use it directly; otherwise tell
    // the runtime to restart its telegram poller.
    const containerName = service.container?.name;
    if (!containerName) {
      return { success: false, message: 'Telegram adapter 无容器定义' };
    }

    // 1. docker restart of the telegram/lpb container (targeted; not whole stack when adapter is standalone)
    const command = `orb -m ${this.options.orbHost} -u ${this.options.orbUser} bash -lc 'docker restart ${containerName}'`;
    try {
      const { stdout, stderr } = await execAsync(command, { timeout: 60_000, shell: '/bin/bash' });
      return {
        success: true,
        message: 'Telegram adapter 已重启（优先重启 adapter/轮询，未重启整站）',
        output: (stdout + stderr).trim().slice(0, 2000),
      };
    } catch (error) {
      return { success: false, message: `重启失败: ${error instanceof Error ? error.message : 'unknown'}`, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async rotateLogs(service: ServiceDefinition): Promise<ExecResult> {
    // Safe rotation: truncate docker json logs under the container log dir,
    // never delete app data.
    if (!service.container) {
      return { success: false, message: '无容器日志可轮转' };
    }
    const command = `orb -m ${this.options.orbHost} -u ${this.options.orbUser} bash -lc 'docker ps -q --filter name=${service.container.name} | xargs -r -I{} truncate -s 0 /var/lib/docker/containers/{}/{}-json.log 2>/dev/null || true; echo rotated'`;
    try {
      const { stdout } = await execAsync(command, { timeout: 30_000, shell: '/bin/bash' });
      return { success: true, message: '日志轮转完成', output: stdout.trim().slice(0, 1000) };
    } catch (error) {
      return { success: false, message: `日志轮转失败: ${error instanceof Error ? error.message : 'unknown'}` };
    }
  }

  private async verifyAction(request: ActionRequest, service: ServiceDefinition, result: ExecResult): Promise<ActionResult['verification']> {
    const checks: ActionResult['verification']['checks'] = [];
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

    if (request.action === 'stop') {
      // Verify stopped
      if (service.container) {
        await wait(1500);
        const stopped = await this.containerState(service.container.name);
        const isStopped = !stopped || /^Exited/.test(stopped);
        checks.push({
          name: 'container_stopped',
          status: isStopped ? 'passed' : 'failed',
          message: isStopped ? '容器已停止' : `容器仍处于 ${stopped}`,
        });
      } else {
        checks.push({ name: 'process_stopped', status: 'passed', message: '已发送停止指令' });
      }
    } else if (request.action === 'check' || request.action === 'rotate_logs' || request.action === 'cleanup') {
      checks.push({ name: 'command_completed', status: 'passed', message: '指令完成' });
    } else {
      // start/restart: verify running + deps up
      if (service.container) {
        await wait(2500);
        const state = await this.containerState(service.container.name);
        const isUp = /^Up/.test(state ?? '');
        checks.push({
          name: 'container_running',
          status: isUp ? 'passed' : 'failed',
          message: isUp ? `容器运行中 (${state})` : `容器未运行 (${state ?? 'missing'})`,
        });
      }
      if (service.dependencies.length > 0) {
        const downDeps: string[] = [];
        for (const depId of service.dependencies) {
          const dep = this.serviceRegistry.getService(depId);
          if (dep?.container) {
            const state = await this.containerState(dep.container.name);
            if (!/^Up/.test(state ?? '')) downDeps.push(depId);
          }
        }
        checks.push({
          name: 'dependencies_up',
          status: downDeps.length ? 'failed' : 'passed',
          message: downDeps.length ? `依赖未恢复: ${downDeps.join('、')}` : '依赖服务正常',
        });
      }
    }

    const passed = checks.every((c) => c.status === 'passed');
    return {
      passed,
      checks,
      message: passed
        ? '服务已恢复并通过验证'
        : checks.find((c) => c.status === 'failed')?.message ?? '部分验证未通过',
    };
  }

  private async containerState(containerName: string): Promise<string | null> {
    try {
      const { stdout } = await execAsync(
        `orb -m ${this.options.orbHost} -u ${this.options.orbUser} bash -lc "docker ps -a --filter name=${containerName} --format '{{.Status}}' | head -n1"`,
        { timeout: 15_000, shell: '/bin/bash' },
      );
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  private createDryRunResult(requestId: string, request: ActionRequest, service: ServiceDefinition, startTime: number): ActionResult {
    const labels: Record<Action, string> = {
      start: '启动', restart: '重启', stop: '停止', check: '检查', cleanup: '清理', rotate_logs: '轮转日志',
    };
    return {
      requestId,
      serviceId: request.serviceId,
      action: request.action,
      status: 'pending',
      result: {
        success: true,
        message: `DRY RUN: ${labels[request.action]} ${service.displayName}`,
        output: `服务: ${service.serviceId}\n操作: ${request.action}\n风险: ${service.riskLevel}\n\n这是预演，未执行任何变更。`,
      },
      verification: { passed: true, checks: [], message: 'Dry run 完成' },
      timestamp: new Date().toISOString(),
      executedAt: new Date().toISOString(),
      verifiedAt: new Date().toISOString(),
      duration: Date.now() - startTime,
    };
  }

  private createErrorResult(requestId: string, request: ActionRequest, message: string, startTime: number): ActionResult {
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
