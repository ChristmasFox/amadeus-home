import { estimateMemoryEmbeddingTokens } from '@rine-kit/agent-memory';
import type {
  MemoryEmbeddingBatch,
  MemoryEmbeddingClient,
  MemoryEmbeddingContract,
} from '@rine-kit/agent-memory';

export type GateMemoryEmbeddingContract = MemoryEmbeddingContract;
export type GateMemoryEmbeddingBatch = MemoryEmbeddingBatch;
export type GateMemoryEmbeddingClient = MemoryEmbeddingClient;

export const estimateGateEmbeddingTokens = estimateMemoryEmbeddingTokens;
