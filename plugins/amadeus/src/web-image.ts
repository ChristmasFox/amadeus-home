import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { requestJson } from './http.js';

/** Bounded web image discovery: SearXNG `images` search plus a hardened, SSRF-safe download. */
export const MAX_WEB_IMAGE_BYTES = 8 * 1024 * 1024;
export const MIN_WEB_IMAGE_BYTES = 2 * 1024;
const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 12_000;
const MAX_CANDIDATES = 12;
const CONCURRENCY = 3;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ALLOWED_PORTS = new Set(['', '80', '443', '8080', '8443']);
const BLOCKED_SUFFIXES = ['.local', '.localhost', '.internal', '.lan', '.home', '.home.arpa', '.corp', '.intranet', '.ts.net'];

export type AddressLookup = (hostname: string) => Promise<readonly string[]>;
export type WebImageFetch = (url: string, init: { redirect: 'manual'; signal: AbortSignal; headers: Record<string, string> }) => Promise<Response>;
export type WebImageDeps = Readonly<{ lookup?: AddressLookup; fetch?: WebImageFetch; requestJson?: typeof requestJson }>;

export type WebImageCandidate = Readonly<{ title: string; imageUrl: string; pageUrl: string; width?: number; height?: number }>;
export type DownloadedWebImage = Readonly<{ bytes: Buffer; mimeType: string; finalUrl: string }>;
export type FoundWebImage = DownloadedWebImage & Readonly<{ candidate: WebImageCandidate }>;

const defaultLookup: AddressLookup = async (hostname) => (await dnsLookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);

function ipv4Octets(address: string): number[] | undefined {
  const parts = address.split('.').map(Number);
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) ? parts : undefined;
}

/** True only for globally routable unicast addresses; 0.0.0.0 / :: (DNS sinkholes) are never public. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [a = 0, b = 0, c = 0] = ipv4Octets(address)!;
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)))) return false;
    if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    return true;
  }
  if (family === 6) {
    const value = address.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/u.exec(value);
    if (mapped) return isPublicAddress(mapped[1]!);
    if (value.startsWith('::ffff:') || value.startsWith('64:ff9b:') || value.startsWith('2002:')) return false;
    if (value === '::' || value === '::1' || value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb')) return false;
    if (/^f[cd]/u.test(value) || value.startsWith('ff') || value.startsWith('2001:db8') || value.startsWith('fec') || value.startsWith('fed') || value.startsWith('fee') || value.startsWith('fef')) return false;
    return true;
  }
  return false;
}

/** Scheme, port, hostname and every resolved address must be public before any request is made. */
export async function assertPublicUrl(raw: string, lookup: AddressLookup = defaultLookup): Promise<URL> {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('web_image_url_invalid'); }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password || !ALLOWED_PORTS.has(url.port)) throw new Error('web_image_url_forbidden');
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/gu, '').replace(/\.$/u, '');
  if (!host) throw new Error('web_image_url_invalid');
  if (isIP(host)) {
    if (!isPublicAddress(host)) throw new Error('web_image_address_forbidden');
    return url;
  }
  if (!host.includes('.') || host === 'localhost' || BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) throw new Error('web_image_host_forbidden');
  let addresses: readonly string[];
  try { addresses = await lookup(host); } catch { throw new Error('web_image_dns_failed'); }
  if (!addresses.length || !addresses.every(isPublicAddress)) throw new Error('web_image_address_forbidden');
  return url;
}

export function sniffImageMime(bytes: Buffer): string | undefined {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  return undefined;
}

async function readCapped(response: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error('web_image_too_large');
  if (!response.body) throw new Error('web_image_empty');
  const chunks: Buffer[] = [];
  let total = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error('web_image_too_large');
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks, total);
}

