import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { OpenClawPluginToolContext } from 'openclaw/plugin-sdk/core';
import type { AmadeusConfig } from './config.js';
import { readRequiredFile } from './config.js';
import { requestFormJson } from './http.js';
import { isGroupContext } from './machost.js';
import { isTrustedOwnerContext } from './owner.js';

type KiwiEndpoint = 'getServiceInfo' | 'getLiveServiceInfo' | 'getRawUsageStats';
type VpsSource = 'kiwivm' | 'ssh';
type VpsStatus = 'ok' | 'partial' | 'degraded' | 'stale' | 'error';

export interface VpsError {
  code: string;
  message: string;
}

interface VpsEnvelope {
  status: VpsStatus;
  source: VpsSource;
  checkedAt: string;
  error?: VpsError;
}

interface KiwiCredentials {
  veid: string;
  apiKey: string;
}

interface TrafficSnapshot {
  counterBytes: number;
  totalBytes: number;
  resetAt: string | null;
}

interface UsageState {
  lastSuccessfulCounter: number;
  lastSuccessfulAt: string;
  lastSuccessfulTotal?: number;
  lastSuccessfulResetAt?: string | null;
}

interface RawUsagePoint {
  timestamp: string;
  networkInBytes: number;
  networkOutBytes: number;
  totalBytes: number;
}

interface VpsServiceDefinition {
  name: 'Caddy' | 'Xray' | 'Hysteria2' | 'frps';
  unit: 'caddy.service' | 'xray.service' | 'hysteria-server.service' | 'frps.service';
}

export const VPS_CRITICAL_SERVICES: readonly VpsServiceDefinition[] = [
  { name: 'Caddy', unit: 'caddy.service' },
  { name: 'Xray', unit: 'xray.service' },
  { name: 'Hysteria2', unit: 'hysteria-server.service' },
  { name: 'frps', unit: 'frps.service' },
] as const;

const READONLY_PROBE_COMMAND = '/usr/local/sbin/amadeus-vps-readonly-probe';
export const VPS_SUBSCRIPTION_ACCOUNT_IDS = ['Labmem001', 'Labmem002', 'Labmem003', 'Labmem004', 'Labmem005', 'M204-Net-Core', 'legacy'] as const;
type VpsSubscriptionAccountId = typeof VPS_SUBSCRIPTION_ACCOUNT_IDS[number];

interface VpsSubscriptionProtocolUsage {
  uploadBytes: number | null;
  downloadBytes: number | null;
  totalBytes: number | null;
  lastCounterSampleAt: string | null;
  status: 'ok' | 'stale' | 'error' | 'unknown';
  onlineCount: number | null;
  onlineCountKind: 'client_instances' | 'unique_source_ips' | null;
  onlineStatus: 'ok' | 'stale' | 'error' | 'unknown';
  onlineSampledAt: string | null;
  windowBytes: number | null;
  windowSampleCount: number;
}

interface VpsSubscriptionAccount {
  accountId: VpsSubscriptionAccountId;
  enabled: boolean;
  monitoringStartedAt: string | null;
  protocols: Record<'hy2' | 'vless', VpsSubscriptionProtocolUsage>;
  totalMonitoredBytes: number | null;
  knownMonitoredBytes: number | null;
  totalsComplete: boolean;
  windowBytes: number | null;
  windowComplete: boolean;
}

interface VpsSubscriptionSnapshot {
  generatedAt: string | null;
  monitoringStartedAt: string | null;
  accounts: VpsSubscriptionAccount[];
  legacy: VpsSubscriptionAccount;
  protocolTotals: Record<'hy2' | 'vless', { knownBytes: number | null; observedAccounts: number | null; complete: boolean; source: Record<string, unknown> }>;
  knownProxyAccountedBytes: number | null;
  proxyAccountedBytes: number | null;
  proxyAccountedComplete: boolean;
  sources: Record<'provider' | 'hysteria_traffic' | 'hysteria_online' | 'xray' | 'xray_online', Record<string, unknown>>;
  reportWindow: { seconds: number | null; startAt: string | null; endAt: string | null; topAccount: { accountId: string; windowBytes: number } | null };
  provider: { baselineCounterBytes: number | null; lastCounterBytes: number | null; deltaSinceMonitoringStartBytes: number | null; totalBytes: number | null; resetAt: string | null; sampledAt: string | null };
  reconciliation: { status: 'uncalibrated' | 'calibrated'; providerDeltaBytes: number | null; proxyAccountedBytes: number | null; gapBytes: number | null };
}

