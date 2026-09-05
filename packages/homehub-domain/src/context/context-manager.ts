import type { HomeHubContext, ServiceId, DiagnosisResult, ActionRequest, ActionResult } from '../schema/types.js';
import { ActionRequestSchema } from '../schema/types.js';

export interface ContextManagerOptions {
  persistPath?: string;
  sessionTtl?: number; // milliseconds
}

export interface SessionReference {
  activeService: ServiceId | null;
  lastService: ServiceId | null;
  lastActionSuccess: boolean | null;
  hasPendingAction: boolean;
  pendingRequest: ActionRequest | null;
}

export class ContextManager {
  private contexts: Map<string, HomeHubContext>;
  private options: Required<ContextManagerOptions>;

  constructor(options: ContextManagerOptions = {}) {
    this.contexts = new Map();
    this.options = {
      persistPath: options.persistPath ?? '/DATA/AppData/homehub/contexts',
      sessionTtl: options.sessionTtl ?? 30 * 60 * 1000, // 30 minutes
    };
  }

  getContext(sessionId: string, userId: string, platform: string): HomeHubContext {
    let context = this.contexts.get(sessionId);
    if (!context) {
      context = {
        sessionId,
        userId,
        platform,
        activeService: null,
        lastDiagnosis: null,
        pendingAction: null,
        lastActionResult: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      this.contexts.set(sessionId, context);
    } else {
      context.updatedAt = new Date().toISOString();
      this.contexts.set(sessionId, context);
    }
    return context;
  }

  getContextRecord(sessionId: string): HomeHubContext | undefined {
    return this.contexts.get(sessionId);
  }

  setActiveService(sessionId: string, serviceId: ServiceId): void {
    const context = this.contexts.get(sessionId);
    if (!context) return;
    context.activeService = serviceId;
    context.updatedAt = new Date().toISOString();
    this.contexts.set(sessionId, context);
  }

  setLastDiagnosis(sessionId: string, serviceId: ServiceId, result: DiagnosisResult): void {
    const context = this.contexts.get(sessionId);
    if (!context) return;
    context.lastDiagnosis = { serviceId, result, timestamp: new Date().toISOString() };
    context.activeService = serviceId;
    context.updatedAt = new Date().toISOString();
    this.contexts.set(sessionId, context);
  }

  setPendingAction(sessionId: string, request: ActionRequest): void {
    const context = this.contexts.get(sessionId);
    if (!context) return;
    const normalizedRequest = ActionRequestSchema.parse(request);
    context.pendingAction = {
      request: normalizedRequest,
      status: 'pending',
      timestamp: new Date().toISOString(),
    };
    context.activeService = normalizedRequest.serviceId;
    context.updatedAt = new Date().toISOString();
    this.contexts.set(sessionId, context);
  }

  setLastActionResult(sessionId: string, result: ActionResult): void {
    const context = this.contexts.get(sessionId);
    if (!context) return;
    context.lastActionResult = { result, timestamp: new Date().toISOString() };
    context.activeService = result.serviceId;
    context.pendingAction = null;
    context.updatedAt = new Date().toISOString();
    this.contexts.set(sessionId, context);
  }

  clearServiceContext(sessionId: string, serviceId?: ServiceId): void {
    const context = this.contexts.get(sessionId);
    if (!context) return;
    if (serviceId) {
      if (context.activeService === serviceId) context.activeService = null;
      if (context.lastDiagnosis?.serviceId === serviceId) context.lastDiagnosis = null;
      if (context.pendingAction?.request.serviceId === serviceId) context.pendingAction = null;
      if (context.lastActionResult?.result.serviceId === serviceId) context.lastActionResult = null;
    } else {
      context.activeService = null;
      context.lastDiagnosis = null;
      context.pendingAction = null;
      context.lastActionResult = null;
    }
    context.updatedAt = new Date().toISOString();
    this.contexts.set(sessionId, context);
  }

  getContextForReference(sessionId: string): SessionReference {
    const context = this.contexts.get(sessionId);
    if (!context) {
      return { activeService: null, lastService: null, lastActionSuccess: null, hasPendingAction: false, pendingRequest: null };
    }
    return {
      activeService: context.activeService ?? null,
      lastService: context.lastActionResult?.result.serviceId ?? context.lastDiagnosis?.serviceId ?? null,
      lastActionSuccess: context.lastActionResult?.result.result.success ?? null,
      hasPendingAction: context.pendingAction !== null,
      pendingRequest: context.pendingAction?.request ?? null,
    };
  }

  getPending(sessionId: string): {
    request: ActionRequest | null;
    action: string | null;
    status: string | null;
    timestamp: string | null;
  } {
    const context = this.contexts.get(sessionId);
    if (!context?.pendingAction) {
      return { request: null, action: null, status: null, timestamp: null };
    }
    return {
      request: context.pendingAction.request,
      action: context.pendingAction.request.action,
      status: context.pendingAction.status,
      timestamp: context.pendingAction.timestamp,
    };
  }

  cleanupExpiredSessions(): number {
    const now = Date.now();
    let cleaned = 0;
    for (const [sessionId, context] of this.contexts.entries()) {
      const age = now - new Date(context.updatedAt).getTime();
      if (age > this.options.sessionTtl) {
        this.contexts.delete(sessionId);
        cleaned++;
      }
    }
    return cleaned;
  }

  getActiveSessions(): HomeHubContext[] {
    const now = Date.now();
    const active: HomeHubContext[] = [];
    for (const context of this.contexts.values()) {
      const age = now - new Date(context.updatedAt).getTime();
      if (age <= this.options.sessionTtl) active.push(context);
    }
    return active;
  }

  deleteSession(sessionId: string): boolean {
    return this.contexts.delete(sessionId);
  }

  getSessionCount(): number {
    return this.contexts.size;
  }

  resolveServiceReference(sessionId: string, text: string): ServiceId | null {
    const context = this.getContextForReference(sessionId);
    const lowerText = text.toLowerCase();

    if (/telegram|电报|轮询|polling/.test(lowerText)) return 'telegram-adapter';
    if (/kook/.test(lowerText)) return 'kook-adapter';
    if (/langbot|机器人主/.test(lowerText)) return 'langbot';
    if (/n8n/.test(lowerText)) return 'n8n';
    if (/pubg/.test(lowerText)) return 'mastra-pubg-runtime';
    if (/emby/.test(lowerText)) return 'emby';
    if (/jellyfin/.test(lowerText)) return 'jellyfin';
    if (/redis/.test(lowerText)) return 'redis';
    if (/postgres/.test(lowerText)) return 'postgres';
    if (/qbittorrent|qbit/.test(lowerText)) return 'qbittorrent';
    if (/aria2/.test(lowerText)) return 'aria2';
    if (/glances/.test(lowerText)) return 'glances';
    if (/cloudflare|cloudflared|tunnel/.test(lowerText)) return 'cloudflared';

    if (/它|it|that|刚才那个|刚才的服务/.test(lowerText)) {
      return context.activeService ?? context.lastService;
    }
    return null;
  }
}
