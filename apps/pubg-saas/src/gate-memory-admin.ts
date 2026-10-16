import { pathToFileURL } from 'node:url';
import { Pool } from 'pg';
import { GateMemoryIndexGenerationManager } from './application/gate-memory-index-generation.js';
import { GateMemoryIndexWorker } from './application/gate-memory-index-worker.js';
import { createGateMemoryEmbeddingProvider } from './infrastructure/ai/gate-memory-embedding-provider.js';

const COMMANDS = new Set(['status', 'initialize', 'begin', 'scan', 'pause', 'resume', 'cancel', 'activate', 'work']);
type Target = 'gate-local' | 'gate-staging' | 'gate-prod';

interface AdminArgs {
  command: string;
  target: Target;
  botId: string;
  apply: boolean;
  allowProviderRequests: boolean;
  maxJobs: number;
  scanLimit: number;
}

export function parseGateMemoryAdminArgs(args: string[]): AdminArgs {
  const command = args[0] ?? '';
  if (!COMMANDS.has(command)) throw new Error('gate_memory_admin_command_invalid');
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 1; index < args.length; index += 1) {
    const key = args[index]!;
    if (key === '--apply' || key === '--allow-provider-requests') {
      if (flags.has(key)) throw new Error('gate_memory_admin_arguments_invalid');
      flags.add(key);
      continue;
    }
    if (!['--target', '--bot-id', '--max-jobs', '--scan-limit'].includes(key)
      || index + 1 >= args.length || values.has(key)) {
      throw new Error('gate_memory_admin_arguments_invalid');
    }
    values.set(key, args[++index]!);
  }
  const target = values.get('--target');
  const botId = values.get('--bot-id');
  const maxJobs = Number(values.get('--max-jobs') ?? '20');
  const scanLimit = Number(values.get('--scan-limit') ?? '50');
  if (!['gate-local', 'gate-staging', 'gate-prod'].includes(target ?? '')
    || !botId || botId.length > 128 || /[\u0000-\u001f\u007f]/u.test(botId)
    || !Number.isSafeInteger(maxJobs) || maxJobs < 1 || maxJobs > 100
    || !Number.isSafeInteger(scanLimit) || scanLimit < 1 || scanLimit > 100) {
    throw new Error('gate_memory_admin_arguments_invalid');
  }
  return {
    command, target: target as Target, botId,
    apply: flags.has('--apply'),
    allowProviderRequests: flags.has('--allow-provider-requests'),
    maxJobs, scanLimit,
  };
}

function printPlan(args: AdminArgs): void {
  process.stdout.write(`${JSON.stringify({
    component: 'gate-memory-admin', command: args.command, target: args.target,
    botId: args.botId, mode: args.command === 'status' ? 'read_only' : args.apply ? 'apply' : 'dry_run',
    providerRequests: args.allowProviderRequests,
    maxJobs: args.command === 'work' ? args.maxJobs : undefined,
    scanLimit: args.command === 'scan' ? args.scanLimit : undefined,
    applyRequired: args.command !== 'status',
  })}\n`);
}

export async function gateMemoryAdminMain(args: string[], env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const options = parseGateMemoryAdminArgs(args);
  printPlan(options);
  if (env.GATE_MEMORY_ADMIN_TARGET !== options.target) throw new Error('gate_memory_admin_target_mismatch');
  if (options.command !== 'status' && !options.apply) return;
  if (options.command === 'work' && (!options.allowProviderRequests || env.GATE_MEMORY_EMBEDDING_ENABLED !== '1')) {
    throw new Error('gate_memory_admin_provider_apply_requires_explicit_enable');
  }
  if (options.command !== 'work' && options.allowProviderRequests) throw new Error('gate_memory_admin_provider_flag_invalid');
  const connectionString = env.GATE_MEMORY_ADMIN_DATABASE_URL;
  if (!connectionString) throw new Error('gate_memory_admin_database_config_missing');
  const pool = new Pool({ connectionString, max: 2, connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 5000, statement_timeout: 5000 });
  try {
    const manager = new GateMemoryIndexGenerationManager(pool);
    if (options.command === 'status') {
      const state = await manager.status(options.botId);
      process.stdout.write(`${JSON.stringify({ component: 'gate-memory-admin', result: 'status', state })}\n`);
      return;
    }
    if (!options.apply) return;
    const needsProvider = ['initialize', 'begin', 'work'].includes(options.command);
    const provider = needsProvider ? createGateMemoryEmbeddingProvider(env) : null;
    if (needsProvider && !provider) throw new Error('gate_memory_admin_embedding_config_required');
    if (options.command === 'initialize') {
      const state = await manager.initialize(options.botId, provider!.contract);
      process.stdout.write(`${JSON.stringify({ component: 'gate-memory-admin', result: 'initialized', activeIndexVersion: state.active_index_version })}\n`);
    } else if (options.command === 'begin') {
      await manager.beginShadowReindex(options.botId, provider!.contract);
      process.stdout.write('{"component":"gate-memory-admin","result":"building"}\n');
    } else if (options.command === 'scan') {
      const result = await manager.scanNextPage(options.botId, options.scanLimit);
      process.stdout.write(`${JSON.stringify({ component: 'gate-memory-admin', result: 'scan', ...result })}\n`);
    } else if (options.command === 'pause') {
      await manager.pause(options.botId);
      process.stdout.write('{"component":"gate-memory-admin","result":"paused"}\n');
    } else if (options.command === 'resume') {
      const queued = await manager.resume(options.botId);
      process.stdout.write(`${JSON.stringify({ component: 'gate-memory-admin', result: 'resumed', queued })}\n`);
    } else if (options.command === 'cancel') {
      const cancelled = await manager.cancel(options.botId);
      process.stdout.write(`${JSON.stringify({ component: 'gate-memory-admin', result: cancelled ? 'cancelled' : 'idle' })}\n`);
    } else if (options.command === 'activate') {
      await manager.activate(options.botId);
      process.stdout.write('{"component":"gate-memory-admin","result":"activated"}\n');
    } else if (options.command === 'work') {
      const worker = new GateMemoryIndexWorker(pool, provider);
      const counts: Record<string, number> = {};
      for (let index = 0; index < options.maxJobs; index += 1) {
        const result = await worker.processOne();
        counts[result] = (counts[result] ?? 0) + 1;
        if (result === 'empty') break;
      }
      process.stdout.write(`${JSON.stringify({ component: 'gate-memory-admin', result: 'work', processed: counts })}\n`);
    }
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void gateMemoryAdminMain(process.argv.slice(2)).catch(error => {
    const code = error instanceof Error && /^[a-z0-9_]{1,96}$/u.test(error.message)
      ? error.message : 'gate_memory_admin_failed';
    process.stderr.write(`${JSON.stringify({ component: 'gate-memory-admin', result: 'blocked', reason: code })}\n`);
    process.exitCode = 2;
  });
}
