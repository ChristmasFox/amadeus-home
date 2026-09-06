import { request as httpRequest, type RequestOptions } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ServiceDefinition } from '../schema/types.js';

const execFileAsync = promisify(execFile);

/** The only container names that the built-in Docker boundary may address. */
export const DEFAULT_DOCKER_ALLOWED_CONTAINERS = Object.freeze([
  'langbot',
  'pubg-query-engine-v3',
  'n8n',
  'postgres',
  'redis',
  'emby',
  'jellyfin',
  'qbittorrent',
  'aria2',
  'glances',
] as const);

/** A command that is executed by one of HomeHub's explicit runtime boundaries. */
export interface CommandSpec {
  command: string;
  args?: readonly string[];
  timeoutMs?: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Used only by the LangBot component executor. */
  containerName?: string;
}

export interface CommandExecution {
  ok: boolean;
  executorAvailable: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  error?: string;
}

export type ExecutorKind = 'docker' | 'ubuntu' | 'macos-host' | 'langbot-component';

/**
 * The only process boundary used by HomeHub. Implementations are injectable so
 * health and action logic can be tested without touching the host runtime.
 */
export interface CommandExecutor {
  readonly kind: ExecutorKind;
  execute(spec: CommandSpec): Promise<CommandExecution>;
}

interface ChildProcessExecutorOptions {
  supportedPlatforms?: readonly NodeJS.Platform[];
  primaryCommand: string;
}

class ChildProcessCommandExecutor implements CommandExecutor {
  constructor(
    readonly kind: ExecutorKind,
    private readonly options: ChildProcessExecutorOptions,
  ) {}

  async execute(spec: CommandSpec): Promise<CommandExecution> {
    if (this.options.supportedPlatforms && !this.options.supportedPlatforms.includes(process.platform)) {
      return unavailableResult(`${this.kind} executor is unavailable on ${process.platform}`);
    }

    const args = [...(spec.args ?? [])];
    const timeout = Number.isFinite(spec.timeoutMs) ? Math.max(1, spec.timeoutMs ?? 30_000) : 30_000;
    try {
      const result = await execFileAsync(spec.command, args, {
        cwd: spec.cwd,
        env: spec.env ? { ...process.env, ...spec.env } : process.env,
        timeout,
        maxBuffer: 2 * 1024 * 1024,
        windowsHide: true,
      });
      return {
        ok: true,
        executorAvailable: true,
        stdout: String(result.stdout ?? ''),
        stderr: String(result.stderr ?? ''),
        exitCode: 0,
      };
    } catch (error) {
      const detail = error as Error & {
        code?: string | number;
        stdout?: string;
        stderr?: string;
        killed?: boolean;
      };
      const stdout = String(detail.stdout ?? '');
      const stderr = String(detail.stderr ?? '');
      const code = typeof detail.code === 'number' ? detail.code : null;
      const commandUnavailable = detail.code === 'ENOENT' && spec.command === this.options.primaryCommand;
      const dockerUnavailable = this.kind === 'docker'
        && /cannot connect to the docker daemon|is the docker daemon running|permission denied.*docker\.sock/i.test(`${stderr}\n${detail.message}`);
      return {
        ok: false,
        executorAvailable: !(commandUnavailable || dockerUnavailable),
        stdout,
        stderr,
        exitCode: code,
        error: detail.message || String(error),
      };
    }
  }
}

export interface DockerApiExecutorOptions {
  socketPath?: string;
  apiVersion?: string;
  allowedContainers?: readonly string[];
  requestTimeoutMs?: number;
  maxResponseBytes?: number;
}

interface DockerContainerSummary {
  Id?: string;
  Names?: string[];
  State?: string;
  Status?: string;
}

interface DockerInspectResult {
  Id?: string;
  Name?: string;
  Created?: string;
  RestartCount?: number;
  Config?: { Image?: string };
  State?: {
    Status?: string;
    Running?: boolean;
    Paused?: boolean;
    Restarting?: boolean;
    ExitCode?: number;
    OOMKilled?: boolean;
    Health?: { Status?: string };
  };
}

