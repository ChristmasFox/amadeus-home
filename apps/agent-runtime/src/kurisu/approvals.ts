import { randomUUID } from 'node:crypto';
import { makeCallback, parseCallback, type ToolResponse, type TrustedExecutionContext } from './contracts.js';
import { approvalArgumentsHash, KurisuStore, type ApprovalRecord } from './storage.js';
import { accepted, evidence, failure } from './tools.js';

export interface ApprovalRequest {
  action: string;
  arguments: unknown;
  ttlMs?: number;
}

export interface ApprovalChallenge {
  approval: ApprovalRecord;
  callback: string;
}

export class ApprovalService {
  constructor(private readonly store: KurisuStore, private readonly now: () => string = () => new Date().toISOString()) {}

  request(context: TrustedExecutionContext, request: ApprovalRequest): ApprovalChallenge {
    const approvalId = `approval_${cryptoRandomId()}`;
    const expiresAt = new Date(new Date(this.now()).getTime() + Math.min(Math.max(request.ttlMs ?? 5 * 60_000, 10_000), 24 * 60 * 60_000)).toISOString();
    const approval = this.store.createApproval({
      id: approvalId,
      runId: context.runId,
      principalKey: context.principalKey,
      sessionKey: context.sessionKey,
      action: request.action,
      argumentsHash: approvalArgumentsHash(request.action, request.arguments),
      arguments: request.arguments,
      expiresAt,
    });
    const callback = makeCallback({ kind: 'approval', action: 'approve', id: approvalId });
    const reference = parseCallback(callback);
    if (reference) this.store.bindCallback(callback, reference, { principalKey: context.principalKey, sessionKey: context.sessionKey, runId: context.runId }, this.now());
    return { approval, callback };
  }

  consume(context: TrustedExecutionContext, approvalId: string, action: string, args: unknown): ToolResponse {
    const consumed = this.store.consumeApproval(
      approvalId,
      context.principalKey,
      context.sessionKey,
      action,
      approvalArgumentsHash(action, args),
      this.now(),
    );
    if (!consumed) return failure('APPROVAL_INVALID', 'approval is missing, expired, mismatched, or already used', false);
    return accepted(context.runId, [evidence('kurisu.approval', 'server-bound approval consumed once', approvalId)]);
  }

  consumeCallback(context: TrustedExecutionContext, callbackValue: unknown, action: string, args: unknown): ToolResponse {
    const callback = parseCallback(callbackValue);
    if (!callback || callback.kind !== 'approval' || callback.action !== 'approve') return failure('CALLBACK_INVALID', 'callback namespace or action is invalid', false);
    return this.consume(context, callback.id, action, args);
  }

  /** Consume a callback-bound approval using the server-persisted arguments. */
  consumeBound(context: TrustedExecutionContext, approvalId: string): ToolResponse {
    const approval = this.store.getApproval(approvalId);
    if (!approval || approval.runId !== context.runId) return failure('APPROVAL_INVALID', 'approval is missing or bound to another run', false);
    return this.consume(context, approvalId, approval.action, approval.arguments);
  }
}

function cryptoRandomId(): string {
  return randomUUID().replaceAll('-', '').slice(0, 24);
}
