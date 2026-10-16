export interface GateMemoryEmbeddingContract {
  providerId: 'gate-openai-compatible';
  modelId: string;
  dimensions: number;
  normalization: 'l2_unit';
  indexVersion: number;
}

export interface GateMemoryEmbeddingBatch {
  contract: GateMemoryEmbeddingContract;
  vectors: number[][];
  contentHashes: string[];
  inputTokens: number | null;
}

export interface GateMemoryEmbeddingClient {
  readonly contract: GateMemoryEmbeddingContract;
  readonly dailyTokenBudget: number;
  readonly dailyRequestBudget: number;
  embedMany(values: readonly string[], signal?: AbortSignal): Promise<GateMemoryEmbeddingBatch>;
}

/** UTF-8 bytes upper-bound byte-level token counts for the bounded provider input. */
export function estimateGateEmbeddingTokens(values: readonly string[]): number {
  return values.reduce((total, value) => total + Buffer.byteLength(value, 'utf8'), 0);
}
