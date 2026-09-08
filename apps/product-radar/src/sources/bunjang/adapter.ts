import { RadarError, SourceFetchError } from '../../core/errors.js';
import type { Listing, ProductStatus } from '../../core/listing/model.js';
import type { WatchTarget, WatchType } from '../../core/watch/model.js';
import type { SearchPage, SearchPageTarget } from '../../core/search/model.js';
import type { ListingSourceAdapter, SourceCapabilities, ValidatedTarget } from '../registry.js';

type JsonObject = Record<string, unknown>;

const BUNJANG_WEB_BASE = 'https://m.bunjang.co.kr';
const BUNJANG_API_BASE = 'https://api.bunjang.co.kr';
const BUNJANG_SELLER_PATH = /^\/(?:shops?|user)\/(\d+)(?:\/|$)/u;
const BUNJANG_PRODUCT_PATH = /^\/products_?\/(\d+)(?:\/|$)/u;
const BUNJANG_KEYWORD_PATH = /^\/keywords\/(.+?)(?:\/|$)/u;
const UNAVAILABLE_ERROR_CODES = new Set([
  'ERR_DELETED_PRODUCT',
  'ERR_PRODUCT_NOT_FOUND',
  'ERR_PRODUCT_STOP_SELLING',
]);

function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function productStatus(value: unknown): ProductStatus {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (['SELLING', 'ACTIVE', 'ON_SALE'].includes(normalized)) return 'ACTIVE';
  if (['RESERVED', 'RESERVE'].includes(normalized)) return 'RESERVED';
  if (['SOLD', 'SOLD_OUT', 'SOLDOUT', 'COMPLETED'].includes(normalized)) return 'SOLD';
  if (['DELETED', 'STOP_SELLING', 'UNAVAILABLE', 'NOT_FOUND'].includes(normalized)) return 'UNAVAILABLE';
  return 'UNKNOWN';
}

function canonicalProductUrl(externalId: string): string {
  return `${BUNJANG_WEB_BASE}/products/${externalId}`;
}

function canonicalSellerUrl(externalId: string): string {
  return `${BUNJANG_WEB_BASE}/shops/${externalId}/products`;
}

function idFromUrl(value: string, kind: 'seller' | 'product'): string | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (!/(?:^|\.)bunjang\.co\.kr$/iu.test(url.hostname)) return undefined;
  const pattern = kind === 'seller' ? BUNJANG_SELLER_PATH : BUNJANG_PRODUCT_PATH;
  const match = pattern.exec(url.pathname);
  return match?.[1];
}

function queryFromUrl(value: string): string | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (!/(?:^|\.)bunjang\.co\.kr$/iu.test(url.hostname)) return undefined;
  const match = BUNJANG_KEYWORD_PATH.exec(url.pathname);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

function canonicalSearchUrl(query: string): string {
  return `${BUNJANG_WEB_BASE}/keywords/${encodeURIComponent(query)}`;
}

function toImageUrls(imageUrl: string | undefined, imageCount: number | undefined): string[] {
  if (!imageUrl) return [];
  const template = imageUrl.replaceAll('{res}', '600');
  if (!template.includes('{cnt}')) return [template];
  const count = Math.max(1, Math.min(imageCount ?? 1, 30));
  return Array.from({ length: count }, (_, index) => template.replaceAll('{cnt}', String(index + 1)));
}

function sellerFromRaw(raw: JsonObject): Listing['seller'] {
  const shop = Object.keys(asObject(raw.shop)).length > 0 ? asObject(raw.shop) : asObject(asObject(raw.data).shop);
  const externalId = numberValue(shop.uid);
  const name = stringValue(shop.name);
  const url = externalId === undefined ? undefined : canonicalSellerUrl(String(externalId));
  if (externalId === undefined && name === undefined) return undefined;
  return {
    ...(externalId === undefined ? {} : { externalId: String(externalId) }),
    ...(name === undefined ? {} : { name }),
    ...(url === undefined ? {} : { url }),
  };
}

