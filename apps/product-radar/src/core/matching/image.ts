export interface ImageSource {
  url?: string;
  base64?: string;
}

export interface ImageFeature {
  vector: number[];
  width?: number;
  height?: number;
  hash?: string;
}

export interface ImageFeatureKey {
  source?: string;
  externalId?: string;
  imageUrl?: string;
  imageHash?: string;
  provider: string;
  modelVersion: string;
}

export interface ImageFeatureProvider {
  readonly id: string;
  readonly modelVersion: string;
  extract(bytes: Buffer, key?: ImageFeatureKey): Promise<ImageFeature>;
  similarity(reference: ImageFeature, candidate: ImageFeature): ImageSimilarityResult;
}

export interface ImageFeatureCache {
  get(key: ImageFeatureKey): Promise<ImageFeature | undefined>;
  set(key: ImageFeatureKey, feature: ImageFeature): Promise<void>;
}

export interface ImageSimilarityResult {
  provider?: string;
  modelVersion?: string;
  rawScore?: number;
  matchScore?: number;
  threshold?: number;
  metadata?: Record<string, unknown>;
}

export interface PreparedImageReference {
  id: string;
  contentHash: string;
  provider?: string;
  modelVersion?: string;
}

export interface ImageMatchContext {
  source?: string;
  externalId?: string;
  threshold?: number;
}

export interface ImageMatcherUsage {
  /** Number of requests made to the image embedding provider for this match. */
  calls: number;
  /** Number of candidate images that produced an embedding in this match. */
  imagesProcessed: number;
  /** Number of candidate images served by the feature cache. */
  cacheHits: number;
}

export interface ImageMatchResult extends ImageSimilarityResult {
  /** Backward-compatible business score used by the current Sharp matcher. */
  score: number;
  comparedImages: number;
  bestImageUrl?: string;
  modelUsage?: ImageMatcherUsage;
}

export interface ImageMatcher {
  prepareReference(source: ImageSource): Promise<PreparedImageReference>;
  match(referenceId: string, candidateImageUrls: string[], context?: ImageMatchContext): Promise<ImageMatchResult>;
}