interface DockerHttpResponse {
  statusCode: number;
  body: Buffer;
}

const ALLOWED_DOCKER_PS_FORMATS = new Set([
  '{{.Names}}|{{.State}}|{{.Status}}',
  '{{.Names}}',
  '{{.State}}',
  '{{.ID}}',
]);
const ALLOWED_DOCKER_INSPECT_FORMATS = new Set([
  '{{.Id}}',
  '{{.ID}}',
  '{{.Name}}',
  '{{.State.Status}}',
  '{{.State.Health.Status}}',
  '{{.State.Running}}',
  '{{.State.ExitCode}}',
]);

/**
 * Restricted Docker Engine API client.
 *
 * It intentionally does not invoke a shell, Docker Compose, `exec`, `run`,
 * `rm`, or any other arbitrary Docker command. The Unix socket is the only
 * transport and every target must be an exact name from the allowlist.
 */
export class DockerApiCommandExecutor implements CommandExecutor {
  readonly kind = 'docker' as const;

  private readonly socketPath: string;
  private readonly apiVersion: string;
  private readonly allowedContainers: ReadonlySet<string>;
  private readonly requestTimeoutMs: number;
  private readonly maxResponseBytes: number;

  constructor(options: DockerApiExecutorOptions = {}) {
    this.socketPath = options.socketPath ?? process.env.DOCKER_SOCKET_PATH ?? '/var/run/docker.sock';
    this.apiVersion = (options.apiVersion ?? process.env.DOCKER_API_VERSION ?? 'v1.41').replace(/^\/+|\/+$/gu, '');
    this.allowedContainers = new Set(options.allowedContainers ?? DEFAULT_DOCKER_ALLOWED_CONTAINERS);
    this.requestTimeoutMs = Math.max(100, options.requestTimeoutMs ?? 30_000);
    this.maxResponseBytes = Math.max(64 * 1024, options.maxResponseBytes ?? 2 * 1024 * 1024);
  }

  async execute(spec: CommandSpec): Promise<CommandExecution> {
    if (spec.command !== 'docker') {
      return policyDenied(`Docker executor only accepts the docker command, got ${spec.command}`);
    }

    const args = [...(spec.args ?? [])];
    const operation = args.shift();
    if (!operation) return policyDenied('Docker command is missing an operation');

    switch (operation) {
      case 'ps':
        return this.listContainers(args, spec.timeoutMs);
      case 'inspect':
        return this.inspectContainer(args, spec.timeoutMs);
      case 'logs':
        return this.readLogs(args, spec.timeoutMs);
      case 'stats':
        return this.readStats(args, spec.timeoutMs);
      case 'start':
        return this.mutateContainer('start', args, spec.timeoutMs);
      case 'restart':
        return this.mutateContainer('restart', args, spec.timeoutMs);
      default:
        return policyDenied(`Docker operation is not allowed: ${operation}`);
    }
  }