function findProduct(raw: unknown): JsonObject {
  const root = asObject(raw);
  const data = asObject(root.data);
  const product = asObject(data.product);
  return Object.keys(product).length > 0 ? product : root;
}

function productLike(value: unknown): boolean {
  const object = asObject(value);
  return object.pid !== undefined || object.productId !== undefined || object.id !== undefined || object.name !== undefined || object.productName !== undefined;
}

function findProductArray(value: unknown, depth = 0): unknown[] | undefined {
  if (depth > 8) return undefined;
  if (Array.isArray(value)) {
    if (value.length === 0) return value;
    return value.some(productLike) ? value : undefined;
  }
  if (!value || typeof value !== 'object') return undefined;
  const object = value as JsonObject;
  const preferredKeys = ['data', 'items', 'products', 'list', 'results', 'records', 'goods'];
  for (const key of preferredKeys) {
    if (!(key in object)) continue;
    const result = findProductArray(object[key], depth + 1);
    if (result !== undefined) return result;
  }
  for (const child of Object.values(object)) {
    const result = findProductArray(child, depth + 1);
    if (result !== undefined) return result;
  }
  return undefined;
}

function searchResponseParts(body: unknown): { candidates?: unknown[]; nextCursor?: string } {
  const root = asObject(body);
  const data = asObject(root.data);
  const responses = asObject(data.responses);
  const mainGrid = asObject(responses.mainGrid);
  const searchResponse = asObject(mainGrid.searchResponse);
  const exact = [searchResponse.data, searchResponse.items, data.products, root.products, root.list]
    .find((value) => Array.isArray(value));
  const candidates = exact ?? findProductArray(searchResponse) ?? findProductArray(data) ?? findProductArray(root);
  const nextCursor = stringValue(searchResponse.cursor) ?? stringValue(searchResponse.nextCursor) ?? stringValue(mainGrid.nextCursor) ?? stringValue(data.nextCursor) ?? stringValue(root.nextCursor);
  return { ...(candidates === undefined ? {} : { candidates }), ...(nextCursor === undefined ? {} : { nextCursor }) };
}

export interface BunjangSourceAdapterOptions {
  apiBaseUrl?: string;
  webBaseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  pageSize?: number;
}

export class BunjangSourceAdapter implements ListingSourceAdapter {
  readonly id = 'bunjang';
  readonly displayName = 'Bunjang';
  readonly capabilities: SourceCapabilities = {
    sellerWatch: true,
    productWatch: true,
    similarityWatch: true,
    searchWatch: false,
    categoryWatch: false,
    supportsPrice: true,
    supportsImages: true,
    supportsSeller: true,
    supportsProductStatus: true,
  };

  private readonly apiBaseUrl: string;
  private readonly webBaseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly pageSize: number;

