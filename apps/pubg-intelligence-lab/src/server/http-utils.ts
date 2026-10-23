import { MAX_REQUEST_BYTES } from './snapshot.js';
import { DEFAULT_TIMEZONE } from '@rine-kit/pubg-domain';
import { type IncomingMessage, type ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';

export interface IPv4Network {
  address: string;
  netmask: string;
}

export function toIPv4Number(address: string): number | null {
  const parts = address.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/u.test(part) || Number(part) > 255)) return null;
  return parts.reduce((value, part) => ((value << 8) | Number(part)) >>> 0, 0);
}

export function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === '::1';
}

export function isPrivateIPv4Host(host: string): boolean {
  const value = toIPv4Number(host);
  if (value === null) return false;
  return (value >= 0x0a000000 && value <= 0x0affffff)
    || (value >= 0xac100000 && value <= 0xac1fffff)
    || (value >= 0xc0a80000 && value <= 0xc0a8ffff);
}

export function bindNetwork(host: string): IPv4Network | undefined {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && address.address === host) return { address: address.address, netmask: address.netmask };
    }
  }
  return undefined;
}

export function isLocalRequest(request: IncomingMessage, network?: IPv4Network): boolean {
  const address = (request.socket.remoteAddress ?? '').replace(/^::ffff:/u, '');
  if (address === '127.0.0.1' || address === '::1') return true;
  if (!network) return false;
  const peerNumber = toIPv4Number(address);
  const localNumber = toIPv4Number(network.address);
  const maskNumber = toIPv4Number(network.netmask);
  return peerNumber !== null && localNumber !== null && maskNumber !== null
    && (peerNumber & maskNumber) === (localNumber & maskNumber);
}

export function send(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(JSON.stringify(payload));
}

export async function requestBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_REQUEST_BYTES) throw new Error('request_too_large');
    chunks.push(buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; }
  catch { throw new Error('invalid_json'); }
}

export function safeDateBounds(from: string | null, to: string | null): { fromMs?: number; toMs?: number } | null {
  const bounds: { fromMs?: number; toMs?: number } = {};
  if (from) {
    if (!validCalendarDate(from)) return null;
    bounds.fromMs = startOfLocalDay(from);
  }
  if (to) {
    if (!validCalendarDate(to)) return null;
    bounds.toMs = startOfLocalDay(nextCalendarDate(to));
  }
  if (bounds.fromMs !== undefined && bounds.toMs !== undefined && bounds.fromMs >= bounds.toMs) return null;
  return bounds;
}

export function validCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

export function localParts(timestamp: number): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: DEFAULT_TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(timestamp);
  const value = Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
  return { year: value.year!, month: value.month!, day: value.day!, hour: value.hour!, minute: value.minute!, second: value.second! };
}

export function startOfLocalDay(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  const target = Date.UTC(year!, month! - 1, day!);
  let candidate = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const local = localParts(candidate);
    const representedAsUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
    const correction = target - representedAsUtc;
    if (correction === 0) break;
    candidate += correction;
  }
  return candidate;
}

export function nextCalendarDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + 1)).toISOString().slice(0, 10);
}