  private async listContainers(args: string[], timeoutMs?: number): Promise<CommandExecution> {
    let all = false;
    let quiet = false;
    let format: string | null = null;
    let filterName: string | null = null;

    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index];
      if (!arg) return policyDenied('Docker ps option is missing');
      if (arg === '-a' || arg === '--all') {
        all = true;
      } else if (arg === '-q' || arg === '--quiet') {
        quiet = true;
      } else if (arg === '--format') {
        const value = args[index + 1];
        if (!value) return policyDenied('Docker ps --format requires a value');
        format = value;
        index += 1;
      } else if (arg === '--filter') {
        const value = args[index + 1];
        if (!value) return policyDenied('Docker ps --filter requires a value');
        const name = this.parseExactNameFilter(value);
        if (!name) return policyDenied('Docker ps only permits an exact allowlisted name filter');
        if (filterName && filterName !== name) return policyDenied('Docker ps permits only one container filter');
        filterName = name;
        index += 1;
      } else {
        return policyDenied(`Docker ps option is not allowed: ${arg}`);
      }
    }

    if (format && !ALLOWED_DOCKER_PS_FORMATS.has(format)) {
      return policyDenied('Docker ps format is not allowlisted');
    }

    const response = await this.apiRequest('/containers/json', {
      query: { all: all ? '1' : '0' },
      timeoutMs,
    });
    if (!response.ok) return response.result;

    const parsed = this.parseJson<DockerContainerSummary[]>(response.response.body);
    if (!Array.isArray(parsed)) return daemonFailure('Docker returned an invalid container list');

    const containers = parsed
      .map((container) => ({ ...container, name: this.primaryName(container) }))
      .filter((container) => container.name !== null && this.allowedContainers.has(container.name))
      .filter((container) => !filterName || container.name === filterName)
      .sort((left, right) => String(left.name).localeCompare(String(right.name)));

    const lines = containers.map((container) => {
      if (quiet || format === '{{.ID}}') return String(container.Id ?? '');
      if (format === '{{.Names}}') return String(container.name ?? '');
      if (format === '{{.State}}') return String(container.State ?? '');
      if (format === '{{.Names}}|{{.State}}|{{.Status}}') {
        return `${container.name ?? ''}|${container.State ?? ''}|${container.Status ?? ''}`;
      }
      return `${container.name ?? ''}|${container.State ?? ''}|${container.Status ?? ''}`;
    }).filter(Boolean);

    return successResult(`${lines.join('\n')}${lines.length ? '\n' : ''}`);
  }

  private async inspectContainer(args: string[], timeoutMs?: number): Promise<CommandExecution> {
    const parsed = this.parseInspectArgs(args);
    if (!parsed.ok) return parsed.result;
    const container = await this.findContainer(parsed.target, timeoutMs);
    if (!container.ok) return container.result;

    const response = await this.apiRequest(`/containers/${encodeURIComponent(container.container.Id ?? '')}/json`, { timeoutMs });
    if (!response.ok) return response.result;
    const inspect = this.parseJson<DockerInspectResult>(response.response.body);
    if (!inspect || typeof inspect !== 'object') return daemonFailure('Docker returned an invalid inspect response');

    if (parsed.format) {
      let value: string;
      switch (parsed.format) {
        case '{{.Id}}':
        case '{{.ID}}':
          value = String(inspect.Id ?? '');
          break;
        case '{{.Name}}':
          value = String(inspect.Name ?? parsed.target);
          break;
        case '{{.State.Status}}':
          value = String(inspect.State?.Status ?? '');
          break;
        case '{{.State.Health.Status}}':
          value = String(inspect.State?.Health?.Status ?? '');
          break;
        case '{{.State.Running}}':
          value = String(inspect.State?.Running ?? false);
          break;
        case '{{.State.ExitCode}}':
          value = String(inspect.State?.ExitCode ?? 0);
          break;
        default:
          return policyDenied('Docker inspect format is not allowlisted');
      }
      return successResult(`${value}\n`);
    }

    // Never expose the full inspect payload: Config.Env can contain bot tokens
    // and API keys. Return only the fields HomeHub needs for observation.
    return successResult(`${JSON.stringify({
      id: inspect.Id ?? null,
      name: this.normalizeContainerName(inspect.Name ?? parsed.target),
      created: inspect.Created ?? null,
      restartCount: typeof inspect.RestartCount === 'number' ? inspect.RestartCount : null,
      image: inspect.Config?.Image ?? null,
      state: {
        status: inspect.State?.Status ?? null,
        running: inspect.State?.Running ?? false,
        paused: inspect.State?.Paused ?? false,
        restarting: inspect.State?.Restarting ?? false,
        exitCode: inspect.State?.ExitCode ?? null,
        oomKilled: inspect.State?.OOMKilled ?? false,
        health: inspect.State?.Health?.Status ?? null,
      },
    })}\n`);
  }

  private async readLogs(args: string[], timeoutMs?: number): Promise<CommandExecution> {
    let tail = 200;
    let target: string | null = null;
    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index];
      if (!arg) return policyDenied('Docker logs option is missing');
      if (arg === '--tail') {
        const value = args[index + 1];
        if (!value || !/^\d+$/u.test(value)) return policyDenied('Docker logs --tail must be a non-negative integer');
        tail = Number(value);
        index += 1;
      } else if (arg.startsWith('-')) {
        return policyDenied(`Docker logs option is not allowed: ${arg}`);
      } else if (target) {
        return policyDenied('Docker logs accepts one allowlisted container');
      } else {
        target = arg;
      }
    }
    if (!target) return policyDenied('Docker logs requires a container');
    if (tail > 200) return policyDenied('Docker logs tail is capped at 200 lines');

    const container = await this.findContainer(target, timeoutMs);
    if (!container.ok) return container.result;
    const response = await this.apiRequest(`/containers/${encodeURIComponent(container.container.Id ?? '')}/logs`, {
      query: { stdout: '1', stderr: '1', tail: String(tail), timestamps: '0' },
      timeoutMs,
    });
    if (!response.ok) return response.result;
    return successResult(`${decodeDockerLogStream(response.response.body)}${response.response.body.length ? '' : ''}`);
  }

  private async readStats(args: string[], timeoutMs?: number): Promise<CommandExecution> {
    let noStream = false;
    let format: string | null = null;
    let target: string | null = null;
    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index];
      if (!arg) return policyDenied('Docker stats option is missing');
      if (arg === '--no-stream') {
        noStream = true;
      } else if (arg === '--format') {
        const value = args[index + 1];
        if (!value) return policyDenied('Docker stats --format requires a value');
        format = value;
        index += 1;
      } else if (arg.startsWith('-')) {
        return policyDenied(`Docker stats option is not allowed: ${arg}`);
      } else if (target) {
        return policyDenied('Docker stats accepts one allowlisted container');
      } else {
        target = arg;
      }
    }
    if (!noStream) return policyDenied('Docker stats requires --no-stream');
    if (format !== '{{.CPUPerc}}|{{.MemPerc}}') return policyDenied('Docker stats format is not allowlisted');
    if (!target) return policyDenied('Docker stats requires a container');

    const container = await this.findContainer(target, timeoutMs);
    if (!container.ok) return container.result;
    const response = await this.apiRequest(`/containers/${encodeURIComponent(container.container.Id ?? '')}/stats`, {
      query: { stream: 'false' },
      timeoutMs,
    });
    if (!response.ok) return response.result;
    const stats = this.parseJson<Record<string, any>>(response.response.body);
    if (!stats || typeof stats !== 'object') return daemonFailure('Docker returned an invalid stats response');

    const cpu = stats.cpu_stats ?? {};
    const previousCpu = stats.precpu_stats ?? {};
    const cpuDelta = Number(cpu.cpu_usage?.total_usage ?? 0) - Number(previousCpu.cpu_usage?.total_usage ?? 0);
    const systemDelta = Number(cpu.system_cpu_usage ?? 0) - Number(previousCpu.system_cpu_usage ?? 0);
    const onlineCpus = Number(cpu.online_cpus ?? cpu.cpu_usage?. percpu_usage?.length ?? 1) || 1;
    const cpuPercent = systemDelta > 0 && cpuDelta >= 0 ? (cpuDelta / systemDelta) * onlineCpus * 100 : 0;

    const memory = stats.memory_stats ?? {};
    const memoryUsage = Math.max(0, Number(memory.usage ?? 0) - Number(memory.stats?.cache ?? 0));
    const memoryLimit = Number(memory.limit ?? 0);
    const memoryPercent = memoryLimit > 0 ? (memoryUsage / memoryLimit) * 100 : 0;

    return successResult(`${cpuPercent.toFixed(2)}%|${memoryPercent.toFixed(2)}%\n`);
  }

  private async mutateContainer(operation: 'start' | 'restart', args: string[], timeoutMs?: number): Promise<CommandExecution> {
    if (args.some((arg) => arg.startsWith('-'))) return policyDenied(`Docker ${operation} options are not allowed`);
    if (args.length !== 1) return policyDenied(`Docker ${operation} accepts one allowlisted container`);
    const target = args[0] ?? null;
    if (!target || !this.allowedContainers.has(target)) return policyDenied(`Container is not allowlisted: ${target ?? ''}`);

    const container = await this.findContainer(target, timeoutMs);
    if (!container.ok) return container.result;
    const suffix = operation === 'restart' ? '?t=10' : '';
    const response = await this.apiRequest(`/containers/${encodeURIComponent(container.container.Id ?? '')}/${operation}${suffix}`, {
      method: 'POST',
      timeoutMs,
    });
    if (!response.ok) return response.result;
    if (![204, 304].includes(response.response.statusCode)) return daemonFailure(`Docker ${operation} returned HTTP ${response.response.statusCode}`);
    return successResult('');
  }

  private parseInspectArgs(args: string[]): { ok: true; target: string; format: string | null } | { ok: false; result: CommandExecution } {
    let format: string | null = null;
    let target: string | null = null;
    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index];
      if (!arg) return { ok: false, result: policyDenied('Docker inspect option is missing') };
      if (arg === '--format' || arg === '-f') {
        const value = args[index + 1];
        if (!value) return { ok: false, result: policyDenied('Docker inspect format requires a value') };
        format = value;
        index += 1;
      } else if (arg.startsWith('-')) {
        return { ok: false, result: policyDenied(`Docker inspect option is not allowed: ${arg}`) };
      } else if (target) {
        return { ok: false, result: policyDenied('Docker inspect accepts one allowlisted container') };
      } else {
        target = arg;
      }
    }
    if (!target) return { ok: false, result: policyDenied('Docker inspect requires a container') };
    if (!this.allowedContainers.has(target)) return { ok: false, result: policyDenied(`Container is not allowlisted: ${target}`) };
    if (format && !ALLOWED_DOCKER_INSPECT_FORMATS.has(format)) return { ok: false, result: policyDenied('Docker inspect format is not allowlisted') };
    return { ok: true, target, format };
  }

  private parseExactNameFilter(value: string): string | null {
    const match = /^name=\^([A-Za-z0-9][A-Za-z0-9_.-]*)\$$/u.exec(value);
    const name = match?.[1];
    return name && this.allowedContainers.has(name) ? name : null;
  }

  private async findContainer(target: string, timeoutMs?: number): Promise<{ ok: true; container: DockerContainerSummary & { name: string } } | { ok: false; result: CommandExecution }> {
    if (!this.allowedContainers.has(target)) return { ok: false, result: policyDenied(`Container is not allowlisted: ${target}`) };
    const response = await this.apiRequest('/containers/json', { query: { all: '1' }, timeoutMs });
    if (!response.ok) return { ok: false, result: response.result };
    const parsed = this.parseJson<DockerContainerSummary[]>(response.response.body);
    if (!Array.isArray(parsed)) return { ok: false, result: daemonFailure('Docker returned an invalid container list') };
    const container = parsed
      .map((candidate) => ({ ...candidate, name: this.primaryName(candidate) }))
      .find((candidate): candidate is DockerContainerSummary & { name: string } => candidate.name === target);
    if (!container) {
      return {
        ok: false,
        result: {
          ok: false,
          executorAvailable: true,
          stdout: '',
          stderr: '',
          exitCode: 1,
          error: `Allowlisted container not found: ${target}`,
        },
      };
    }
    if (!container.Id) return { ok: false, result: daemonFailure(`Docker container ${target} has no ID`) };
    return { ok: true, container };
  }

  private primaryName(container: DockerContainerSummary): string | null {
    const value = container.Names?.map((name) => this.normalizeContainerName(name)).find((name) => this.allowedContainers.has(name));
    return value ?? null;
  }

  private normalizeContainerName(value: string): string {
    return value.replace(/^\/+/, '');
  }

  private parseJson<T>(body: Buffer): T | null {
    try {
      return JSON.parse(body.toString('utf8')) as T;
    } catch {
      return null;
    }
  }

  private async apiRequest(
    path: string,
    options: { method?: 'GET' | 'POST'; query?: Record<string, string>; timeoutMs?: number | undefined } = {},
  ): Promise<{ ok: true; response: DockerHttpResponse } | { ok: false; result: CommandExecution }> {
    const query = options.query ? `?${new URLSearchParams(options.query).toString()}` : '';
    const apiPath = `/${this.apiVersion}${path}${query}`;
    const timeoutMs = Math.max(100, options.timeoutMs ?? this.requestTimeoutMs);

    try {
      const response = await this.requestUnixSocket({
        socketPath: this.socketPath,
        path: apiPath,
        method: options.method ?? 'GET',
        timeoutMs,
      });
      if (response.statusCode < 200 || response.statusCode >= 400) {
        return {
          ok: false,
          result: {
            ok: false,
            executorAvailable: true,
            stdout: '',
            stderr: safeDockerError(response.body),
            exitCode: response.statusCode,
            error: `Docker API HTTP ${response.statusCode}`,
          },
        };
      }
      return { ok: true, response };
    } catch (error) {
      return transportFailure(error);
    }
  }

  private requestUnixSocket(options: { socketPath: string; path: string; method: 'GET' | 'POST'; timeoutMs: number }): Promise<DockerHttpResponse> {
    return new Promise((resolve, reject) => {
      const requestOptions: RequestOptions = {
        socketPath: options.socketPath,
        path: options.path,
        method: options.method,
        headers: { accept: 'application/json, text/plain, */*' },
      };
      const req = httpRequest(requestOptions, (response) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on('data', (chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          bytes += buffer.length;
          if (bytes > this.maxResponseBytes) {
            req.destroy(new Error('Docker API response exceeded the bounded limit'));
            return;
          }
          chunks.push(buffer);
        });
        response.on('end', () => resolve({ statusCode: response.statusCode ?? 0, body: Buffer.concat(chunks) }));
      });
      req.setTimeout(options.timeoutMs, () => req.destroy(new Error('Docker API request timed out')));
      req.on('error', reject);
      req.end();
    });
  }
}

