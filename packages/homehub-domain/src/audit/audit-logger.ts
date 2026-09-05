import type { AuditEntry, ActionRequest, ActionResult, Role } from '../schema/types.js';
import { ActionRequestSchema } from '../schema/types.js';
import type { AuthorizationIdentityLike } from '../authorization/authorization-core.js';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

export interface AuditLoggerOptions {
  logPath?: string;
  maxFileSize?: number; // bytes
  maxFiles?: number;
}

function primaryRole(roles: readonly Role[]): Role {
  if (roles.includes('ADMIN')) return 'ADMIN';
  if (roles.includes('TRUSTED')) return 'TRUSTED';
  return 'PUBLIC';
}

export class AuditLogger {
  private options: Required<AuditLoggerOptions>;
  private logQueue: AuditEntry[] = [];
  private flushTimer: NodeJS.Timeout | undefined;

  constructor(options: AuditLoggerOptions = {}) {
    this.options = {
      logPath: options.logPath ?? '/DATA/AppData/homehub/audit',
      maxFileSize: options.maxFileSize ?? 10 * 1024 * 1024, // 10MB
      maxFiles: options.maxFiles ?? 10,
    };

    // Start periodic flush
    this.startFlushTimer();
  }

  /**
   * Log an action execution
   */
  async logAction(
    request: ActionRequest,
    result: ActionResult,
    verificationPassed: boolean,
    identity?: AuthorizationIdentityLike,
  ): Promise<AuditEntry> {
    const normalizedRequest = ActionRequestSchema.parse(request);
    const platformUserId = normalizedRequest.platformUserId ?? normalizedRequest.userId;
    const internalUser = identity?.internalUserId
      ?? identity?.internalIdentity?.internalUserId
      ?? null;
    const role = identity ? (identity.role ?? primaryRole(identity.roles)) : 'PUBLIC';
    const entry: AuditEntry = {
      id: this.generateId(),
      // userId is retained as a compatibility alias for the stable platform ID.
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

    this.logQueue.push(entry);

    // Authorization and execution audit entries must survive a short-lived
    // runtime; flush every event before acknowledging the action.
    await this.flush();
    return entry;
  }

  /**
   * Get audit entries for a user
   */
  async getUserAuditLogs(userId: string, limit: number = 100): Promise<AuditEntry[]> {
    const allLogs = await this.loadAuditLogs();
    const userLogs = allLogs.filter(log => log.userId === userId);

    // Sort by timestamp descending and limit
    return userLogs
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  }

  /**
   * Get audit entries for a service
   */
  async getServiceAuditLogs(serviceId: string, limit: number = 100): Promise<AuditEntry[]> {
    const allLogs = await this.loadAuditLogs();
    const serviceLogs = allLogs.filter(log => log.serviceId === serviceId);

    return serviceLogs
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  }

  /**
   * Get recent audit entries
   */
  async getRecentAuditLogs(limit: number = 50): Promise<AuditEntry[]> {
    const allLogs = await this.loadAuditLogs();

    return allLogs
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  }

  /**
   * Get failed audit entries
   */
  async getFailedAuditLogs(limit: number = 50): Promise<AuditEntry[]> {
    const allLogs = await this.loadAuditLogs();

    return allLogs
      .filter(log => log.status === 'failed' || !log.verificationPassed)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  }

  /**
   * Generate audit report
   */
  async generateAuditReport(options: {
    userId?: string;
    serviceId?: string;
    startTime?: string;
    endTime?: string;
  }): Promise<{
    totalActions: number;
    successfulActions: number;
    failedActions: number;
    verificationFailed: number;
    actionsByService: Record<string, number>;
    actionsByType: Record<string, number>;
    averageDuration: number;
  }> {
    let logs = await this.loadAuditLogs();

    // Apply filters
    if (options.userId) {
      logs = logs.filter(log => log.userId === options.userId);
    }
    if (options.serviceId) {
      logs = logs.filter(log => log.serviceId === options.serviceId);
    }
    if (options.startTime) {
      logs = logs.filter(log => new Date(log.timestamp) >= new Date(options.startTime!));
    }
    if (options.endTime) {
      logs = logs.filter(log => new Date(log.timestamp) <= new Date(options.endTime!));
    }

    // Calculate statistics
    const totalActions = logs.length;
    const successfulActions = logs.filter(log => log.status === 'success' && log.verificationPassed).length;
    const failedActions = logs.filter(log => log.status === 'failed').length;
    const verificationFailed = logs.filter(log => !log.verificationPassed).length;

    const actionsByService: Record<string, number> = {};
    const actionsByType: Record<string, number> = {};
    let totalDuration = 0;

    for (const log of logs) {
      actionsByService[log.serviceId] = (actionsByService[log.serviceId] || 0) + 1;
      actionsByType[log.action] = (actionsByType[log.action] || 0) + 1;
      totalDuration += log.duration;
    }

    const averageDuration = totalActions > 0 ? totalDuration / totalActions : 0;

    return {
      totalActions,
      successfulActions,
      failedActions,
      verificationFailed,
      actionsByService,
      actionsByType,
      averageDuration,
    };
  }

  /**
   * Flush queued logs to disk
   */
  private async flush(): Promise<void> {
    if (this.logQueue.length === 0) return;

    const entriesToWrite = [...this.logQueue];
    this.logQueue = [];

    try {
      await this.ensureLogDirectory();
      const today = new Date().toISOString().split('T')[0];
      const logFile = join(this.options.logPath, `audit-${today}.jsonl`);

      // Append to log file
      const lines = entriesToWrite.map(entry => JSON.stringify(entry)).join('\n') + '\n';
      await fs.appendFile(logFile, lines, 'utf8');

      // Check if we need to rotate log files
      await this.rotateLogIfNeeded(logFile);

    } catch (error) {
      console.error('Failed to flush audit logs:', error);
      // Put entries back in queue
      this.logQueue.unshift(...entriesToWrite);
    }
  }

  /**
   * Load audit logs from disk
   */
  private async loadAuditLogs(): Promise<AuditEntry[]> {
    try {
      await this.ensureLogDirectory();
      const files = await fs.readdir(this.options.logPath);
      const auditFiles = files.filter(file => file.startsWith('audit-') && file.endsWith('.jsonl'));

      const allLogs: AuditEntry[] = [];

      for (const file of auditFiles) {
        const filePath = join(this.options.logPath, file);
        const content = await fs.readFile(filePath, 'utf8');
        const lines = content.trim().split('\n');

        for (const line of lines) {
          if (line.trim()) {
            try {
              const entry = JSON.parse(line) as AuditEntry;
              allLogs.push(entry);
            } catch {
              // Skip invalid lines
            }
          }
        }
      }

      return allLogs;

    } catch (error) {
      console.error('Failed to load audit logs:', error);
      return [];
    }
  }

  /**
   * Ensure log directory exists
   */
  private async ensureLogDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.options.logPath, { recursive: true });
    } catch (error) {
      console.error('Failed to create log directory:', error);
    }
  }

  /**
   * Rotate log file if it's too large
   */
  private async rotateLogIfNeeded(logFile: string): Promise<void> {
    try {
      const stats = await fs.stat(logFile);

      if (stats.size > this.options.maxFileSize) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const rotatedFile = logFile.replace('.jsonl', `-${timestamp}.jsonl`);
        await fs.rename(logFile, rotatedFile);

        // Clean up old log files
        await this.cleanupOldLogs();
      }
    } catch (error) {
      console.error('Failed to rotate log file:', error);
    }
  }

  /**
   * Clean up old log files
   */
  private async cleanupOldLogs(): Promise<void> {
    try {
      const files = await fs.readdir(this.options.logPath);
      const auditFiles = files.filter(file => file.startsWith('audit-') && file.endsWith('.jsonl'));

      if (auditFiles.length <= this.options.maxFiles) return;

      // Sort by modification time
      const fileStats = await Promise.all(
        auditFiles.map(async (file) => ({
          file,
          path: join(this.options.logPath, file),
          mtime: (await fs.stat(join(this.options.logPath, file))).mtime.getTime(),
        }))
      );

      fileStats.sort((a, b) => a.mtime - b.mtime);

      // Delete oldest files
      const filesToDelete = fileStats.slice(0, fileStats.length - this.options.maxFiles);
      for (const { path } of filesToDelete) {
        await fs.unlink(path);
      }

    } catch (error) {
      console.error('Failed to cleanup old logs:', error);
    }
  }

  /**
   * Start periodic flush timer
   */
  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      this.flush().catch(error => {
        console.error('Periodic audit log flush failed:', error);
      });
    }, 5000); // Flush every 5 seconds
  }

  /**
   * Stop periodic flush timer
   */
  stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
  }

  /**
   * Generate unique ID for audit entries
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}
