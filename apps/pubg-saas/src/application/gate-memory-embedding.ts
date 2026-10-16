import { estimateMemoryEmbeddingTokens } from '@agent/memory';
import type {
  MemoryEmbeddingBatch,
  MemoryEmbeddingClient,
  MemoryEmbeddingContract,
} from '@agent/memory';

export type GateMemoryEmbeddingContract = MemoryEmbeddingContract;
export type GateMemoryEmbeddingBatch = MemoryEmbeddingBatch;
export type GateMemoryEmbeddingClient = MemoryEmbeddingClient;

export const estimateGateEmbeddingTokens = estimateMemoryEmbeddingTokens;