class UnavailableCommandExecutor implements CommandExecutor {
  constructor(
    readonly kind: ExecutorKind,
    private readonly reason: string,
  ) {}

  async execute(_spec: CommandSpec): Promise<CommandExecution> {
    return unavailableResult(this.reason);
  }
}

/**
 * Component executor retained as a compatibility boundary, but deliberately
 * limited to the same Docker observation/start/restart policy. In particular,
 * it never translates a component command into `docker exec`.
 */
class LangBotComponentCommandExecutor implements CommandExecutor {
  readonly kind = 'langbot-component' as const;

  constructor(
    private readonly dockerExecutor: CommandExecutor,
    private readonly defaultContainerName: string,
  ) {}

  async execute(spec: CommandSpec): Promise<CommandExecution> {
    if (spec.command !== 'docker') return policyDenied('LangBot component executor does not run arbitrary commands');
    const args = [...(spec.args ?? [])];
    const operation = args[0];
    if (operation === 'exec' || operation === 'compose' || operation === 'run') {
      return policyDenied(`LangBot component Docker operation is not allowed: ${operation}`);
    }
    if (!operation) return policyDenied('LangBot component Docker operation is missing');

    // A component boundary may only address its configured host container. The
    // Docker executor performs the final global allowlist validation as well.
    if (operation === 'start' || operation === 'restart') {
      if (args.length !== 2 || args[1] !== this.defaultContainerName) {
        return policyDenied('LangBot component may only start/restart its configured host container');
      }
    }
    if (operation === 'inspect' || operation === 'logs' || operation === 'stats') {
      const target = args[args.length - 1];
      if (target && target !== this.defaultContainerName) return policyDenied('LangBot component may only observe its configured host container');
    }

    return this.dockerExecutor.execute({ ...spec, args });
  }
}

