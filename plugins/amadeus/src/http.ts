export interface JsonRequestOptions {
  method?: string;
  headers?: Record<string, string> | undefined;
  body?: unknown;
  timeoutMs?: number;
  signal?: AbortSignal | undefined;
  includeErrorDetail?: boolean;
}

export async function requestJson(url: string, options: JsonRequestOptions = {}): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
  const abort = (): void => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  try {
    const headers = new Headers({ Accept: 'application/json', ...(options.headers ?? {}) });
    const init: RequestInit = { method: options.method ?? 'GET', headers, signal: controller.signal };
    if (options.body !== undefined) {
      headers.set('Content-Type', 'application/json');
      init.body = JSON.stringify(options.body);
    }
    const response = await fetch(url, init);
    const text = (await response.text()).slice(0, 2_000_000);
    let payload: unknown = undefined;
    try { payload = text ? JSON.parse(text) as unknown : undefined; } catch { payload = text; }
    if (!response.ok) {
      const detail = options.includeErrorDetail === false
        ? ''
        : payload && typeof payload === 'object' ? JSON.stringify(payload).slice(0, 500) : String(payload ?? '');
      throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}${detail ? `: ${detail}` : ''}`);
    }
    return payload;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}

export async function requestFormJson(url: string, fields: Record<string, string>, options: Omit<JsonRequestOptions, 'body'> = {}): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
  const abort = (): void => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  try {
    const headers = new Headers({ Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', ...(options.headers ?? {}) });
    const response = await fetch(url, {
      method: options.method ?? 'POST',
      headers,
      body: new URLSearchParams(fields).toString(),
      signal: controller.signal,
    });
    const text = (await response.text()).slice(0, 2_000_000);
    let payload: unknown = undefined;
    try { payload = text ? JSON.parse(text) as unknown : undefined; } catch { payload = text; }
    if (!response.ok) {
      const detail = options.includeErrorDetail === false
        ? ''
        : payload && typeof payload === 'object' ? JSON.stringify(payload).slice(0, 500) : String(payload ?? '');
      throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}${detail ? `: ${detail}` : ''}`);
    }
    return payload;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}

export async function requestText(url: string, options: Omit<JsonRequestOptions, 'body'> & { body?: string } = {}): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);
  const abort = (): void => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  try {
    const headers = new Headers({ Accept: 'application/xml,text/xml,text/plain,*/*', ...(options.headers ?? {}) });
    const response = await fetch(url, { method: options.method ?? 'GET', headers, signal: controller.signal, ...(options.body === undefined ? {} : { body: options.body }) });
    const text = (await response.text()).slice(0, 2_000_000);
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}`);
    return text;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}