/** Downloads one image; redirects are followed manually so every hop is re-validated. */
export async function downloadWebImage(rawUrl: string, deps: WebImageDeps = {}, signal?: AbortSignal): Promise<DownloadedWebImage> {
  const lookup = deps.lookup ?? defaultLookup;
  const doFetch: WebImageFetch = deps.fetch ?? ((url, init) => fetch(url, init));
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await assertPublicUrl(current, lookup);
    const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
    const response = await doFetch(url.toString(), {
      redirect: 'manual',
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: { Accept: 'image/jpeg,image/png,image/webp;q=0.9,*/*;q=0.1', 'User-Agent': 'Mozilla/5.0 (compatible; AmadeusLab/1.0; +image-fetch)' },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      await response.body?.cancel().catch(() => undefined);
      if (!location) throw new Error('web_image_redirect_invalid');
      current = new URL(location, url).toString();
      continue;
    }
    if (!response.ok) { await response.body?.cancel().catch(() => undefined); throw new Error(`web_image_http_${response.status}`); }
    const declaredType = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (!ALLOWED_MIME.has(declaredType)) { await response.body?.cancel().catch(() => undefined); throw new Error('web_image_type_forbidden'); }
    const bytes = await readCapped(response, MAX_WEB_IMAGE_BYTES);
    if (bytes.length < MIN_WEB_IMAGE_BYTES) throw new Error('web_image_too_small');
    const mimeType = sniffImageMime(bytes);
    if (!mimeType) throw new Error('web_image_content_invalid');
    return { bytes, mimeType, finalUrl: url.toString() };
  }
  throw new Error('web_image_too_many_redirects');
}

function cleanText(value: unknown, max: number): string {
  return typeof value === 'string' ? [...value.normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ').replace(/\s+/gu, ' ').trim()].slice(0, max).join('') : '';
}

function httpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined;
  } catch { return undefined; }
}

export function parseImageResults(payload: unknown, limit = MAX_CANDIDATES): WebImageCandidate[] {
  const results = payload && typeof payload === 'object' ? (payload as { results?: unknown }).results : undefined;
  if (!Array.isArray(results)) return [];
  const seen = new Set<string>();
  const candidates: WebImageCandidate[] = [];
  for (const row of results as Array<Record<string, unknown>>) {
    if (!row || typeof row !== 'object') continue;
    const imageUrl = httpUrl(row.img_src);
    if (!imageUrl || seen.has(imageUrl)) continue;
    const format = typeof row.img_format === 'string' ? row.img_format.toLowerCase() : '';
    if (format && !/^(jpe?g|png|webp)/u.test(format)) continue;
    const size = typeof row.resolution === 'string' ? /^(\d+)\D+(\d+)$/u.exec(row.resolution.trim()) : null;
    const width = size ? Number(size[1]) : undefined;
    const height = size ? Number(size[2]) : undefined;
    if (width !== undefined && height !== undefined && Math.min(width, height) < 300) continue;
    seen.add(imageUrl);
    candidates.push({
      title: cleanText(row.title, 120) || cleanText(row.content, 120),
      imageUrl,
      pageUrl: httpUrl(row.url) ?? imageUrl,
      ...(width !== undefined && height !== undefined ? { width, height } : {}),
    });
    if (candidates.length >= limit) break;
  }
  return candidates;
}

export async function searchImageCandidates(baseUrl: string, query: string, deps: WebImageDeps = {}, signal?: AbortSignal): Promise<WebImageCandidate[]> {
  const search = new URLSearchParams({ q: query, categories: 'images', format: 'json', safesearch: '2' });
  const payload = await (deps.requestJson ?? requestJson)(`${baseUrl}/search?${search.toString()}`, { timeoutMs: 20_000, signal, includeErrorDetail: false });
  return parseImageResults(payload);
}

/** Tries candidates in small parallel batches and keeps the first `count` that download and validate. */
export async function findWebImages(baseUrl: string, query: string, count: number, deps: WebImageDeps = {}, signal?: AbortSignal): Promise<FoundWebImage[]> {
  const candidates = await searchImageCandidates(baseUrl, query, deps, signal);
  const found: FoundWebImage[] = [];
  const seenDigest = new Set<string>();
  for (let index = 0; index < candidates.length && found.length < count; index += CONCURRENCY) {
    const batch = candidates.slice(index, index + CONCURRENCY);
    const settled = await Promise.allSettled(batch.map((candidate) => downloadWebImage(candidate.imageUrl, deps, signal)));
    settled.forEach((outcome, offset) => {
      if (outcome.status !== 'fulfilled' || found.length >= count) return;
      const digest = outcome.value.bytes.subarray(0, 4096).toString('base64') + outcome.value.bytes.length;
      if (seenDigest.has(digest)) return;
      seenDigest.add(digest);
      found.push({ ...outcome.value, candidate: batch[offset]! });
    });
  }
  return found;
}

export function webImageCaption(candidate: WebImageCandidate): string {
  const title = cleanText(candidate.title, 80);
  return [title, `来源：${candidate.pageUrl}`].filter(Boolean).join(' ｜ ');
}