function successResult(stdout: string): CommandExecution {
  return { ok: true, executorAvailable: true, stdout, stderr: '', exitCode: 0 };
}

function policyDenied(error: string): CommandExecution {
  return { ok: false, executorAvailable: true, stdout: '', stderr: '', exitCode: 2, error };
}

function unavailableResult(error: string): CommandExecution {
  return {
    ok: false,
    executorAvailable: false,
    stdout: '',
    stderr: '',
    exitCode: null,
    error,
  };
}

function daemonFailure(error: string): CommandExecution {
  return { ok: false, executorAvailable: true, stdout: '', stderr: '', exitCode: 1, error };
}

function transportFailure(error: unknown): { ok: false; result: CommandExecution } {
  const detail = error as NodeJS.ErrnoException;
  const code = typeof detail?.code === 'string' ? detail.code : '';
  const message = String(detail?.message ?? 'Docker socket request failed');
  const unavailable = new Set(['EACCES', 'ECONNREFUSED', 'ECONNRESET', 'ENOENT', 'ENOTSOCK', 'EPERM', 'ETIMEDOUT']).has(code)
    || /docker socket|socket|daemon|timed out/i.test(message);
  return {
    ok: false,
    result: unavailable
      ? unavailableResult('docker executor unavailable')
      : { ok: false, executorAvailable: true, stdout: '', stderr: '', exitCode: null, error: 'Docker request failed' },
  };
}