class VpsReadOnlyError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'VpsReadOnlyError';
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function finiteNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function firstNumber(item: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = finiteNumber(item[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function optionalText(value: unknown, max = 512): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  const number = finiteNumber(value);
  if (number !== undefined) return number !== 0;
  if (typeof value === 'string') {
    if (/^(true|yes|on|active|running|1)$/iu.test(value.trim())) return true;
    if (/^(false|no|off|inactive|stopped|0)$/iu.test(value.trim())) return false;
  }
  return null;
}

function timestamp(value: unknown): string | null {
  if (typeof value === 'number' || (typeof value === 'string' && /^\d+(?:\.\d+)?$/u.test(value.trim()))) {
    const raw = Number(value);
    const millis = raw < 100_000_000_000 ? raw * 1000 : raw;
    const date = new Date(millis);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  if (typeof value === 'string') {
    const date = new Date(value.trim());
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  return null;
}

function safeError(error: unknown, source: VpsSource): VpsError {
  if (error instanceof VpsReadOnlyError) return { code: error.code, message: error.message };
  if (source === 'kiwivm') {
    const text = error instanceof Error ? error.message : '';
    if (/^HTTP \d+/u.test(text)) return { code: 'KIWIVM_HTTP_ERROR', message: 'KiwiVM API returned an HTTP error' };
    return { code: 'KIWIVM_UNREACHABLE', message: 'KiwiVM API is unreachable' };
  }
  return { code: 'SSH_UNREACHABLE', message: 'VPS read-only SSH probe is unreachable' };
}

async function readCredentials(config: AmadeusConfig): Promise<KiwiCredentials> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readRequiredFile(config.kiwiVmCredentialsFile, 'KiwiVM credentials')) as unknown;
  } catch (error) {
    if (error instanceof VpsReadOnlyError) throw error;
    throw new VpsReadOnlyError('KIWIVM_CREDENTIALS_INVALID', 'KiwiVM credentials are unavailable or invalid');
  }
  const item = objectValue(parsed);
  const veid = optionalText(item.veid, 64);
  const apiKey = optionalText(item.apiKey ?? item.api_key, 512);
  if (!veid || !apiKey) throw new VpsReadOnlyError('KIWIVM_CREDENTIALS_INVALID', 'KiwiVM credentials are unavailable or invalid');
  return { veid, apiKey };
}

function assertKiwiResponse(value: unknown): Record<string, unknown> {
  const item = objectValue(value);
  const errorCode = finiteNumber(item.error);
  if (errorCode !== undefined && errorCode !== 0) {
    throw new VpsReadOnlyError('KIWIVM_API_ERROR', 'KiwiVM API rejected the read-only request');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new VpsReadOnlyError('KIWIVM_INVALID_RESPONSE', 'KiwiVM API returned an invalid response');
  }
  return item;
}

async function kiwiCall(config: AmadeusConfig, endpoint: KiwiEndpoint, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const credentials = await readCredentials(config);
  let value: unknown;
  try {
    value = await requestFormJson(`${config.kiwiVmBaseUrl}/${endpoint}`, { veid: credentials.veid, api_key: credentials.apiKey }, {
      method: 'POST',
      timeoutMs: endpoint === 'getLiveServiceInfo' ? 25_000 : 15_000,
      includeErrorDetail: false,
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (error instanceof VpsReadOnlyError) throw error;
    throw error;
  }
  return assertKiwiResponse(value);
}

function apiEnvelope<T extends Record<string, unknown>>(source: VpsSource, checkedAt: string, data: T): VpsEnvelope & { data: T } {
  return { status: 'ok', source, checkedAt, data };
}

export async function getVpsServiceInfo(config: AmadeusConfig, signal?: AbortSignal): Promise<unknown> {
  const checkedAt = new Date().toISOString();
  try {
    const item = await kiwiCall(config, 'getServiceInfo', signal);
    const ipAddresses = Array.isArray(item.ip_addresses)
      ? item.ip_addresses.filter((value): value is string => typeof value === 'string').slice(0, 8)
      : [];
    return apiEnvelope('kiwivm', checkedAt, {
      endpoint: 'getServiceInfo',
      service: {
        hostname: optionalText(item.hostname ?? item.live_hostname),
        operatingSystem: optionalText(item.os ?? item.installed_os),
        vmType: optionalText(item.vm_type),
        ipAddresses,
        planName: optionalText(item.plan ?? item.plan_name),
        memoryBytes: firstNumber(item, ['plan_ram', 'plan_ram_bytes']),
        diskBytes: firstNumber(item, ['plan_disk', 'plan_disk_bytes']),
        monthlyTrafficBytes: firstNumber(item, ['plan_monthly_data', 'monthly_data_bytes']),
        trafficCounterBytes: firstNumber(item, ['data_counter', 'data_counter_bytes']),
        resetAt: timestamp(item.data_next_reset ?? item.data_reset_date ?? item.reset_at ?? item.next_reset),
        suspended: asBoolean(item.suspended),
      },
    });
  } catch (error) {
    return { status: 'error', source: 'kiwivm', checkedAt, error: safeError(error, 'kiwivm') } satisfies VpsEnvelope;
  }
}

function liveState(item: Record<string, unknown>): 'running' | 'stopped' | 'unknown' {
  const value = optionalText(item.ve_status ?? item.status ?? item.state, 64)?.toLowerCase();
  if (value === 'running' || value === 'online' || value === 'started') return 'running';
  if (value === 'stopped' || value === 'offline' || value === 'halted') return 'stopped';
  return 'unknown';
}

export async function getVpsLiveStatus(config: AmadeusConfig, signal?: AbortSignal): Promise<unknown> {
  const checkedAt = new Date().toISOString();
  try {
    const item = await kiwiCall(config, 'getLiveServiceInfo', signal);
    const live = {
      state: liveState(item),
      hostname: optionalText(item.live_hostname ?? item.hostname),
      cpuThrottled: asBoolean(item.is_cpu_throttled),
      diskUsedBytes: firstNumber(item, ['ve_used_disk_space_b', 'used_disk_space_b']),
      diskQuotaBytes: (() => {
        const gigabytes = firstNumber(item, ['ve_disk_quota_gb']);
        return gigabytes === undefined ? firstNumber(item, ['ve_disk_quota_b', 'disk_quota_bytes']) : gigabytes * 1024 ** 3;
      })(),
      loadAverage: optionalText(item.load_average),
      memoryAvailableBytes: (() => {
        const kilobytes = firstNumber(item, ['mem_available_kb']);
        return kilobytes === undefined ? firstNumber(item, ['mem_available_bytes']) : kilobytes * 1024;
      })(),
      swapTotalBytes: (() => {
        const kilobytes = firstNumber(item, ['swap_total_kb']);
        return kilobytes === undefined ? firstNumber(item, ['swap_total_bytes']) : kilobytes * 1024;
      })(),
      swapAvailableBytes: (() => {
        const kilobytes = firstNumber(item, ['swap_available_kb']);
        return kilobytes === undefined ? firstNumber(item, ['swap_available_bytes']) : kilobytes * 1024;
      })(),
      sshPort: firstNumber(item, ['ssh_port']),
    };
    const unknownFields = Object.entries(live).filter(([, value]) => value === null || value === undefined || value === 'unknown').map(([key]) => key);
    return {
      status: unknownFields.length ? 'partial' : 'ok',
      source: 'kiwivm',
      checkedAt,
      endpoint: 'getLiveServiceInfo',
      live,
      ...(unknownFields.length ? { unknownFields } : {}),
    };
  } catch (error) {
    return { status: 'error', source: 'kiwivm', checkedAt, error: safeError(error, 'kiwivm') } satisfies VpsEnvelope;
  }
}

function usageArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const item = objectValue(value);
  for (const key of ['data', 'stats', 'usage', 'points']) if (Array.isArray(item[key])) return item[key] as unknown[];
  return [];
}

function rawUsagePoints(value: unknown): RawUsagePoint[] {
  return usageArray(value).flatMap((row) => {
    const item = objectValue(row);
    const time = timestamp(item.timestamp ?? item.time ?? item.ts);
    const networkInBytes = firstNumber(item, ['network_in_bytes', 'networkInBytes', 'in_bytes']);
    const networkOutBytes = firstNumber(item, ['network_out_bytes', 'networkOutBytes', 'out_bytes']);
    if (!time || networkInBytes === undefined || networkOutBytes === undefined || networkInBytes < 0 || networkOutBytes < 0) return [];
    return [{ timestamp: time, networkInBytes, networkOutBytes, totalBytes: networkInBytes + networkOutBytes }];
  }).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)).slice(-168);
}

