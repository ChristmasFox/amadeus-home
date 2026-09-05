import type {
  ServiceDefinition,
  HealthResult,
  DiagnosisResult,
  ActionRequest,
  ActionResult,
  HomeHubContext,
  AuditEntry,
  HomeHubQuery
} from '../schema/types.js';
import { ActionRequestSchema } from '../schema/types.js';
import {
  AuthorizationCore,
  identityFromParts,
  type AuthorizationIdentityLike,
} from '../authorization/authorization-core.js';

export interface HomeHubDomainOptions {
  userId: string;
  platform: string;
  sessionId?: string;
}

export class HomeHubDomain {
  private readonly userId: string;
  private readonly platform: string;
  private sessionId: string;
  private readonly authorizationCore: AuthorizationCore;

  constructor(options: HomeHubDomainOptions) {
    this.userId = options.userId;
    this.platform = options.platform;
    this.sessionId = options.sessionId ?? this.generateSessionId();
    this.authorizationCore = new AuthorizationCore();
  }

  private generateSessionId(): string {
    return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Parse and validate natural language query
   */
  parseQuery(text: string): HomeHubQuery {
    const queryType = this.detectQueryType(text);
    const serviceId = this.extractServiceId(text);

    return {
      queryId: this.generateId(),
      queryType,
      text,
      userId: this.userId,
      platform: this.platform,
      serviceId,
      timestamp: new Date().toISOString(),
    };
  }

  private detectQueryType(text: string): HomeHubQuery['queryType'] {
    const lowerText = text.toLowerCase();

    if (lowerText.includes('重启') || lowerText.includes('启动') || lowerText.includes('停止') ||
        lowerText.includes('restart') || lowerText.includes('start') || lowerText.includes('stop')) {
      return 'action';
    }

    if (/(?:整理|刮削|改名|下载好了|下载目录|媒体整理|emby识别)/.test(lowerText)) {
      return 'media';
    }

    if (/(?:怎么样|什么情况|状态|正常吗|是否正常|还好吗|运行情况)/.test(lowerText)) {
      return 'status';
    }

    if (/(?:为什么|怎么了|怎么(?:不|没|又|总|还)|故障|异常|出问题|挂了|不回复|不响应|打不开|连不上|diagnose|troubleshoot)/.test(lowerText)) {
      return 'diagnosis';
    }

    if (lowerText.includes('日志') || lowerText.includes('历史') || lowerText.includes('记录') ||
        lowerText.includes('log') || lowerText.includes('history')) {
      return 'history';
    }

    return 'status';
  }

  private extractServiceId(text: string): ServiceDefinition['serviceId'] | undefined {
    const lowerText = text.toLowerCase();

    const servicePatterns: Record<string, RegExp> = {
      'langbot': /langbot|机器人/,
      'telegram-adapter': /telegram|tg|电报/,
      'kook-adapter': /kook|开黑/,
      'mastra-pubg-runtime': /pubg|chicken|鸡|runtime|运行时/,
      'n8n': /n8n|workflow/,
      'postgres': /postgres|postgresql|数据库/,
      'redis': /redis|缓存/,
      'emby': /emby|媒体|电影|剧集/,
      'jellyfin': /jellyfin/,
      'qbittorrent': /qb|qbit|种子|下载/,
      'aria2': /aria2|下载/,
      'glances': /glances|监控|指标/,
      'cloudflared': /cloudflare|tunnel|隧道/,
    };

    for (const [serviceId, pattern] of Object.entries(servicePatterns)) {
      if (pattern.test(lowerText)) {
        return serviceId as ServiceDefinition['serviceId'];
      }
    }

    return undefined;
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Update context with operation results
   */
  updateContext(context: HomeHubContext, update: Partial<HomeHubContext>): HomeHubContext {
    return {
      ...context,
      ...update,
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Create audit entry
   */
  createAuditEntry(
    request: ActionRequest,
    result: ActionResult,
    verificationPassed: boolean,
    identity?: AuthorizationIdentityLike,
  ): AuditEntry {
    const normalizedRequest = ActionRequestSchema.parse(request);
    const platformUserId = normalizedRequest.platformUserId ?? normalizedRequest.userId;
    const internalUser = identity ? identity.internalUserId ?? identity.internalIdentity?.internalUserId ?? null : null;
    const roles = identity?.roles ?? ['PUBLIC'];
    const role = roles.includes('ADMIN') ? 'ADMIN' : roles.includes('TRUSTED') ? 'TRUSTED' : 'PUBLIC';
    return {
      id: this.generateId(),
      userId: platformUserId,
      platform: normalizedRequest.platform,
      platformUserId,
      internalUser,
      role,
      chatId: normalizedRequest.chatId ?? 'unknown-chat',
      target: normalizedRequest.target ?? null,
      authorized: result.status !== 'cancelled',
      denied: result.status === 'cancelled',
      serviceId: normalizedRequest.serviceId,
      action: normalizedRequest.action,
      request: normalizedRequest,
      result,
      status: result.status,
      timestamp: result.timestamp,
      duration: result.duration,
      verificationPassed,
    };
  }

  /** Validate action authorization through the shared policy core. */
  validateActionAuthorization(
    request: ActionRequest,
    serviceDefinition: ServiceDefinition,
    identity?: AuthorizationIdentityLike,
  ) {
    const normalized = ActionRequestSchema.parse(request);
    const subject = identity ?? identityFromParts(
      normalized.platform,
      normalized.platformUserId ?? normalized.userId,
      null,
      ['PUBLIC'],
    );
    return this.authorizationCore.authorize({
      identity: subject,
      action: normalized.action,
      service: serviceDefinition,
      confirmed: normalized.confirmed,
    });
  }

  /**
   * Format health result for natural language response
   */
  formatHealthResult(result: HealthResult): string {
    const lines: string[] = [];

    lines.push(`📊 **系统状态摘要**`);
    lines.push(`主机: ${result.host.hostname} | 运行时间: ${this.formatUptime(result.host.uptime)}`);
    lines.push(`服务: ${result.summary.healthy}/${result.summary.totalServices} 正常（${result.summary.unknown} 个未知）`);

    if (result.abnormal.length > 0) {
      lines.push(`\n⚠️ **异常服务**: ${result.abnormal.map(s => s).join(', ')}`);
    } else if (result.summary.unknown > 0) {
      lines.push(`\n❓ **未知服务**: ${result.summary.unknown}`);
    }

    lines.push(`\n🔍 **诊断**: ${result.diagnosis}`);

    if (typeof result.host.cpu.usage === 'number' && result.host.cpu.usage > 80) {
      lines.push(`\n⚠️ CPU 使用率较高: ${result.host.cpu.usage.toFixed(1)}%`);
    }

    if (typeof result.host.memory.percentage === 'number' && result.host.memory.percentage > 80) {
      lines.push(`⚠️ 内存使用率较高: ${result.host.memory.percentage.toFixed(1)}%`);
    }

    for (const disk of result.host.disk) {
      if (typeof disk.percentage === 'number' && disk.percentage > 90) {
        lines.push(`⚠️ 磁盘空间不足 (${disk.mount}): ${disk.percentage.toFixed(1)}%`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Format diagnosis result for natural language response
   */
  formatDiagnosisResult(result: DiagnosisResult): string {
    const lines: string[] = [];

    const statusEmojis: Record<DiagnosisResult['status'], string> = {
      investigating: '🔍',
      diagnosed: '📋',
      resolved: '✅',
      uncertain: '❓',
      failed: '❌',
    };

    lines.push(`${statusEmojis[result.status]} **服务诊断**: ${result.serviceId}`);

    if (result.issues.length > 0) {
      lines.push(`\n**发现的问题:`);
      for (const issue of result.issues) {
        const severityEmojis = { info: 'ℹ️', warning: '⚠️', error: '❌', critical: '🚨' };
        lines.push(`${severityEmojis[issue.severity]} ${issue.category}: ${issue.message}`);
        if (issue.suggestion) {
          lines.push(`  💡 建议: ${issue.suggestion}`);
        }
      }
    } else {
      lines.push(`\n✅ 未发现明显问题`);
    }

    if (result.recommendedActions.length > 0) {
      lines.push(`\n**推荐操作:`);
      for (const rec of result.recommendedActions) {
        const confidence = Math.round(rec.confidence * 100);
        lines.push(`• ${rec.action}: ${rec.reason} (信心: ${confidence}%)`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Format action result for natural language response
   */
  formatActionResult(result: ActionResult): string {
    const lines: string[] = [];

    const statusEmojis: Record<ActionResult['status'], string> = {
      pending: '⏳',
      authorized: '✅',
      executing: '🔄',
      success: '✅',
      failed: '❌',
      cancelled: '⚠️',
    };

    lines.push(`${statusEmojis[result.status]} **操作结果**: ${result.serviceId} - ${result.action}`);

    if (result.result.success) {
      lines.push(`✅ ${result.result.message}`);
    } else {
      lines.push(`❌ ${result.result.message}`);
    }

    if (result.result.output) {
      lines.push(`\n**输出:`);
      lines.push(`\`\`\``);
      lines.push(result.result.output);
      lines.push(`\`\`\``);
    }

    if (result.result.error) {
      lines.push(`\n**错误:`);
      lines.push(`\`\`\``);
      lines.push(result.result.error);
      lines.push(`\`\`\``);
    }

    lines.push(`\n**验证状态:** ${result.verification.passed ? '✅ 通过' : '❌ 未通过'}`);
    lines.push(result.verification.message);

    lines.push(`\n⏱️ 耗时: ${(result.duration / 1000).toFixed(2)}秒`);

    return lines.join('\n');
  }

  private formatUptime(seconds: number | null): string {
    if (seconds === null) return '未知';
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (days > 0) return `${days}天${hours}小时`;
    if (hours > 0) return `${hours}小时${minutes}分钟`;
    return `${minutes}分钟`;
  }

  /**
   * Render a single-service health text from a DiagnosisResult (used by
   * the entry layer when a user asks about one service).
   */
  formatHealthForService(result: DiagnosisResult, displayName: string): string {
    const lines: string[] = [];
    if (result.status === 'failed' && result.issues.length === 0) {
      lines.push(`❓ **${displayName}** 状态未知`);
      for (const check of result.checks.filter((item) => item.status === 'skipped').slice(0, 3)) {
        lines.push(`❓ ${check.message}`);
      }
      return lines.join('\n');
    }
    if (result.issues.length === 0 && result.status === 'resolved') {
      lines.push(`✅ **${displayName}** 正常`);
      return lines.join('\n');
    }
    const top = result.issues[0];
    lines.push(`${top?.severity === 'critical' || top?.severity === 'error' ? '❌' : '⚠️'} **${displayName}** 异常`);
    for (const issue of result.issues.slice(0, 5)) {
      const icon = { info: 'ℹ️', warning: '⚠️', error: '❌', critical: '🚨' }[issue.severity];
      lines.push(`${icon} ${issue.message}`);
    }
    return lines.join('\n');
  }

}

// Export type for schema validation
export type { ServiceDefinition, HealthResult, DiagnosisResult, ActionRequest, ActionResult, HomeHubContext, AuditEntry, HomeHubQuery };