function safeDockerError(body: Buffer): string {
  const text = body.toString('utf8').replace(/[\r\n]+/gu, ' ').trim();
  return text.slice(0, 300);
}

function decodeDockerLogStream(body: Buffer): string {
  // The Engine API multiplexes stdout/stderr for non-TTY containers. Demux the
  // documented 8-byte headers while tolerating plain text responses.
  const chunks: Buffer[] = [];
  let offset = 0;
  while (offset + 8 <= body.length) {
    const size = body.readUInt32BE(offset + 4);
    const end = offset + 8 + size;
    if (end > body.length) return body.toString('utf8');
    chunks.push(body.subarray(offset + 8, end));
    offset = end;
  }
  return offset === body.length ? Buffer.concat(chunks).toString('utf8') : body.toString('utf8');
}

export interface RuntimeExecutorManagerOptions {
  executors?: Partial<Record<ExecutorKind, CommandExecutor>>;
  langbotContainerName?: string;
  dockerSocketPath?: string;
  dockerApiVersion?: string;
  dockerAllowedContainers?: readonly string[];
}

/**
 * Routes commands to an explicit executor. No executor ever shells through a
 * different host or silently falls back to another runtime.
 */
export class RuntimeExecutorManager {
  private readonly executors: Record<ExecutorKind, CommandExecutor>;