function trafficSnapshot(item: Record<string, unknown>): TrafficSnapshot {
  const counterBytes = firstNumber(item, ['data_counter', 'data_counter_bytes']);
  const totalBytes = firstNumber(item, ['plan_monthly_data', 'monthly_data_bytes']);
  if (counterBytes === undefined || totalBytes === undefined || counterBytes < 0 || totalBytes <= 0) {
    throw new VpsReadOnlyError('KIWIVM_INVALID_USAGE', 'KiwiVM traffic counters are unavailable');
  }
  return {
    counterBytes,
    totalBytes,
    resetAt: timestamp(item.data_next_reset ?? item.data_reset_date ?? item.reset_at ?? item.next_reset),
  };
}

async function readUsageState(path: string): Promise<UsageState | undefined> {
  try {
    const item = objectValue(JSON.parse(await readFile(path, 'utf8')) as unknown);
    const counter = finiteNumber(item.lastSuccessfulCounter);
    const at = optionalText(item.lastSuccessfulAt, 64);
    if (counter === undefined || counter < 0 || !at) return undefined;
    const total = finiteNumber(item.lastSuccessfulTotal);
    const resetAt = item.lastSuccessfulResetAt === null ? null : optionalText(item.lastSuccessfulResetAt, 64);
    return {
      lastSuccessfulCounter: counter,
      lastSuccessfulAt: at,
      ...(total !== undefined && total > 0 ? { lastSuccessfulTotal: total } : {}),
      ...(item.lastSuccessfulResetAt === null || resetAt ? { lastSuccessfulResetAt: resetAt } : {}),
    };
  } catch {
    return undefined;
  }
}

