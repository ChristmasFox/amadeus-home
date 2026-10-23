import { AgentMemoryRuntime } from '@rine-kit/agent-memory';
import type {
  AgentMemoryPlugin,
  DreamingReport,
  MemoryObservation,
  MemoryRecallRequest,
  MemoryRecallResult,
  MemoryRetrievedCandidate,
  MemoryWriteResult,
  ExplicitMemoryWrite,
  MemoryForgetRequest,
} from '@rine-kit/agent-memory';
import type { KookIngressJob } from './kook-ingress-queue.js';
import type { KookTextPayload } from './kook-message-queue.js';
import type { GateMemoryConsolidationConsentService, GateMemoryConsolidationWorkflow } from './gate-memory-consolidation.js';
import type { GateMemoryConsolidationWorker } from './gate-memory-consolidation.js';
import type { MemoryRetriever } from './gate-memory-retriever.js';
import type { GateMemoryWriteCoordinator } from './gate-memory-writer.js';
import { runGateMemoryDreamingPass } from './gate-memory-dreaming.js';

export interface GateMemoryPluginOptions {
  botAccountId: string;
  readEnabled: boolean;
  writeEnabled: boolean;
  autoLearnEnabled: boolean;
  retriever: MemoryRetriever | null;
  writer: GateMemoryWriteCoordinator | null;
  consent: GateMemoryConsolidationConsentService | null;
  worker: GateMemoryConsolidationWorker | null;
}

/** Gate adapter: keeps KOOK identity, ingress trust, and persistence outside the generic runtime. */
export class GateMemoryPlugin implements AgentMemoryPlugin<KookIngressJob> {
  private readonly runtime: AgentMemoryRuntime<KookIngressJob>;

  constructor(private readonly options: GateMemoryPluginOptions) {
    const { retriever, writer, consent, worker } = options;
    this.runtime = new AgentMemoryRuntime({
      features: { read: options.readEnabled, write: options.writeEnabled, autoLearn: options.autoLearnEnabled },
      adapters: {
        observe: consent ? (job, observation) => this.observeTrustedDm(consent, job, observation) : null,
        recall: retriever ? {
          recall: (job, request) => retriever.retrieve(job, request.query),
          recordUsed: (job, query, candidates) => retriever.recordUsed(job, query, candidates),
        } : null,
        writes: writer ? {
          remember: (job, write) => writer.remember(job, write),
          forget: (job, request) => writer.forget(job, request),
        } : null,
        runDreaming: worker ? signal => runGateMemoryDreamingPass(worker, signal) : null,
      },
    });
  }

  get autoLearnEnabled(): boolean { return this.runtime.autoLearnEnabled; }

  private async observeTrustedDm(consent: GateMemoryConsolidationConsentService, job: KookIngressJob,
    observation: MemoryObservation): Promise<void> {
    if (job.botAccountId !== this.options.botAccountId || job.request.kind !== 'direct'
      || observation.content !== job.request.event.content
      || !observation.evidence.some(evidence => evidence.id === job.eventId
        && evidence.source === 'conversation' && evidence.observedAt === observation.observedAt)) return;
    await consent.admitCurrentMessage(job);
  }

  observe(job: KookIngressJob, observation: MemoryObservation): Promise<void> {
    return this.runtime.observe(job, observation);
  }

  recall(job: KookIngressJob, request: MemoryRecallRequest): Promise<MemoryRecallResult> {
    return this.runtime.recall(job, request);
  }

  remember(job: KookIngressJob, write: ExplicitMemoryWrite): Promise<MemoryWriteResult> {
    return this.runtime.remember(job, write);
  }

  forget(job: KookIngressJob, request: MemoryForgetRequest): Promise<MemoryWriteResult> {
    return this.runtime.forget(job, request);
  }

  recordUsed(job: KookIngressJob, query: string,
    candidates: readonly MemoryRetrievedCandidate[]): Promise<void> {
    return this.runtime.recordUsed(job, query, candidates);
  }

  runDreaming(signal?: AbortSignal): Promise<DreamingReport> {
    return this.runtime.runDreaming(signal);
  }

  health() { return this.runtime.health(); }

  handleExplicitMessage(job: KookIngressJob, signal: AbortSignal): Promise<KookTextPayload | undefined> {
    if (!this.runtime.features.write || !this.options.writer) return Promise.resolve(undefined);
    return this.options.writer.handle(job, signal, this);
  }

  setConsent(job: KookIngressJob, workflow: GateMemoryConsolidationWorkflow, enabled: boolean) {
    if (!this.options.consent) throw new Error('gate_memory_consent_unavailable');
    return this.options.consent.setConsent(job, workflow, enabled);
  }

  getConsent(job: KookIngressJob) {
    if (!this.options.consent) throw new Error('gate_memory_consent_unavailable');
    return this.options.consent.getConsent(job);
  }

  pendingCandidates(job: KookIngressJob) {
    if (!this.options.consent) throw new Error('gate_memory_consent_unavailable');
    return this.options.consent.pendingCandidates(job);
  }

  confirmCandidate(job: KookIngressJob, candidateId: string) {
    if (!this.options.consent) throw new Error('gate_memory_consent_unavailable');
    return this.options.consent.confirmCandidate(job, candidateId);
  }

  rejectCandidate(job: KookIngressJob, candidateId: string) {
    if (!this.options.consent) throw new Error('gate_memory_consent_unavailable');
    return this.options.consent.rejectCandidate(job, candidateId);
  }
}
