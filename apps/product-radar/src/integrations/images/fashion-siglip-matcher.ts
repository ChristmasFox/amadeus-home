import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ImageFeature, ImageFeatureCache, ImageFeatureKey, ImageMatchContext, ImageMatchResult, ImageMatcher, ImageSource, PreparedImageReference } from '../../core/matching/image.js';
import { FileImageFeatureCache, PerceptualImageMatcher } from './perceptual-matcher.js';

interface FashionSiglipImageMatcherOptions {
  dataDir: string;
  baseUrl: string;
  fallback?: ImageMatcher;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
  featureCache?: ImageFeatureCache;
}

interface EmbeddingItem {
  key: string;
  vector?: number[];
  width?: number;
  height?: number;
  error?: string;
}

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const FEATURE_DIR = 'image-features-fashion-siglip';
const PROVIDER = 'fashionSigLIP';
const MODEL_VERSION = 'Marqo/marqo-fashionSigLIP-v1';

function contentHash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function decodeBase64(value: string): Buffer {
  const comma = value.indexOf(',');
  const encoded = comma >= 0 ? value.slice(comma + 1) : value;
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length === 0) throw new Error('reference image base64 is empty');
  return bytes;
}

function normalizeScore(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function cosineSimilarity(left: number[], right: number[]): number {
  const length = Math.min(left.length, right.length);
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / Math.sqrt(leftNorm * rightNorm);
}

function asVector(value: unknown): number[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const vector = value.map((item) => Number(item));
  return vector.every((item) => Number.isFinite(item)) ? vector : undefined;
}

export class FashionSiglipImageMatcher implements ImageMatcher {
  readonly provider = PROVIDER;
  readonly modelVersion = MODEL_VERSION;

  private readonly dataDir: string;
  private readonly baseUrl: string;
  private readonly fallback: ImageMatcher;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly featureCache: ImageFeatureCache;

  constructor(options: FashionSiglipImageMatcherOptions) {
    this.dataDir = options.dataDir;
    this.baseUrl = options.baseUrl.replace(/\/+$/u, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.fallback = options.fallback ?? new PerceptualImageMatcher({ dataDir: options.dataDir });
    this.featureCache = options.featureCache ?? new FileImageFeatureCache(join(this.dataDir, 'image-feature-cache'));
  }

  async prepareReference(source: ImageSource): Promise<PreparedImageReference> {
    const bytes = source.base64 ? decodeBase64(source.base64) : await this.download(source.url ?? '');
    if (bytes.length > this.maxBytes) throw new Error('reference image is too large');
    const hash = contentHash(bytes);
    const base64 = `data:application/octet-stream;base64,${bytes.toString('base64')}`;

    // Always prepare Sharp as a local recovery path. This also lets an old
    // Sharp-only Watch continue working if the model sidecar is unavailable.
    const sharpReference = await this.fallback.prepareReference({ base64 }).catch(() => undefined);
    const fashionReference = await this.embed([{ key: hash, imageBase64: base64 }]).then((items) => {
      const item = items[0];
      if (!item?.vector) throw new Error(item?.error ?? 'FashionSigLIP returned no reference embedding');
      return item;
    }).catch(() => undefined);

    if (fashionReference?.vector) {
      await this.saveFeature(hash, {
        vector: fashionReference.vector,
        ...(fashionReference.width === undefined ? {} : { width: fashionReference.width }),
        ...(fashionReference.height === undefined ? {} : { height: fashionReference.height }),
        hash,
      });
      return { id: hash, contentHash: hash, provider: this.provider, modelVersion: this.modelVersion };
    }
    if (sharpReference) return sharpReference;
    throw new Error('unable to prepare reference with FashionSigLIP or Sharp');
  }

  async match(referenceId: string, candidateImageUrls: string[], context: ImageMatchContext = {}): Promise<ImageMatchResult> {
    const reference = await this.loadFeature(referenceId).catch(() => undefined);
    if (!reference) return this.fallback.match(referenceId, candidateImageUrls, context);

    const keys = candidateImageUrls.map((imageUrl, index) => ({
      imageUrl,
      key: {
        ...(context.source === undefined ? {} : { source: context.source }),
        ...(context.externalId === undefined ? {} : { externalId: context.externalId }),
        imageUrl,
        provider: this.provider,
        modelVersion: this.modelVersion,
      } satisfies ImageFeatureKey,
      requestKey: String(index),
    }));
    const features = new Map<string, ImageFeature>();
    const misses: typeof keys = [];
    for (const entry of keys) {
      const cached = await this.featureCache.get(entry.key);
      if (cached) features.set(entry.requestKey, cached);
      else misses.push(entry);
    }

    if (misses.length > 0) {
      let embedded: EmbeddingItem[];
      try {
        embedded = await this.embed(misses.map((entry) => ({ key: entry.requestKey, imageUrl: entry.imageUrl })));
      } catch {
        return this.fallbackResult(referenceId, candidateImageUrls, context);
      }
      const embeddedByKey = new Map(embedded.map((item) => [item.key, item]));
      for (const entry of misses) {
        const item = embeddedByKey.get(entry.requestKey);
        if (!item?.vector) continue;
        const feature: ImageFeature = {
          vector: item.vector,
          ...(item.width === undefined ? {} : { width: item.width }),
          ...(item.height === undefined ? {} : { height: item.height }),
        };
        features.set(entry.requestKey, feature);
        await this.featureCache.set(entry.key, feature);
      }
    }

    let score = 0;
    let bestImageUrl: string | undefined;
    let comparedImages = 0;
    for (const entry of keys) {
      const feature = features.get(entry.requestKey);
      if (!feature) continue;
      const candidateScore = normalizeScore(cosineSimilarity(reference.vector, feature.vector));
      comparedImages += 1;
      if (candidateScore > score) {
        score = candidateScore;
        bestImageUrl = entry.imageUrl;
      }
    }
    return {
      provider: this.provider,
      modelVersion: this.modelVersion,
      rawScore: score,
      matchScore: score,
      ...(context.threshold === undefined ? {} : { threshold: context.threshold }),
      score,
      comparedImages,
      ...(bestImageUrl === undefined ? {} : { bestImageUrl }),
      ...(context.source && context.externalId ? { metadata: { cacheIdentity: `${context.source}:${context.externalId}`, provider: this.provider, modelVersion: this.modelVersion } } : {}),
    };
  }

  private async fallbackResult(referenceId: string, candidateImageUrls: string[], context: ImageMatchContext): Promise<ImageMatchResult> {
    try {
      return await this.fallback.match(referenceId, candidateImageUrls, context);
    } catch {
      return {
        provider: this.provider,
        modelVersion: this.modelVersion,
        rawScore: 0,
        matchScore: 0,
        ...(context.threshold === undefined ? {} : { threshold: context.threshold }),
        score: 0,
        comparedImages: 0,
        metadata: { provider: this.provider, modelVersion: this.modelVersion, fallback: 'unavailable' },
      };
    }
  }

  private featurePath(hash: string): string {
    return join(this.dataDir, FEATURE_DIR, `${hash}.json`);
  }

  private async loadFeature(id: string): Promise<ImageFeature> {
    const value = JSON.parse(await readFile(this.featurePath(id), 'utf8')) as ImageFeature;
    if (!Array.isArray(value.vector) || value.vector.length === 0) throw new Error('stored FashionSigLIP feature is invalid');
    return value;
  }

  private async saveFeature(hash: string, feature: ImageFeature): Promise<void> {
    await mkdir(join(this.dataDir, FEATURE_DIR), { recursive: true });
    try {
      await readFile(this.featurePath(hash));
    } catch {
      await writeFile(this.featurePath(hash), JSON.stringify(feature), { mode: 0o600 });
    }
  }

  private async embed(items: Array<{ key: string; imageUrl?: string; imageBase64?: string }>): Promise<EmbeddingItem[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/embed-batch`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ items }),
      });
      if (!response.ok) throw new Error(`FashionSigLIP request failed with HTTP ${response.status}`);
      const payload = await response.json() as { items?: unknown };
      if (!Array.isArray(payload.items)) throw new Error('FashionSigLIP response items are invalid');
      return payload.items.flatMap((value): EmbeddingItem[] => {
        if (!value || typeof value !== 'object') return [];
        const item = value as Record<string, unknown>;
        const key = typeof item.key === 'string' ? item.key : '';
        const vector = asVector(item.vector);
        return [{
          key,
          ...(vector === undefined ? {} : { vector }),
          ...(typeof item.width === 'number' ? { width: item.width } : {}),
          ...(typeof item.height === 'number' ? { height: item.height } : {}),
          ...(typeof item.error === 'string' ? { error: item.error } : {}),
        }];
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async download(url: string): Promise<Buffer> {
    if (!url) throw new Error('image URL is empty');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method: 'GET',
        signal: controller.signal,
        headers: { Accept: 'image/*', 'User-Agent': 'ProductRadar/1.0' },
      });
      if (!response.ok) throw new Error(`image download failed with HTTP ${response.status}`);
      const declaredSize = Number(response.headers.get('content-length') ?? 0);
      if (declaredSize > this.maxBytes) throw new Error('image is too large');
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > this.maxBytes) throw new Error('image is too large');
      return bytes;
    } finally {
      clearTimeout(timer);
    }
  }
}
