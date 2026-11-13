/**
 * A minimal client for Luckin's official AI open platform MCP server (streamable HTTP, JSON-RPC).
 * Tool names and arguments follow the public documentation at open.lkcoffee.com; the caller supplies the Bearer token
 * the user obtained through Luckin's own sign-in. Nothing here signs in, refreshes or derives a token.
 */
export const LUCKIN_MCP_URL = 'https://gwmcp.lkcoffee.com/order/user/mcp';
export const LUCKIN_MCP_HOST_SUFFIX = '.lkcoffee.com';
const REQUEST_TIMEOUT_MS = 20_000;
const PROTOCOL_VERSION = '2025-03-26';

export type LuckinFetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal; redirect: 'manual' }) => Promise<Response>;

export class LuckinError extends Error {
  constructor(readonly reason: 'unauthorized' | 'http' | 'protocol' | 'tool', message: string, readonly status?: number) { super(message); }
}

type Envelope = { code?: number; msg?: string; data?: unknown; success?: boolean };

function parseBody(contentType: string, raw: string): unknown {
  if (contentType.includes('text/event-stream')) {
    const events = raw.split(/\r?\n\r?\n/u).flatMap((block) => block.split(/\r?\n/u).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim())).filter(Boolean);
    for (const data of events.reverse()) { try { const value = JSON.parse(data) as unknown; if (value && typeof value === 'object' && ('result' in value || 'error' in value)) return value; } catch { /* next */ } }
    throw new LuckinError('protocol', 'luckin_empty_event_stream');
  }
  try { return JSON.parse(raw) as unknown; } catch { throw new LuckinError('protocol', 'luckin_invalid_json'); }
}

export class LuckinClient {
  constructor(private readonly options: { url?: string; fetch?: LuckinFetch } = {}) {
    const host = new URL(options.url ?? LUCKIN_MCP_URL);
    if (host.protocol !== 'https:' || !host.hostname.endsWith(LUCKIN_MCP_HOST_SUFFIX)) throw new Error('luckin_mcp_url_must_be_official_https');
  }

  private async post(token: string, body: unknown, sessionId?: string): Promise<{ payload: unknown; sessionId?: string }> {
    const doFetch: LuckinFetch = this.options.fetch ?? ((url, init) => fetch(url, init));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await doFetch(this.options.url ?? LUCKIN_MCP_URL, {
        method: 'POST',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
        },
        body: JSON.stringify(body),
      });
      if (response.status === 401 || response.status === 403) throw new LuckinError('unauthorized', 'luckin_unauthorized', response.status);
      if (!response.ok && response.status !== 202) throw new LuckinError('http', `luckin_http_${response.status}`, response.status);
      const raw = await response.text();
      const sid = response.headers.get('mcp-session-id') ?? sessionId;
      return { payload: raw.trim() ? parseBody(response.headers.get('content-type') ?? '', raw) : undefined, ...(sid ? { sessionId: sid } : {}) };
    } catch (error) {
      if (error instanceof LuckinError) throw error;
      throw new LuckinError('http', 'luckin_unreachable');
    } finally {
      clearTimeout(timer);
    }
  }

  /** Calls one documented tool and returns the `data` of the platform's `{code,msg,data,success}` envelope. */
  async callTool(token: string, name: string, args: Record<string, unknown>): Promise<unknown> {
    // An empty capability set on purpose: the platform's server rejects clients that advertise sampling tools.
    const init = await this.post(token, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'amadeus-lab', version: '1.0.0' } } });
    await this.post(token, { jsonrpc: '2.0', method: 'notifications/initialized' }, init.sessionId);
    const called = await this.post(token, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } }, init.sessionId);
    const message = called.payload as { result?: { isError?: boolean; content?: Array<{ type?: string; text?: string }>; structuredContent?: unknown }; error?: { message?: string } } | undefined;
    if (!message || message.error) throw new LuckinError('protocol', 'luckin_tool_call_failed');
    const result = message.result;
    let envelope: unknown = result?.structuredContent;
    if (envelope === undefined) {
      const text = result?.content?.find((part) => part.type === 'text')?.text;
      if (text === undefined) throw new LuckinError('protocol', 'luckin_tool_result_empty');
      try { envelope = JSON.parse(text); } catch { throw new LuckinError('tool', result?.isError ? 'luckin_tool_error' : 'luckin_tool_result_not_json'); }
    }
    const body = envelope as Envelope;
    if (result?.isError || body.success === false || (typeof body.code === 'number' && body.code !== 0)) throw new LuckinError('tool', typeof body.msg === 'string' ? body.msg.slice(0, 200) : 'luckin_tool_error');
    return body.data;
  }
}
