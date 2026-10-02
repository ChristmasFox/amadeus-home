import { createDeliveryEnvelope, type AttachmentPart, type DeliveryContext, type DeliveryEnvelope } from './delivery-envelope.js';
import { decodeAgentReply } from './delivery-decoder.js';

/** Per-run accumulator is part of settlement, never an automatic media sender. */
export class DeliveryRuns {
  private runs = new Map<string, { context: DeliveryContext; envelope?: DeliveryEnvelope; prepared?: DeliveryEnvelope; preparing?: Promise<DeliveryEnvelope>; jobs: Promise<readonly AttachmentPart[]>[] }>();
  private sessions = new Map<string, string>();
  start(context: DeliveryContext): void {
    if (!this.runs.has(context.runId)) this.runs.set(context.runId, { context, jobs: [] });
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
  owns(envelope: DeliveryEnvelope): boolean { return this.runs.get(envelope.runId)?.prepared === envelope; }
  addAssets(runId: string, job: Promise<readonly AttachmentPart[]>): void {
    const run = this.runs.get(runId); if (!run) throw new Error('delivery_run_missing');
    // Install rejection handling immediately; settlement fails explicitly.
    run.jobs.push(job); void job.catch(() => undefined);
  }
  decode(runId: string, raw: unknown): DeliveryEnvelope {
    const run = this.runs.get(runId); if (!run) throw new Error('delivery_run_missing');
    return run.envelope ??= decodeAgentReply(run.context, raw).envelope;
  }
  async prepareToolOnly(runId: string): Promise<DeliveryEnvelope> {
    const run = this.runs.get(runId); if (!run || run.context.origin !== 'media_completion') throw new Error('delivery_completion_run_missing');
    if (run.prepared) return run.prepared;
    if (run.preparing) return run.preparing;
    run.preparing = (async () => {
      const parts = (await Promise.all(run.jobs)).flat();
      const unique = [...new Map(parts.map((part) => [part.assetId, part])).values()];
      if (!unique.length) throw new Error('delivery_completion_assets_missing');
      return run.prepared = createDeliveryEnvelope({ ...run.context, deliveryId: run.context.deliveryId ?? `${runId}:delivery`, source: 'tool_result', silent: false, parts: unique });
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
