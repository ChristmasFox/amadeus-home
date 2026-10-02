import { createDeliveryEnvelope, type AttachmentPart, type DeliveryContext, type DeliveryEnvelope } from './delivery-envelope.js';
import { decodeAgentReply } from './delivery-decoder.js';
import { normalizeImageCaption } from './image-caption.js';

export type MediaCompletion = Readonly<{
  taskId: string;
  sourceSessionKey: string;
  parts: Promise<readonly AttachmentPart[]>;
  expiresAt: number;
}>;

/** Per-run accumulator is part of settlement, never an automatic media sender. */
export class DeliveryRuns {
  private runs = new Map<string, { context: DeliveryContext; envelope?: DeliveryEnvelope; raw?: unknown; decodeStatus?: 'structured' | 'silent' | 'malformed'; prepared?: DeliveryEnvelope; preparedCaptionSource?: 'native_completion' | 'none'; preparing?: Promise<DeliveryEnvelope>; jobs: Promise<readonly AttachmentPart[]>[]; mediaCompletion?: MediaCompletion | undefined }>();
  private sessions = new Map<string, string>();
  private mediaCompletions = new Map<string, MediaCompletion>();
  private readonly mediaCompletionTtlMs = 5 * 60_000;

  /** A runtime-owned image claim waiting for the native completion turn. */
  registerMediaCompletion(completion: MediaCompletion): void {
    this.pruneMediaCompletions();
    const existing = this.mediaCompletions.get(completion.sourceSessionKey);
    if (existing && existing.taskId !== completion.taskId) throw new Error('image_completion_identity_conflict');
    this.mediaCompletions.delete(completion.sourceSessionKey);
    this.mediaCompletions.set(completion.sourceSessionKey, { ...completion, expiresAt: Date.now() + this.mediaCompletionTtlMs });
  }

  isMediaCompletionProvenance(input: { sourceTool?: string; sourceSessionKey?: string }): boolean {
    this.pruneMediaCompletions();
    return input.sourceTool === 'image_generate' && typeof input.sourceSessionKey === 'string' && this.mediaCompletions.has(input.sourceSessionKey);
  }

  claimMediaCompletion(runId: string, sourceSessionKey: string): boolean {
    this.pruneMediaCompletions();
    const run = this.runs.get(runId);
    const completion = this.mediaCompletions.get(sourceSessionKey);
    if (!run || !completion || run.context.origin !== 'media_completion') return false;
    run.mediaCompletion = completion;
    this.mediaCompletions.delete(sourceSessionKey);
    return true;
  }

  mediaCompletionFor(runId: string): MediaCompletion | undefined { return this.runs.get(runId)?.mediaCompletion; }

  releaseMediaCompletion(runId: string): void {
    const run = this.runs.get(runId);
    if (run?.mediaCompletion) run.mediaCompletion = undefined;
  }

  private pruneMediaCompletions(now = Date.now()): void {
    for (const [key, value] of this.mediaCompletions) if (value.expiresAt <= now) this.mediaCompletions.delete(key);
    while (this.mediaCompletions.size > 1024) this.mediaCompletions.delete(this.mediaCompletions.keys().next().value!);
  }