async function writeUsageState(path: string, state: UsageState): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, path);
}

export async function getVpsUsage(config: AmadeusConfig, signal?: AbortSignal): Promise<unknown> {
  const checkedAt = new Date().toISOString();
  const previous = await readUsageState(config.vpsUsageStateFile);
  try {
    const serviceInfo = await kiwiCall(config, 'getServiceInfo', signal);
    const snapshot = trafficSnapshot(serviceInfo);
    let history: { status: 'ok' | 'error'; points: RawUsagePoint[]; error?: VpsError } = { status: 'ok', points: [] };
    try {
      const raw = await kiwiCall(config, 'getRawUsageStats', signal);
      history.points = rawUsagePoints(raw);
    } catch (error) {
      history = { status: 'error', points: [], error: safeError(error, 'kiwivm') };
    }
    const deltaSincePreviousSampleBytes = previous
      ? snapshot.counterBytes >= previous.lastSuccessfulCounter ? snapshot.counterBytes - previous.lastSuccessfulCounter : snapshot.counterBytes
      : null;
    const counterReset = previous ? snapshot.counterBytes < previous.lastSuccessfulCounter : false;
    await writeUsageState(config.vpsUsageStateFile, {
      lastSuccessfulCounter: snapshot.counterBytes,
      lastSuccessfulAt: checkedAt,
      lastSuccessfulTotal: snapshot.totalBytes,
      lastSuccessfulResetAt: snapshot.resetAt,
    });
    const usedPercent = snapshot.counterBytes / snapshot.totalBytes * 100;
    return {
      status: history.status === 'ok' ? 'ok' : 'partial',
      source: 'kiwivm',
      checkedAt,
      endpoint: ['getServiceInfo', 'getRawUsageStats'],
      usage: {
        usedBytes: snapshot.counterBytes,
        totalBytes: snapshot.totalBytes,
        remainingBytes: Math.max(snapshot.totalBytes - snapshot.counterBytes, 0),
        usedPercent,
        resetAt: snapshot.resetAt,
        deltaSincePreviousSampleBytes,
        counterReset,
      },
      lastSuccessfulCounter: snapshot.counterBytes,
      lastSuccessfulAt: checkedAt,
      ...(previous ? { previousSuccessfulSample: previous } : {}),
      history,
    };
  } catch (error) {
    const result: VpsEnvelope & { stale: true; lastSuccessfulSample?: UsageState; usage?: Record<string, unknown> } = {
      status: previous ? 'stale' : 'error',
      source: 'kiwivm',
      checkedAt,
      stale: true,
      error: safeError(error, 'kiwivm'),
      ...(previous ? {
        lastSuccessfulSample: previous,
        usage: {
          usedBytes: previous.lastSuccessfulCounter,
          totalBytes: previous.lastSuccessfulTotal ?? null,
          remainingBytes: previous.lastSuccessfulTotal === undefined ? null : Math.max(previous.lastSuccessfulTotal - previous.lastSuccessfulCounter, 0),
          usedPercent: previous.lastSuccessfulTotal === undefined ? null : previous.lastSuccessfulCounter / previous.lastSuccessfulTotal * 100,
          resetAt: previous.lastSuccessfulResetAt ?? null,
          deltaSincePreviousSampleBytes: null,
        },
      } : {}),
    };
    return result;
  }
}

function shellSafe(value: string, label: string): void {
  if (!value || !/^[A-Za-z0-9._:-]+$/u.test(value)) throw new VpsReadOnlyError('SSH_CONFIG_INVALID', `${label} is invalid`);
}

