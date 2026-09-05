import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ServiceDefinition } from '../schema/types.js';

const execFileAsync = promisify(execFile);

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

class UnavailableCommandExecutor implements CommandExecutor {
  constructor(
    readonly kind: ExecutorKind,
    private readonly reason: string,
  ) {}

  async execute(_spec: CommandSpec): Promise<CommandExecution> {
    return unavailableResult(this.reason);
  }
}

class LangBotComponentCommandExecutor implements CommandExecutor {
  readonly kind = 'langbot-component' as const;

  constructor(
    private readonly dockerExecutor: CommandExecutor,
    private readonly defaultContainerName: string,
  ) {}

  async execute(spec: CommandSpec): Promise<CommandExecution> {
    const containerName = spec.containerName ?? this.defaultContainerName;
    if (!containerName) return unavailableResult('LangBot component container is not configured');
    const { containerName: _containerName, ...rest } = spec;
    return this.dockerExecutor.execute({
      ...rest,
      command: 'docker',
      args: ['exec', containerName, spec.command, ...(spec.args ?? [])],
    });
  }
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

export interface RuntimeExecutorManagerOptions {
  executors?: Partial<Record<ExecutorKind, CommandExecutor>>;
  langbotContainerName?: string;
}

/**
 * Routes commands to an explicit executor. No executor ever shells through a
 * different host or silently falls back to another runtime.
 */
export class RuntimeExecutorManager {
  private readonly executors: Record<ExecutorKind, CommandExecutor>;

  constructor(options: RuntimeExecutorManagerOptions = {}) {
    const provided = options.executors ?? {};
    const docker = provided.docker ?? new ChildProcessCommandExecutor('docker', {
      primaryCommand: 'docker',
      supportedPlatforms: ['linux'],
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