  start(context: DeliveryContext): void {
    const existing = this.runs.get(context.runId);
    if (!existing) this.runs.set(context.runId, { context, jobs: [] });
    else if (context.origin === 'media_completion' && !existing.envelope && !existing.prepared && !existing.preparing) existing.context = { ...existing.context, ...context, origin: 'media_completion' };
    this.sessions.set(context.sessionKey, context.runId);
    if (this.runs.size > 1024) this.runs.delete(this.runs.keys().next().value!);
  }
  setOrigin(runId: string, origin: DeliveryContext['origin']): void {
    const run = this.runs.get(runId);
    if (!run || run.envelope || run.prepared || run.preparing) return;
    run.context = { ...run.context, origin };
  }
  has(runId: string): boolean { return this.runs.has(runId); }
  runIdFor(sessionKey: string): string | undefined { return this.sessions.get(sessionKey); }
  channelFor(runId: string): string | undefined { return this.runs.get(runId)?.context.channel; }
  originFor(runId: string): DeliveryContext['origin'] | undefined { return this.runs.get(runId)?.context.origin; }
  captionSourceFor(runId: string): 'native_completion' | 'none' | undefined { return this.runs.get(runId)?.preparedCaptionSource; }
  owns(envelope: DeliveryEnvelope): boolean { return this.runs.get(envelope.runId)?.prepared === envelope; }
  addAssets(runId: string, job: Promise<readonly AttachmentPart[]>): void {
    const run = this.runs.get(runId); if (!run) throw new Error('delivery_run_missing');
    // Install rejection handling immediately; settlement fails explicitly.
    run.jobs.push(job); void job.catch(() => undefined);
  }
  decode(runId: string, raw: unknown): DeliveryEnvelope {
    const run = this.runs.get(runId); if (!run) throw new Error('delivery_run_missing');
    if (run.envelope) return run.envelope;
    const decoded = decodeAgentReply(run.context, raw);
    run.raw = raw;
    run.decodeStatus = decoded.status;
    return run.envelope = decoded.envelope;
  }
  async prepareToolOnly(runId: string): Promise<DeliveryEnvelope> {
    const run = this.runs.get(runId); if (!run || run.context.origin !== 'media_completion') throw new Error('delivery_completion_run_missing');
    if (run.prepared) return run.prepared;
    if (run.preparing) return run.preparing;
    run.preparing = (async () => {
      const parts = (await Promise.all(run.jobs)).flat();
      const completionParts = parts.length || !run.mediaCompletion ? parts : await run.mediaCompletion.parts;
      const unique = [...new Map(parts.map((part) => [part.assetId, part])).values()];
      const fallbackUnique = [...new Map(completionParts.map((part) => [part.assetId, part])).values()];
      if (!fallbackUnique.length) throw new Error('delivery_completion_assets_missing');
      return run.prepared = createDeliveryEnvelope({ ...run.context, deliveryId: run.context.deliveryId ?? `${runId}:delivery`, source: 'tool_result', silent: false, parts: fallbackUnique });
    })();
    try { return await run.preparing; } finally { delete run.preparing; }
  }
  async prepare(runId: string, raw?: unknown): Promise<DeliveryEnvelope> {
    const run = this.runs.get(runId); if (!run) throw new Error('delivery_run_missing');
    if (run.prepared) return run.prepared;
    if (run.preparing) return run.preparing;
    run.preparing = (async () => {
      const envelope = this.decode(runId, raw);
      const assets = (await Promise.all(run.jobs)).flat();
      const unique = [...new Map(assets.map((part) => [part.assetId, part])).values()];
      if (run.context.origin === 'media_completion' && run.mediaCompletion) {
        const plainCaption = typeof run.raw === 'string' && !/^(?:\s*[\[{`])/u.test(run.raw) && !/\b(?:version|parts|deliveryId|assetId|MEDIA)\s*:/iu.test(run.raw)
          ? normalizeImageCaption(run.raw)
          : undefined;
        const captionPart = run.decodeStatus === 'structured' && envelope.parts.length === 1 && envelope.parts[0]?.kind === 'text'
          ? normalizeImageCaption(envelope.parts[0].text)
          : plainCaption;
        const completionParts = unique.length ? unique : (await run.mediaCompletion.parts);
        if (!completionParts.length) throw new Error('delivery_completion_assets_missing');
        const parts = completionParts.map((part) => captionPart ? { ...part, caption: captionPart } : part);
        run.preparedCaptionSource = captionPart ? 'native_completion' : 'none';
        run.prepared = createDeliveryEnvelope({ ...run.context, deliveryId: run.context.deliveryId ?? `${runId}:delivery`, source: 'tool_result', silent: false, parts });
        return run.prepared;
      }
      // Internal silence and malformed output never turn into raw protocol delivery.
      const prepared = !unique.length || (envelope.silent && !envelope.fallbackReason) ? envelope
        : createDeliveryEnvelope({ ...envelope, silent: false, parts: [...envelope.parts, ...unique], source: 'tool_result' });
      run.prepared = prepared;
      return prepared;
    })();
    try { return await run.preparing; } finally { delete run.preparing; }
  }
}
export const deliveryRuns = new DeliveryRuns();