async function runReadOnlySsh(config: AmadeusConfig, command: string, signal?: AbortSignal): Promise<string> {
  shellSafe(config.vpsSshHost, 'VPS SSH host');
  shellSafe(config.vpsSshUser, 'VPS SSH user');
  if (!Number.isInteger(config.vpsSshPort) || config.vpsSshPort < 1 || config.vpsSshPort > 65_535) throw new VpsReadOnlyError('SSH_CONFIG_INVALID', 'VPS SSH port is invalid');
  const [key, knownHosts] = await Promise.all([
    readFile(config.vpsSshKeyFile, 'utf8'),
    readFile(config.vpsSshKnownHostsFile, 'utf8'),
  ]).catch(() => { throw new VpsReadOnlyError('SSH_CREDENTIALS_UNAVAILABLE', 'VPS read-only SSH credentials are unavailable'); });
  if (!key.trim() || !knownHosts.trim()) throw new VpsReadOnlyError('SSH_CREDENTIALS_UNAVAILABLE', 'VPS read-only SSH credentials are unavailable');
  const args = [
    '-i', config.vpsSshKeyFile,
    '-p', String(config.vpsSshPort),
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=8',
    '-o', 'ConnectionAttempts=1',
    '-o', 'ServerAliveInterval=5',
    '-o', 'ServerAliveCountMax=1',
    '-o', 'ClearAllForwardings=yes',
    '-o', 'RequestTTY=no',
    '-o', 'StrictHostKeyChecking=yes',
    '-o', `UserKnownHostsFile=${config.vpsSshKnownHostsFile}`,
    `${config.vpsSshUser}@${config.vpsSshHost}`,
    command,
  ];
  return await new Promise<string>((resolve, reject) => {
    const child = spawn('ssh', args, { stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', LANG: 'C' } });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finishReject = (error: Error): void => { if (!settled) { settled = true; reject(error); } };
    const timer = setTimeout(() => { child.kill('SIGTERM'); finishReject(new VpsReadOnlyError('SSH_TIMEOUT', 'VPS read-only SSH probe timed out')); }, 15_000);
    const abort = (): void => { child.kill('SIGTERM'); finishReject(new VpsReadOnlyError('SSH_ABORTED', 'VPS read-only SSH probe was aborted')); };
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; if (stdout.length > 32_000) child.kill('SIGTERM'); });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; if (stderr.length > 8_000) child.kill('SIGTERM'); });
    child.once('error', (error) => finishReject(new VpsReadOnlyError('SSH_UNREACHABLE', error.message)));
    child.once('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (settled) return;
      if (code === 0) { settled = true; resolve(stdout.trim()); return; }
      finishReject(new VpsReadOnlyError('SSH_UNREACHABLE', 'VPS read-only SSH probe is unreachable'));
    });
  });
}

function fieldsFromProbe(raw: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const line of raw.split('\n')) {
    const index = line.indexOf('=');
    if (index > 0) fields.set(line.slice(0, index), line.slice(index + 1).trim());
  }
  return fields;
}

export function parseVpsSystemProbe(raw: string, checkedAt = new Date().toISOString()): unknown {
  const fields = fieldsFromProbe(raw);
  if (fields.get('VPS_PROBE_VERSION') !== '1') throw new VpsReadOnlyError('SSH_INVALID_RESPONSE', 'VPS system probe returned an invalid response');
  const uptimeSeconds = finiteNumber(fields.get('UPTIME_SECONDS'));
  const load = (fields.get('LOAD_AVERAGE') ?? '').split(/\s+/u).map(Number);
  const memory = (fields.get('MEMORY_BYTES') ?? '').split(/\s+/u).map(Number);
  const root = (fields.get('ROOTFS') ?? '').split(/\s+/u);
  const memoryTotalBytes = memory[1];
  const memoryAvailableBytes = memory[0];
  const rootSizeBytes = finiteNumber(root[1]);
  const rootUsedBytes = finiteNumber(root[2]);
  const rootAvailableBytes = finiteNumber(root[3]);
  const rootUsedPercent = finiteNumber(root[4]);
  const system = {
    hostname: fields.get('HOSTNAME') || null,
    uptimeSeconds: uptimeSeconds ?? null,
    uptimeText: fields.get('UPTIME_TEXT') || null,
    loadAverage: { oneMinute: Number.isFinite(load[0]) ? load[0] : null, fiveMinutes: Number.isFinite(load[1]) ? load[1] : null, fifteenMinutes: Number.isFinite(load[2]) ? load[2] : null },
    memory: {
      availableBytes: Number.isFinite(memoryAvailableBytes) ? memoryAvailableBytes : null,
      totalBytes: Number.isFinite(memoryTotalBytes) ? memoryTotalBytes : null,
      usedBytes: Number.isFinite(memoryAvailableBytes) && Number.isFinite(memoryTotalBytes) ? Math.max((memoryTotalBytes as number) - (memoryAvailableBytes as number), 0) : null,
    },
    rootFilesystem: { source: root[0] || null, sizeBytes: rootSizeBytes ?? null, usedBytes: rootUsedBytes ?? null, availableBytes: rootAvailableBytes ?? null, usedPercent: rootUsedPercent ?? null, mount: '/' },
  };
  const unknownFields = [
    system.hostname === null ? 'hostname' : null,
    system.uptimeSeconds === null ? 'uptimeSeconds' : null,
    system.loadAverage.oneMinute === null ? 'loadAverage' : null,
    system.memory.totalBytes === null ? 'memory' : null,
    system.rootFilesystem.sizeBytes === null ? 'rootFilesystem' : null,
  ].filter((value): value is string => value !== null);
  return { status: unknownFields.length ? 'partial' : 'ok', source: 'ssh', checkedAt, system, ...(unknownFields.length ? { unknownFields } : {}) };
}

