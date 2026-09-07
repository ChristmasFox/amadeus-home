import { SensorUnavailableError } from '../../core/errors.js';
import type { SensorClient, SensorHealth, SensorWatch, SensorWatchInput } from '../sensor.js';

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function appriseJsonUrl(webhookUrl: string): string {
  const parsed = new URL(webhookUrl);
  const scheme = parsed.protocol === 'https:' ? 'jsons' : 'json';
  return `${scheme}://${parsed.host}${parsed.pathname}${parsed.search}`;
}

export interface ChangedetectionSensorClientOptions {
  baseUrl: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class ChangedetectionSensorClient implements SensorClient {
  readonly id = 'changedetection';
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: ChangedetectionSensorClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/u, '');
    this.apiKey = options.apiKey?.trim() ?? '';
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async createWatch(input: SensorWatchInput): Promise<SensorWatch> {
    const response = await this.request('/api/v1/watch', {
      method: 'POST',
      body: JSON.stringify({
        url: input.url,
        title: input.title,
        tag: 'product-radar',
        time_between_check_use_default: false,
        time_between_check: { seconds: input.intervalSeconds },
        notification_urls: [appriseJsonUrl(input.webhookUrl)],
        notification_title: `Product Radar ${input.radarWatchId}`,
        notification_format: 'text',
        notification_body: JSON.stringify({
          radarWatchId: input.radarWatchId,
          sensorWatchId: 'pending',
        }),
      }),
    });
    const body = asRecord(response.body);
    const id = String(body.uuid ?? body.watch_uuid ?? body.id ?? '').trim();
    if (!id) throw new SensorUnavailableError('changedetection createWatch returned no watch id', { body });
    try {
      await this.request(`/api/v1/watch/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify({
            notification_format: 'text',
          notification_body: JSON.stringify({ radarWatchId: input.radarWatchId, sensorWatchId: id }),
        }),
      });
    } catch (error) {
      try { await this.deleteWatch(id); } catch { /* best-effort compensation */ }
      throw error;
    }
    return { id, url: input.url, raw: response.body };
  }

  async updateWatch(sensorId: string, input: Partial<SensorWatchInput>): Promise<SensorWatch | undefined> {
    const payload: JsonRecord = {};
    if (input.url !== undefined) payload.url = input.url;
    if (input.title !== undefined) payload.title = input.title;
    if (input.intervalSeconds !== undefined) {
      payload.time_between_check_use_default = false;
      payload.time_between_check = { seconds: input.intervalSeconds };
    }
    if (input.webhookUrl !== undefined) payload.notification_urls = [appriseJsonUrl(input.webhookUrl)];
    const response = await this.request(`/api/v1/watch/${encodeURIComponent(sensorId)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    return this.toSensorWatch(response.body, sensorId);
  }

  async pauseWatch(sensorId: string): Promise<void> {
    await this.request(`/api/v1/watch/${encodeURIComponent(sensorId)}`, {
      method: 'PUT',
      body: JSON.stringify({ paused: true }),
    });
  }

  async resumeWatch(sensorId: string): Promise<void> {
    await this.request(`/api/v1/watch/${encodeURIComponent(sensorId)}`, {
      method: 'PUT',
      body: JSON.stringify({ paused: false }),
    });
  }

  async deleteWatch(sensorId: string): Promise<void> {
    await this.request(`/api/v1/watch/${encodeURIComponent(sensorId)}`, { method: 'DELETE' });
  }

  async getWatch(sensorId: string): Promise<SensorWatch | undefined> {
    try {
      const response = await this.request(`/api/v1/watch/${encodeURIComponent(sensorId)}`, { method: 'GET' });
      return this.toSensorWatch(response.body, sensorId);
    } catch (error) {
      if (error instanceof SensorUnavailableError && error.details && typeof error.details === 'object' && (error.details as JsonRecord).status === 404) {
        return undefined;
      }
      throw error;
    }
  }

  async health(): Promise<SensorHealth> {
    try {
      const response = await this.request('/api/v1/watch', { method: 'GET' });
      return { ok: response.status >= 200 && response.status < 300, status: 'ok', details: response.body };
    } catch (error) {
      return {
        ok: false,
        status: error instanceof SensorUnavailableError ? error.code : 'unavailable',
        ...(error instanceof Error ? { details: error.message } : {}),
      };
    }
  }

  private toSensorWatch(body: unknown, fallbackId: string): SensorWatch | undefined {
    const value = asRecord(body);
    const id = String(value.uuid ?? value.watch_uuid ?? value.id ?? fallbackId).trim();
    if (!id) return undefined;
    return {
      id,
      ...(typeof value.url === 'string' ? { url: value.url } : {}),
      ...(typeof value.paused === 'boolean' ? { paused: value.paused } : {}),
      raw: body,
    };
  }

  private async request(path: string, init: RequestInit): Promise<{ status: number; body: unknown }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers = new Headers(init.headers);
      headers.set('Accept', 'application/json');
      if (init.body !== undefined) headers.set('Content-Type', 'application/json');
      if (this.apiKey) headers.set('x-api-key', this.apiKey);
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, headers, signal: controller.signal });
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        body = undefined;
      }
      if (!response.ok) {
        throw new SensorUnavailableError(`changedetection returned HTTP ${response.status}`, { status: response.status, body });
      }
      return { status: response.status, body };
    } catch (error) {
      if (error instanceof SensorUnavailableError) throw error;
      throw new SensorUnavailableError(`changedetection request failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearTimeout(timer);
    }
  }
}