  constructor(options: RuntimeExecutorManagerOptions = {}) {
    const provided = options.executors ?? {};
    const docker = provided.docker ?? new DockerApiCommandExecutor({
      ...(options.dockerSocketPath ? { socketPath: options.dockerSocketPath } : {}),
      ...(options.dockerApiVersion ? { apiVersion: options.dockerApiVersion } : {}),
      ...(options.dockerAllowedContainers ? { allowedContainers: options.dockerAllowedContainers } : {}),
    });
    this.executors = {
      docker,
      ubuntu: provided.ubuntu ?? new ChildProcessCommandExecutor('ubuntu', {
        primaryCommand: 'bash',
        supportedPlatforms: ['linux'],
      }),
      'macos-host': provided['macos-host'] ?? new ChildProcessCommandExecutor('macos-host', {
        primaryCommand: 'bash',
        supportedPlatforms: ['darwin'],
      }),
      'langbot-component': provided['langbot-component']
        ?? new LangBotComponentCommandExecutor(docker, options.langbotContainerName ?? 'langbot'),
    };
  }

  getExecutor(kind: ExecutorKind): CommandExecutor {
    return this.executors[kind];
  }

  async execute(kind: ExecutorKind, spec: CommandSpec): Promise<CommandExecution> {
    return this.getExecutor(kind).execute(spec);
  }

  async executeForService(service: Pick<ServiceDefinition, 'executor' | 'component'>, spec: CommandSpec): Promise<CommandExecution> {
    const componentName = service.executor === 'langbot-component'
      ? service.component?.containerName
      : undefined;
    return this.execute(service.executor, componentName ? { ...spec, containerName: componentName } : spec);
  }
}

export function isExecutorUnavailable(result: CommandExecution): boolean {
  return !result.executorAvailable;
}