export async function getVpsSystemStatus(config: AmadeusConfig, signal?: AbortSignal): Promise<unknown> {
  const checkedAt = new Date().toISOString();
  try {
    return parseVpsSystemProbe(await runReadOnlySsh(config, READONLY_PROBE_COMMAND, signal), checkedAt);
  } catch (error) {
    return { status: 'error', source: 'ssh', checkedAt, error: safeError(error, 'ssh') } satisfies VpsEnvelope;
  }
}

export function parseVpsServicesProbe(raw: string, checkedAt = new Date().toISOString()): unknown {
  const rows = raw.split('\n').flatMap((line) => {
    const fields = line.split('\t');
    return fields.length === 4 && fields[0] === 'SERVICE' ? [{ unit: fields[1]!, active: fields[2]!, enabled: fields[3]! }] : [];
  });
  const services = VPS_CRITICAL_SERVICES.map((definition) => {
    const row = rows.find((candidate) => candidate.unit === definition.unit);
    const active = row?.active === 'active' ? 'active' : row?.active === 'inactive' ? 'inactive' : row?.active === 'failed' ? 'failed' : 'unknown';
    const enabled = row?.enabled === 'enabled' ? 'enabled' : row?.enabled === 'disabled' ? 'disabled' : 'unknown';
    return { ...definition, active, enabled, healthy: active === 'active' };
  });
  const unknown = services.filter((service) => service.active === 'unknown' || service.enabled === 'unknown').map((service) => service.name);
  const inactive = services.filter((service) => service.active !== 'active').map((service) => service.name);
  return { status: unknown.length ? 'partial' : inactive.length ? 'degraded' : 'ok', source: 'ssh', checkedAt, services, ...(unknown.length ? { unknownServices: unknown } : {}), ...(inactive.length ? { inactiveServices: inactive } : {}) };
}

export async function getVpsServices(config: AmadeusConfig, signal?: AbortSignal): Promise<unknown> {
  const checkedAt = new Date().toISOString();
  try {
    return parseVpsServicesProbe(await runReadOnlySsh(config, READONLY_PROBE_COMMAND, signal), checkedAt);
  } catch (error) {
    return { status: 'error', source: 'ssh', checkedAt, error: safeError(error, 'ssh') } satisfies VpsEnvelope;
  }
}

function nonnegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function safeIso(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 64) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function safeAccountId(value: unknown): VpsSubscriptionAccountId | null {
  return typeof value === 'string' && (VPS_SUBSCRIPTION_ACCOUNT_IDS as readonly string[]).includes(value)
    ? value as VpsSubscriptionAccountId
    : null;
}

function sanitizeProtocolUsage(value: unknown): VpsSubscriptionProtocolUsage {
  const item = objectValue(value);
  const status = item.status === 'ok' || item.status === 'stale' || item.status === 'error' || item.status === 'unknown'
    ? item.status
    : 'unknown';
  return {
    uploadBytes: nonnegativeInteger(item.uploadBytes),
    downloadBytes: nonnegativeInteger(item.downloadBytes),
    totalBytes: nonnegativeInteger(item.totalBytes),
    lastCounterSampleAt: safeIso(item.lastCounterSampleAt),
    status,
    onlineCount: nonnegativeInteger(item.onlineCount),
    onlineCountKind: item.onlineCountKind === 'client_instances' || item.onlineCountKind === 'unique_source_ips'
      ? item.onlineCountKind
      : null,
    onlineStatus: item.onlineStatus === 'ok' || item.onlineStatus === 'stale' || item.onlineStatus === 'error' || item.onlineStatus === 'unknown'
      ? item.onlineStatus
      : 'unknown',
    onlineSampledAt: safeIso(item.onlineSampledAt),
    windowBytes: nonnegativeInteger(item.windowBytes),
    windowSampleCount: nonnegativeInteger(item.windowSampleCount) ?? 0,
  };
}

function sanitizeSubscriptionAccount(value: unknown, expectedId: VpsSubscriptionAccountId): VpsSubscriptionAccount {
  const item = objectValue(value);
  const protocols = objectValue(item.protocols);
  return {
    accountId: expectedId,
    enabled: item.accountId === expectedId && item.enabled === true,
    monitoringStartedAt: safeIso(item.monitoringStartedAt),
    protocols: {
      hy2: sanitizeProtocolUsage(protocols.hy2),
      vless: sanitizeProtocolUsage(protocols.vless),
    },
    totalMonitoredBytes: nonnegativeInteger(item.totalMonitoredBytes),
    knownMonitoredBytes: nonnegativeInteger(item.knownMonitoredBytes),
    totalsComplete: item.totalsComplete === true,
    windowBytes: nonnegativeInteger(item.windowBytes),
    windowComplete: item.windowComplete === true,
  };
}

