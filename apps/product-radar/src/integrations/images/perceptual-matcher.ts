import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import type { ImageFeature, ImageFeatureCache, ImageFeatureKey, ImageFeatureProvider, ImageMatchResult, ImageMatcher, ImageSimilarityResult, ImageSource, PreparedImageReference } from '../../core/matching/image.js';

interface PerceptualImageMatcherOptions {
  dataDir: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
  featureCache?: ImageFeatureCache;
}

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const FEATURE_DIR = 'image-features';

function vectorNorm(vector: number[]): number {
  return Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
}

function normalizeVector(vector: number[]): number[] {
  const norm = vectorNorm(vector);
  return norm === 0 ? vector.map(() => 0) : vector.map((value) => value / norm);
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

async function featureFromBytes(bytes: Buffer): Promise<ImageFeature> {
  const processed = await sharp(bytes)
    .rotate()
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .resize(32, 32, { fit: 'cover', position: 'centre' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const channels = processed.info.channels;
  if (channels < 3) throw new Error('image decoder returned fewer than three color channels');

  const grayscale: number[] = [];
  const colors: number[] = [];
  const histograms = [new Array<number>(8).fill(0), new Array<number>(8).fill(0), new Array<number>(8).fill(0)];
  for (let pixel = 0; pixel < 32 * 32; pixel += 1) {
    const offset = pixel * channels;
    const red = (processed.data[offset] ?? 0) / 255;
    const green = (processed.data[offset + 1] ?? 0) / 255;
    const blue = (processed.data[offset + 2] ?? 0) / 255;
    const gray = red * 0.299 + green * 0.587 + blue * 0.114;
    grayscale.push(gray);
    if (pixel % 16 === 0) colors.push(red, green, blue);
    histograms[0]![Math.min(7, Math.floor(red * 8))]! += 1;
    histograms[1]![Math.min(7, Math.floor(green * 8))]! += 1;
    histograms[2]![Math.min(7, Math.floor(blue * 8))]! += 1;
  }

  const grayMean = grayscale.reduce((sum, value) => sum + value, 0) / grayscale.length;
  const grayVariance = grayscale.reduce((sum, value) => sum + (value - grayMean) ** 2, 0) / grayscale.length;
  const grayStd = Math.sqrt(grayVariance) || 1;
  const structure: number[] = [];
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      const sourceY = Math.min(31, y * 2 + 1);
      const sourceX = Math.min(31, x * 2 + 1);
      const value = grayscale[sourceY * 32 + sourceX] ?? grayMean;
      structure.push((value - grayMean) / grayStd);
    }
  }

  const histogram = histograms.flatMap((bins) => bins.map((value) => value / (32 * 32)));
  return {
    vector: normalizeVector([...structure.map((value) => value * 0.72), ...colors.map((value) => (value - 0.5) * 0.2), ...histogram.map((value) => value * 0.28)]),
    width: processed.info.width,
    height: processed.info.height,
  };
}

export class PerceptualImageMatcher implements ImageMatcher {
  private readonly dataDir: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly featureCache: ImageFeatureCache;
  readonly provider = 'sharp';
  readonly modelVersion = 'sharp-perceptual-v1';

  constructor(options: PerceptualImageMatcherOptions) {
    this.dataDir = options.dataDir;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.featureCache = options.featureCache ?? new FileImageFeatureCache(join(this.dataDir, 'image-feature-cache'));
  }

  async prepareReference(source: ImageSource): Promise<PreparedImageReference> {
    const bytes = source.base64 ? decodeBase64(source.base64) : await this.download(source.url ?? '');
    const hash = contentHash(bytes);
    await this.saveFeature(hash, await featureFromBytes(bytes));
    return { id: hash, contentHash: hash, provider: this.provider, modelVersion: this.modelVersion };
  }

  async match(referenceId: string, candidateImageUrls: string[], context: { source?: string; externalId?: string; threshold?: number } = {}): Promise<ImageMatchResult> {
    const reference = await this.loadFeature(referenceId);
    let score = 0;
    let bestImageUrl: string | undefined;
    let comparedImages = 0;
    for (const imageUrl of candidateImageUrls) {
      try {
        const bytes = await this.download(imageUrl);
        const hash = contentHash(bytes);
        const feature = await this.loadOrCreateFeature(hash, bytes, { ...(context.source === undefined ? {} : { source: context.source }), ...(context.externalId === undefined ? {} : { externalId: context.externalId }), imageUrl, imageHash: hash, provider: this.provider, modelVersion: this.modelVersion });
        const cosine = cosineSimilarity(reference.vector, feature.vector);
        const candidateScore = Math.max(0, Math.min(1, cosine));
        comparedImages += 1;
        if (candidateScore > score) {
          score = candidateScore;
          bestImageUrl = imageUrl;
        }
      } catch {
        // One unavailable candidate image must not invalidate the complete scan.
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

  private featurePath(hash: string): string {
    return join(this.dataDir, FEATURE_DIR, `${hash}.json`);
  }

  private async loadFeature(id: string): Promise<ImageFeature> {
    const value = JSON.parse(await readFile(this.featurePath(id), 'utf8')) as ImageFeature;
    if (!Array.isArray(value.vector)) throw new Error('stored image feature is invalid');
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

  private async loadOrCreateFeature(hash: string, bytes: Buffer, key?: ImageFeatureKey): Promise<ImageFeature> {
    if (key) {
      const cached = await this.featureCache.get(key);
      if (cached) return cached;
    }
    try {
      return await this.loadFeature(hash);
    } catch {
      const feature = await featureFromBytes(bytes);
      await this.saveFeature(hash, feature);
      if (key) await this.featureCache.set(key, feature);
      return feature;
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
        headers: { Accept: 'image/*', 'User-Agent': 'ProductRadar/0.2' },
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


function stableCacheKey(key: ImageFeatureKey): string {
  return createHash('sha256').update(JSON.stringify({
    source: key.source ?? '', externalId: key.externalId ?? '', imageUrl: key.imageUrl ?? '', imageHash: key.imageHash ?? '',
    provider: key.provider, modelVersion: key.modelVersion,
  })).digest('hex');
}

/** File-backed feature cache that can be replaced by an embedding/vector worker later. */
export class FileImageFeatureCache implements ImageFeatureCache {
  constructor(private readonly directory: string) {}

  private path(key: ImageFeatureKey): string {
    return join(this.directory, `${stableCacheKey(key)}.json`);
  }

  async get(key: ImageFeatureKey): Promise<ImageFeature | undefined> {
    try {
      const value = JSON.parse(await readFile(this.path(key), 'utf8')) as ImageFeature;
      return Array.isArray(value.vector) ? value : undefined;
    } catch {
      return undefined;
    }
  }

  async set(key: ImageFeatureKey, feature: ImageFeature): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    await writeFile(this.path(key), JSON.stringify(feature), { mode: 0o600 });
  }
}

export class SharpPerceptualProvider implements ImageFeatureProvider {
  readonly id = 'sharp';
  readonly modelVersion = 'sharp-perceptual-v1';

  async extract(bytes: Buffer): Promise<ImageFeature> {
    return featureFromBytes(bytes);
  }

  similarity(reference: ImageFeature, candidate: ImageFeature): ImageSimilarityResult {
    const rawScore = Math.max(0, Math.min(1, cosineSimilarity(reference.vector, candidate.vector)));
    return { provider: this.id, modelVersion: this.modelVersion, rawScore, matchScore: rawScore };
  }
}