  constructor(options: BunjangSourceAdapterOptions = {}) {
    this.apiBaseUrl = (options.apiBaseUrl ?? BUNJANG_API_BASE).replace(/\/$/u, '');
    this.webBaseUrl = (options.webBaseUrl ?? BUNJANG_WEB_BASE).replace(/\/$/u, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.pageSize = Math.max(1, Math.min(options.pageSize ?? 100, 100));
  }

  async validateTarget(type: WatchType, target: WatchTarget): Promise<ValidatedTarget> {
    const record = asObject(target);
    if (type === 'similarity') {
      const explicitQuery = stringValue(record.searchQuery);
      const explicitUrl = stringValue(record.searchUrl);
      const urlQuery = explicitUrl ? queryFromUrl(explicitUrl) : undefined;
      if (explicitUrl && !urlQuery) throw new RadarError('invalid Bunjang search URL', 'INVALID_TARGET', 400, { target });
      const searchQuery = explicitQuery ?? urlQuery ?? '의류';
      if (!searchQuery) throw new RadarError('Bunjang similarity watch requires a search query', 'INVALID_TARGET', 400, { target });
      if (explicitQuery && urlQuery && explicitQuery !== urlQuery) throw new RadarError('Bunjang search query does not match search URL', 'INVALID_TARGET', 400, { target });
      const url = explicitUrl ?? `${this.webBaseUrl}/keywords/${encodeURIComponent(searchQuery)}`;
      return { ...record, externalId: `search:${searchQuery}`, url, searchQuery, searchUrl: url };
    }
    if (type !== 'seller' && type !== 'product') {
      throw new RadarError(`Bunjang does not support ${type} watch`, 'UNSUPPORTED_CAPABILITY', 422, { source: this.id, type });
    }
    const kind = type;
    const explicitKey = kind === 'seller' ? 'sellerExternalId' : 'productExternalId';
    const urlKey = kind === 'seller' ? 'sellerUrl' : 'productUrl';
    const explicitId = stringValue(record[explicitKey]);
    const explicitUrl = stringValue(record[urlKey]);
    const urlId = explicitUrl ? idFromUrl(explicitUrl, kind) : undefined;
    if (explicitUrl && !urlId) throw new RadarError(`invalid Bunjang ${kind} URL`, 'INVALID_TARGET', 400, { target });
    if (explicitId && urlId && explicitId !== urlId) throw new RadarError(`Bunjang ${kind} target id does not match target URL`, 'INVALID_TARGET', 400, { target });
    const externalId = explicitId ?? urlId;
    if (!externalId || !/^\d+$/u.test(externalId)) {
      throw new RadarError(`invalid Bunjang ${kind} target`, 'INVALID_TARGET', 400, { target });
    }
    const url = explicitUrl ?? (kind === 'seller' ? `${this.webBaseUrl}/shops/${externalId}/products` : `${this.webBaseUrl}/products/${externalId}`);
    return {
      ...record,
      externalId,
      url,
      ...(kind === 'seller' ? { sellerExternalId: externalId, sellerUrl: url } : { productExternalId: externalId, productUrl: url }),
    };
  }

  async fetchSellerListings(target: ValidatedTarget): Promise<unknown[]> {
    const sellerId = target.sellerExternalId ?? target.externalId;
    const result: unknown[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page += 1) {
      const url = new URL('/api/search/v8/web/search', this.apiBaseUrl);
      url.searchParams.set('policyKey', 'mw.product.shop');
      url.searchParams.set('uid', sellerId);
      url.searchParams.set('size', String(Math.min(this.pageSize, 60)));
      if (cursor) url.searchParams.set('cursor', cursor);
      const { status, body } = await this.requestJson(url, target.url);
      const root = asObject(body);
      const errorCode = stringValue(root.errorCode);
      if (errorCode || status >= 400) {
        if (root.result === 'unauthorized') {
          throw new SourceFetchError(
            'Bunjang seller listings require an authenticated public endpoint; no login, CAPTCHA, proxy, or anti-bot bypass was attempted',
            { source: this.id, status, endpoint: url.pathname },
          );
        }
        throw new SourceFetchError(`Bunjang seller listing request failed with HTTP ${status}`, { status, body });
      }
      const data = asObject(root.data);
      const responses = asObject(data.responses);
      const mainGrid = asObject(responses.mainGrid);
      const searchResponse = asObject(mainGrid.searchResponse);
      const candidates = [searchResponse.data, searchResponse.items, data.products, root.products, root.list]
        .find((value) => Array.isArray(value));
      if (!Array.isArray(candidates)) {
        if (root.result === 'unauthorized') {
          throw new SourceFetchError(
            'Bunjang seller listings require an authenticated public endpoint; no login, CAPTCHA, proxy, or anti-bot bypass was attempted',
            { source: this.id, status, endpoint: url.pathname },
          );
        }
        throw new SourceFetchError('Bunjang seller listing response did not contain a product list', { body });
      }
      let enrichedCandidates = candidates;
      try {
        const profileUrl = new URL(`/api/ums/v1/users/${sellerId}/shop-details`, this.apiBaseUrl);
        const profile = await this.requestJson(profileUrl, target.url);
        const shop = asObject(asObject(profile.body).data);
        const profileShop = asObject(shop.shop);
        const profileName = stringValue(profileShop.name);
        if (profileName) {
          enrichedCandidates = candidates.map((candidate) => {
            const product = asObject(candidate);
            const existingShop = asObject(product.shop);
            return { ...product, shop: { ...existingShop, uid: existingShop.uid ?? Number(sellerId), name: existingShop.name ?? profileName } };
          });
        }
      } catch {
        // A seller profile is presentation metadata; listing data remains usable.
      }
      result.push(...enrichedCandidates);
      const nextCursor = stringValue(searchResponse.cursor);
      if (!nextCursor) break;
      cursor = nextCursor;
    }
    return result;
  }

  async fetchSearchPage(target: ValidatedTarget & SearchPageTarget): Promise<SearchPage> {
    const query = target.searchQuery ?? '의류';
    const url = new URL('/api/search/v8/web/search', this.apiBaseUrl);
    url.searchParams.set('policyKey', 'mw.product.keyword');
    url.searchParams.set('q', query);
    url.searchParams.set('size', String(Math.min(target.pageSize ?? this.pageSize, 60)));
    if (target.cursor) url.searchParams.set('cursor', target.cursor);
    const { status, body, retryAfterSeconds } = await this.requestJson(url, target.searchUrl ?? target.url);
    const root = asObject(body);
    const errorCode = stringValue(root.errorCode);
    if (errorCode || status >= 400) {
      const bodyRetryAfter = Number((root.retryAfter ?? root.retry_after) ?? NaN);
      const retry = retryAfterSeconds ?? (Number.isFinite(bodyRetryAfter) && bodyRetryAfter > 0 ? Math.ceil(bodyRetryAfter) : undefined);
      throw new SourceFetchError(`Bunjang search request failed with HTTP ${status}`, {
        status, body, ...(retry === undefined ? {} : { retryAfterSeconds: retry }),
      });
    }
    const parts = searchResponseParts(body);
    if (!parts.candidates) throw new SourceFetchError('Bunjang search response did not contain a product list', { body });
    return { items: parts.candidates, ...(parts.nextCursor === undefined ? {} : { nextCursor: parts.nextCursor }), raw: body };
  }

  async fetchSearchListings(target: ValidatedTarget): Promise<unknown[]> {
    const query = target.searchQuery ?? '의류';
    const result: unknown[] = [];
    let cursor: string | undefined;
    const limit = Math.max(1, Math.min(Number(target.candidateLimit ?? 60), 500));
    for (let page = 0; page < 10 && result.length < limit; page += 1) {
      const url = new URL('/api/search/v8/web/search', this.apiBaseUrl);
      url.searchParams.set('policyKey', 'mw.product.keyword');
      url.searchParams.set('q', query);
      url.searchParams.set('size', String(Math.min(this.pageSize, 60)));
      if (cursor) url.searchParams.set('cursor', cursor);
      const { status, body } = await this.requestJson(url, target.url);
      const root = asObject(body);
      const errorCode = stringValue(root.errorCode);
      if (errorCode || status >= 400) throw new SourceFetchError(`Bunjang search request failed with HTTP ${status}`, { status, body });
      const parts = searchResponseParts(body);
      if (!parts.candidates) throw new SourceFetchError('Bunjang search response did not contain a product list', { body });
      result.push(...parts.candidates.slice(0, Math.max(0, limit - result.length)));
      if (!parts.nextCursor || parts.candidates.length === 0) break;
      cursor = parts.nextCursor;
    }
    return result;
  }

  async fetchProduct(target: ValidatedTarget): Promise<unknown> {
    const productId = target.productExternalId ?? target.externalId;
    const url = new URL(`/api/pms/v1/products/${productId}/detail/web`, this.apiBaseUrl);
    const { status, body } = await this.requestJson(url, target.url);
    const root = asObject(body);
    const errorCode = stringValue(root.errorCode);
    if (status >= 400 || errorCode) {
      if (errorCode && UNAVAILABLE_ERROR_CODES.has(errorCode)) {
        return {
          __bunjangUnavailable: true,
          pid: Number(productId),
          name: `Bunjang product ${productId}`,
          saleStatus: 'UNAVAILABLE',
          errorCode,
        };
      }
      throw new SourceFetchError(`Bunjang product request failed with HTTP ${status}`, { status, body });
    }
    const product = findProduct(body);
    if (!numberValue(product.pid) && !stringValue(product.name)) {
      throw new SourceFetchError('Bunjang product response did not contain product data', { body });
    }
    return body;
  }

  normalizeListing(raw: unknown, context?: { target?: ValidatedTarget }): Listing {
    const root = asObject(raw);
    const product = findProduct(raw);
    const externalId = String(numberValue(product.pid) ?? stringValue(product.pid) ?? context?.target?.externalId ?? '').trim();
    if (!externalId) throw new RadarError('Bunjang listing has no product ID', 'INVALID_SOURCE_DATA', 502, { raw });
    const title = stringValue(product.name) ?? `Bunjang product ${externalId}`;
    const priceAmount = numberValue(product.price);
    const imageUrl = stringValue(product.imageUrl) ?? stringValue(product.firstImageUrl) ?? stringValue(product.productImage);
    const imageCount = numberValue(product.imageCount);
    const status = productStatus(product.saleStatus ?? product.status);
    const seller = sellerFromRaw(root);
    const sourceTarget = context?.target;
    const url = `${this.webBaseUrl}/products/${externalId}`;
    const publishedAt = stringValue(product.createdAt) ?? stringValue(product.describedAt) ?? stringValue(product.updatedAt);
    const attributes: Record<string, unknown> = {
      ...(root.__bunjangUnavailable === true ? { partial: true, errorCode: root.errorCode } : {}),
      ...(Array.isArray(product.keywords) ? { keywords: product.keywords } : {}),
      ...(product.brand !== undefined ? { brand: asObject(product.brand).name ?? product.brand } : {}),
      ...(product.category !== undefined ? { category: asObject(product.category).name ?? product.category } : {}),
      ...(product.condition !== undefined ? { condition: product.condition } : {}),
      ...(product.qty !== undefined ? { quantity: product.qty } : {}),
    };
    const description = stringValue(product.description);
    return {
      source: this.id,
      externalId,
      title,
      ...(description === undefined ? {} : { description }),
      url,
      imageUrls: toImageUrls(imageUrl, imageCount),
      ...(seller === undefined && sourceTarget?.sellerExternalId ? { seller: { externalId: sourceTarget.sellerExternalId, url: sourceTarget.sellerUrl ?? canonicalSellerUrl(sourceTarget.sellerExternalId) } } : seller === undefined ? {} : { seller }),
      ...(priceAmount === undefined ? {} : { price: { amount: priceAmount, currency: 'KRW' } }),
      status,
      ...(publishedAt === undefined ? {} : { publishedAt }),
      discoveredAt: new Date().toISOString(),
      ...(Object.keys(attributes).length === 0 ? {} : { attributes }),
      raw,
    };
  }

  normalizeProductState(raw: unknown, context?: { target?: ValidatedTarget }): Listing {
    return this.normalizeListing(raw, context);
  }

  private async requestJson(url: URL, referer: string): Promise<{ status: number; body: unknown; retryAfterSeconds?: number }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'ProductRadar/0.1 (+https://github.com/blacksidev/agent-monorepo)',
          Origin: this.webBaseUrl,
          Referer: referer,
        },
      });
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        body = undefined;
      }
      const retryAfter = Number(response.headers.get('retry-after') ?? NaN);
      return { status: response.status, body, ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfterSeconds: Math.ceil(retryAfter) } : {}) };
    } catch (error) {
      if (error instanceof RadarError) throw error;
      throw new SourceFetchError(`Bunjang request failed: ${error instanceof Error ? error.message : String(error)}`, { url: url.toString() });
    } finally {
      clearTimeout(timer);
    }
  }
}

export { BUNJANG_API_BASE, BUNJANG_WEB_BASE, canonicalProductUrl, canonicalSellerUrl, idFromUrl, productStatus };