function sanitizeSource(value: unknown): Record<string, unknown> {
  const item = objectValue(value);
  const status = item.status === 'ok' || item.status === 'stale' || item.status === 'error' || item.status === 'unknown'
    ? item.status
    : 'unknown';
  const errorCode = item.errorCode === 'unreachable' || item.errorCode === 'invalid_response' || item.errorCode === 'timeout' || item.errorCode === 'unavailable'
    ? item.errorCode
    : null;
  return {
    status,
    checkedAt: safeIso(item.checkedAt),
    lastSuccessfulAt: safeIso(item.lastSuccessfulAt),
    lastErrorAt: safeIso(item.lastErrorAt),
    errorCode,
  };
}

function sanitizedSubscriptionSnapshot(value: unknown): VpsSubscriptionSnapshot {
  const item = objectValue(value);
  if (!Array.isArray(item.accounts)) throw new VpsReadOnlyError('ACCOUNTING_INVALID_RESPONSE', 'VPS accounting snapshot is invalid');
  const rows = new Map<VpsSubscriptionAccountId, unknown>();
  for (const row of item.accounts) {
    const id = safeAccountId(objectValue(row).accountId);
    if (id && id !== 'legacy') rows.set(id, row);
  }
  const managedIds = VPS_SUBSCRIPTION_ACCOUNT_IDS.filter((id) => id !== 'legacy');
  if (rows.size !== managedIds.length) throw new VpsReadOnlyError('ACCOUNTING_INVALID_RESPONSE', 'VPS accounting snapshot is incomplete');
  const legacy = sanitizeSubscriptionAccount(item.legacy, 'legacy');
  const sourcesIn = objectValue(item.sources);
  const sources = {
    provider: sanitizeSource(sourcesIn.provider),
    hysteria_traffic: sanitizeSource(sourcesIn.hysteria_traffic),
    hysteria_online: sanitizeSource(sourcesIn.hysteria_online),
    xray: sanitizeSource(sourcesIn.xray),
    xray_online: sanitizeSource(sourcesIn.xray_online),
  };
  const totalsIn = objectValue(item.protocolTotals);
  const protocolTotals = {
    hy2: {
      knownBytes: nonnegativeInteger(objectValue(totalsIn.hy2).knownBytes),
      observedAccounts: nonnegativeInteger(objectValue(totalsIn.hy2).observedAccounts),
      complete: objectValue(totalsIn.hy2).complete === true,
      source: sources.hysteria_traffic,
    },
    vless: {
      knownBytes: nonnegativeInteger(objectValue(totalsIn.vless).knownBytes),
      observedAccounts: nonnegativeInteger(objectValue(totalsIn.vless).observedAccounts),
      complete: objectValue(totalsIn.vless).complete === true,
      source: sources.xray,
    },
  };
  const providerIn = objectValue(item.provider);
  const knownProxyAccounted = nonnegativeInteger(item.knownProxyAccountedBytes);
  const reconciliationIn = objectValue(item.reconciliation);
  const reconciliationStatus = reconciliationIn.status === 'calibrated' ? 'calibrated' : 'uncalibrated';
  const providerDelta = nonnegativeInteger(providerIn.deltaSinceMonitoringStartBytes);
  const proxyAccounted = nonnegativeInteger(item.proxyAccountedBytes);
  const windowIn = objectValue(item.reportWindow);
  const topIn = objectValue(windowIn.topAccount);
  const topAccountId = safeAccountId(topIn.accountId);
  return {
    generatedAt: safeIso(item.generatedAt),
    monitoringStartedAt: safeIso(item.monitoringStartedAt),
    accounts: managedIds.map((id) => sanitizeSubscriptionAccount(rows.get(id), id)),
    legacy,
    protocolTotals,
    knownProxyAccountedBytes: knownProxyAccounted,
    proxyAccountedBytes: proxyAccounted,
    proxyAccountedComplete: item.proxyAccountedComplete === true,
    sources,
    reportWindow: {
      seconds: nonnegativeInteger(windowIn.seconds),
      startAt: safeIso(windowIn.startAt),
      endAt: safeIso(windowIn.endAt),
      topAccount: topAccountId && nonnegativeInteger(topIn.windowBytes) !== null
        ? { accountId: topAccountId, windowBytes: nonnegativeInteger(topIn.windowBytes)! }
        : null,
    },
    provider: {
      baselineCounterBytes: nonnegativeInteger(providerIn.baselineCounterBytes),
      lastCounterBytes: nonnegativeInteger(providerIn.lastCounterBytes),
      deltaSinceMonitoringStartBytes: providerDelta,
      totalBytes: nonnegativeInteger(providerIn.totalBytes),
      resetAt: safeIso(providerIn.resetAt),
      sampledAt: safeIso(providerIn.sampledAt),
    },
    reconciliation: {
      status: reconciliationStatus,
      providerDeltaBytes: providerDelta,
      proxyAccountedBytes: proxyAccounted,
      gapBytes: reconciliationStatus === 'calibrated' ? nonnegativeInteger(reconciliationIn.gapBytes) : null,
    },
  };
}

