import type {
  DreamingReport,
  ExplicitMemoryWrite,
  MemoryForgetRequest,
  MemoryHealth,
  MemoryObservation,
  MemoryRecallRequest,
  MemoryRecallResult,
  MemoryWriteResult,
} from './contracts.js';

export interface AgentMemoryPlugin {
  observe(turn: MemoryObservation): Promise<void>;
  recall(request: MemoryRecallRequest): Promise<MemoryRecallResult>;
  remember(write: ExplicitMemoryWrite): Promise<MemoryWriteResult>;
  forget(request: MemoryForgetRequest): Promise<MemoryWriteResult>;
  runDreaming(): Promise<DreamingReport>;
  health(): Promise<MemoryHealth>;
}