export function parseVpsSubscriptionProbe(raw: string, checkedAt = new Date().toISOString()): unknown {
  const encoded = fieldsFromProbe(raw).get('ACCOUNTING_SNAPSHOT_JSON');
  if (!encoded || encoded.length > 64_000) {
    return {
      status: 'stale', source: 'ssh', checkedAt,
      error: { code: 'ACCOUNTING_SNAPSHOT_UNAVAILABLE', message: 'VPS subscription accounting snapshot is unavailable' },
      data: null,
    };
  }
  let snapshot: VpsSubscriptionSnapshot;
  try {
    snapshot = sanitizedSubscriptionSnapshot(JSON.parse(encoded) as unknown);
  } catch (error) {
    return {
      status: 'error', source: 'ssh', checkedAt,
      error: error instanceof VpsReadOnlyError ? { code: error.code, message: error.message } : { code: 'ACCOUNTING_INVALID_RESPONSE', message: 'VPS accounting snapshot is invalid' },
      data: null,
    };
  }
  const requiredStatuses = [
    snapshot.sources.provider.status,
    snapshot.sources.hysteria_traffic.status,
    snapshot.sources.hysteria_online.status,
    snapshot.sources.xray.status,
    snapshot.sources.xray_online.status,
  ];
  const accountRows = [...snapshot.accounts, snapshot.legacy];
  const accountingIncomplete = !snapshot.proxyAccountedComplete
    || !snapshot.protocolTotals.hy2.complete
    || !snapshot.protocolTotals.vless.complete
    || accountRows.some((account) => !account.totalsComplete || !account.windowComplete);
  const hasUsableSource = requiredStatuses.some((status) => status === 'ok' || status === 'stale');
  const sourceStatus = !snapshot.monitoringStartedAt && snapshot.sources.provider.status !== 'ok'
    ? 'partial'
    : requiredStatuses.some((value) => value === 'error' || value === 'unknown')
      ? (hasUsableSource ? 'partial' : 'error')
      : requiredStatuses.includes('stale') ? 'stale' : 'ok';
  const status = sourceStatus === 'ok' && accountingIncomplete ? 'partial' : sourceStatus;
  return { status, source: 'ssh', checkedAt, data: snapshot };
}

export function assertVpsSubscriptionOwnerContext(context: OpenClawPluginToolContext): void {
  if (!isTrustedOwnerContext(context) || isGroupContext(context)) {
    throw new Error('VPS subscription details require a direct owner or scheduled report context');
  }
}

export async function getVpsSubscriptionOverview(config: AmadeusConfig, context: OpenClawPluginToolContext, signal?: AbortSignal): Promise<unknown> {
  assertVpsSubscriptionOwnerContext(context);
  const checkedAt = new Date().toISOString();
  try {
    return parseVpsSubscriptionProbe(await runReadOnlySsh(config, READONLY_PROBE_COMMAND, signal), checkedAt);
  } catch (error) {
    return { status: 'error', source: 'ssh', checkedAt, error: safeError(error, 'ssh'), data: null } satisfies VpsEnvelope & { data: null };
  }
}

export async function getVpsSubscriptionDetail(
  config: AmadeusConfig,
  accountId: VpsSubscriptionAccountId,
  context: OpenClawPluginToolContext,
  signal?: AbortSignal,
): Promise<unknown> {
  assertVpsSubscriptionOwnerContext(context);
  if (!(VPS_SUBSCRIPTION_ACCOUNT_IDS as readonly string[]).includes(accountId)) {
    return { status: 'error', source: 'ssh', checkedAt: new Date().toISOString(), error: { code: 'ACCOUNT_ID_INVALID', message: 'Account ID is not supported' } };
  }
  const overview = await getVpsSubscriptionOverview(config, context, signal) as { status?: string; checkedAt?: string; data?: VpsSubscriptionSnapshot | null; error?: VpsError };
  if (!overview.data) return overview;
  const account = accountId === 'legacy' ? overview.data.legacy : overview.data.accounts.find((entry) => entry.accountId === accountId);
  return {
    status: overview.status,
    source: 'ssh',
    checkedAt: overview.checkedAt,
    data: {
      monitoringStartedAt: account?.monitoringStartedAt ?? overview.data.monitoringStartedAt,
      account,
      sources: overview.data.sources,
      reportWindow: overview.data.reportWindow,
      reconciliationStatus: overview.data.reconciliation.status,
    },
  };
}
