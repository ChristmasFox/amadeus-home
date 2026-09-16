import { createHash } from 'node:crypto';
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';

import { ApprovalService } from './approvals.js';
import { argumentsHash, makeCallback, parseCallback, stableJson, type CallbackReference, type ToolResponse, type ToolEvidence, type TrustedExecutionContext } from './contracts.js';
import { KurisuStore, type CodexJobRecord, type CodexJobStatus, type CodexPendingRequest } from './storage.js';
import { accepted, evidence, failure, ok, unknownResult } from './tools.js';

const execFileAsync = promisify(execFile);

const codexProjectIdSchema = z.string().trim().regex(/^[a-z][a-z0-9_-]{1,63}$/u);

export const codexStartInputSchema = z.object({
  projectId: codexProjectIdSchema,
  goal: z.string().trim().min(1).max(8_000),
  constraints: z.array(z.string().trim().min(1).max(1_000)).max(32).default([]),
}).strict();

export const codexJobInputSchema = z.object({
  jobId: z.string().trim().min(1).max(256),
}).strict();

export const codexCancelInputSchema = codexJobInputSchema.extend({
  reason: z.string().trim().min(1).max(500),
}).strict();

export type CodexStartInput = z.infer<typeof codexStartInputSchema>;
export type CodexJobInput = z.infer<typeof codexJobInputSchema>;
export type CodexCancelInput = z.infer<typeof codexCancelInputSchema>;

export type CodexWorkspaceMode = 'clean-root' | 'worktree';

export interface CodexProjectDefinition {
  projectId: string;
  /** Server configuration only. This value is never taken from model input. */
  root: string;
  workspaceMode?: CodexWorkspaceMode;
}

export interface CodexWorkspace {
  projectId: string;
  root: string;
  workspaceRef: string;
  mode: CodexWorkspaceMode;
  head: string;
}

export class CodexProjectRegistry {
  private readonly projects = new Map<string, CodexProjectDefinition>();
  private readonly worktreeParent: string;

  constructor(projects: readonly CodexProjectDefinition[] = [], options: { worktreeParent?: string } = {}) {
    this.worktreeParent = resolve(options.worktreeParent ?? join(tmpdir(), 'kurisu-codex-workspaces'));
    for (const project of projects) this.register(project);
  }

  register(project: CodexProjectDefinition): void {
    const projectId = codexProjectIdSchema.parse(project.projectId);
    if (!isAbsolute(project.root)) throw new Error(`Codex project root must be absolute: ${projectId}`);
    if (this.projects.has(projectId)) throw new Error(`duplicate Codex project: ${projectId}`);
    this.projects.set(projectId, {
      projectId,
      root: resolve(project.root),
      workspaceMode: project.workspaceMode ?? 'worktree',
    });
  }

  has(projectId: string): boolean {
    return this.projects.has(projectId);
  }

  get(projectId: string): CodexProjectDefinition | null {
    return this.projects.get(projectId) ?? null;
  }

  async prepare(projectId: string): Promise<CodexWorkspace> {
    const project = this.projects.get(projectId);
    if (!project) throw new CodexProjectError('PROJECT_NOT_CONFIGURED', 'Codex project is not registered by the server');
    const root = await this.verifyGitRoot(project);
    const status = await gitOutput(root, ['status', '--porcelain', '--untracked-files=all']);
    if (status.trim()) throw new CodexProjectError('PROJECT_DIRTY', 'Codex project has uncommitted changes; the source workspace was not used');
    const head = (await gitOutput(root, ['rev-parse', 'HEAD'])).trim();
    const mode = project.workspaceMode ?? 'worktree';
    if (mode === 'clean-root') return { projectId, root, workspaceRef: root, mode, head };

    await mkdir(this.worktreeParent, { recursive: true });
    const workspaceRef = await mkdtemp(join(this.worktreeParent, `${projectId}-`));
    try {
      await gitOutput(root, ['worktree', 'add', '--detach', workspaceRef, head]);
      return { projectId, root, workspaceRef, mode, head };
    } catch (error) {
      await rm(workspaceRef, { recursive: true, force: true });
      throw new CodexProjectError('WORKSPACE_CREATE_FAILED', safeError(error, 'isolated worktree could not be created'));
    }
  }

  async restore(projectId: string, workspaceRef: string): Promise<CodexWorkspace> {
    const project = this.projects.get(projectId);
    if (!project) throw new CodexProjectError('PROJECT_NOT_CONFIGURED', 'Codex project is not registered by the server');
    if (!isAbsolute(workspaceRef)) throw new CodexProjectError('WORKSPACE_INVALID', 'stored Codex workspace is not absolute');
    const root = await this.verifyGitRoot(project);
    const storedWorkspace = await realpath(workspaceRef).catch(() => null);
    if (!storedWorkspace) throw new CodexProjectError('WORKSPACE_MISSING', 'stored Codex workspace no longer exists');
    if ((project.workspaceMode ?? 'worktree') === 'clean-root') {
      if (storedWorkspace !== root) throw new CodexProjectError('WORKSPACE_INVALID', 'stored workspace is outside the configured project root');
    } else if (!isWithin(await realpath(this.worktreeParent).catch(() => this.worktreeParent), storedWorkspace)) {
      throw new CodexProjectError('WORKSPACE_INVALID', 'stored worktree is outside the executor-owned workspace root');
    }
    const workspaceGitRoot = await gitOutput(storedWorkspace, ['rev-parse', '--show-toplevel']).then((value) => realpath(value.trim())).catch(() => null);
    const expectedGitRoot = (project.workspaceMode ?? 'worktree') === 'clean-root' ? root : storedWorkspace;
    if (!workspaceGitRoot || workspaceGitRoot !== expectedGitRoot) {
      throw new CodexProjectError('WORKSPACE_INVALID', 'stored workspace is not a worktree of the configured project');
    }
    const configuredCommonDir = await gitCommonDir(root);
    const workspaceCommonDir = await gitCommonDir(storedWorkspace);
    if (!configuredCommonDir || !workspaceCommonDir || configuredCommonDir !== workspaceCommonDir) {
      throw new CodexProjectError('WORKSPACE_INVALID', 'stored workspace is not linked to the configured Git project');
    }
    const head = (await gitOutput(storedWorkspace, ['rev-parse', 'HEAD'])).trim();
    return { projectId, root, workspaceRef: storedWorkspace, mode: project.workspaceMode ?? 'worktree', head };
  }

  private async verifyGitRoot(project: CodexProjectDefinition): Promise<string> {
    const root = await realpath(project.root).catch(() => null);
    if (!root) throw new CodexProjectError('PROJECT_MISSING', 'configured Codex project root does not exist');
    const details = await stat(root).catch(() => null);
    if (!details?.isDirectory()) throw new CodexProjectError('PROJECT_INVALID', 'configured Codex project root is not a directory');
    const gitRoot = await gitOutput(root, ['rev-parse', '--show-toplevel']).then((value) => realpath(value.trim())).catch(() => null);
    if (!gitRoot || gitRoot !== root) throw new CodexProjectError('PROJECT_NOT_GIT', 'configured Codex project root is not the expected Git root');
    return root;
  }
}

async function gitCommonDir(cwd: string): Promise<string | null> {
  try {
    const value = (await gitOutput(cwd, ['rev-parse', '--git-common-dir'])).trim();
    return realpath(isAbsolute(value) ? value : resolve(cwd, value));
  } catch {
    return null;
  }
}

export class CodexProjectError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'CodexProjectError';
  }
}

async function gitOutput(cwd: string, args: string[]): Promise<string> {
  try {
    const result = await execFileAsync('git', ['-C', cwd, ...args], { cwd, timeout: 10_000, maxBuffer: 64 * 1024, encoding: 'utf8' });
    return String(result.stdout ?? '');
  } catch (error) {
    throw new CodexProjectError('GIT_CHECK_FAILED', safeError(error, 'Git workspace check failed'));
  }
}

function isWithin(parent: string, child: string): boolean {
  const relativePath = relative(resolve(parent), resolve(child));
  return relativePath === '' || (relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath));
}

export interface CodexServerRequest {
  id: string | number;
  method: string;
  params: unknown;
}

export type CodexAppServerMessage =
  | { kind: 'notification'; method: string; params: unknown }
  | { kind: 'request'; id: string | number; method: string; params: unknown }
  | { kind: 'process_exit'; code: number | null; signal: NodeJS.Signals | null };

export interface CodexAppServerClient {
  request(method: string, params: Record<string, unknown>): Promise<unknown>;
  respond(id: string | number, result: unknown): void;
  subscribe(listener: (message: CodexAppServerMessage) => void | Promise<void>): () => void;
  close(): Promise<void>;
}

export interface ProcessCodexAppServerClientOptions {
  command?: string;
  args?: readonly string[];
  cwd?: string;
  clientName?: string;
  clientVersion?: string;
}

/** Minimal JSONL JSON-RPC client for the installed official Codex App Server. */
export class ProcessCodexAppServerClient implements CodexAppServerClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private startPromise: Promise<void> | null = null;
  private nextId = 1;
  private buffer = '';
  private closed = false;
  private readonly pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private readonly listeners = new Set<(message: CodexAppServerMessage) => void | Promise<void>>();
  private readonly options: Required<Pick<ProcessCodexAppServerClientOptions, 'command' | 'clientName' | 'clientVersion'>> & ProcessCodexAppServerClientOptions;

  constructor(options: ProcessCodexAppServerClientOptions = {}) {
    this.options = {
      command: options.command ?? 'codex',
      clientName: options.clientName ?? 'kurisu-codex-executor',
      clientVersion: options.clientVersion ?? '0.1.0',
      ...options,
    };
  }

  async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    await this.ensureStarted();
    const id = this.nextId++;
    return new Promise((resolvePromise, reject) => {
      this.pending.set(String(id), { resolve: resolvePromise, reject });
      try {
        this.write({ jsonrpc: '2.0', id, method, params });
      } catch (error) {
        this.pending.delete(String(id));
        reject(error instanceof Error ? error : new Error('App Server request failed'));
      }
    });
  }

  respond(id: string | number, result: unknown): void {
    if (!this.child || this.closed) throw new Error('Codex App Server is not connected');
    this.write({ jsonrpc: '2.0', id, result });
  }

  subscribe(listener: (message: CodexAppServerMessage) => void | Promise<void>): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async close(): Promise<void> {
    this.closed = true;
    const child = this.child;
    this.child = null;
    if (!child) return;
    for (const request of this.pending.values()) request.reject(new Error('Codex App Server closed'));
    this.pending.clear();
    child.kill('SIGTERM');
    await new Promise<void>((resolvePromise) => {
      const timer = setTimeout(() => resolvePromise(), 2_000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolvePromise();
      });
    });
  }

  private async ensureStarted(): Promise<void> {
    if (this.closed) throw new Error('Codex App Server client is closed');
    if (this.child) return;
    if (!this.startPromise) this.startPromise = this.open();
    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  private async open(): Promise<void> {
    const child = spawn(this.options.command, [...(this.options.args ?? ['app-server', '--stdio'])], {
      cwd: this.options.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });
    this.child = child;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.receiveStdout(chunk));
    child.stderr.on('data', () => undefined);
    child.on('error', (error) => this.failPending(error));
    child.on('exit', (code, signal) => {
      if (this.child === child) this.child = null;
      this.failPending(new Error(`Codex App Server exited (${code ?? 'null'}/${signal ?? 'none'})`));
      void this.emit({ kind: 'process_exit', code, signal });
    });
    try {
      const result = await this.requestRaw('initialize', {
        clientInfo: { name: this.options.clientName, version: this.options.clientVersion },
      });
      if (!result || typeof result !== 'object') throw new Error('Codex App Server returned an invalid initialize response');
      this.write({ jsonrpc: '2.0', method: 'initialized', params: {} });
    } catch (error) {
      if (this.child === child) this.child = null;
      this.failPending(error instanceof Error ? error : new Error('Codex App Server initialization failed'));
      child.kill('SIGTERM');
      throw error;
    }
  }

  private requestRaw(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolvePromise, reject) => {
      this.pending.set(String(id), { resolve: resolvePromise, reject });
      try {
        this.write({ jsonrpc: '2.0', id, method, params });
      } catch (error) {
        this.pending.delete(String(id));
        reject(error instanceof Error ? error : new Error('App Server request failed'));
      }
    });
  }

  private write(message: Record<string, unknown>): void {
    if (!this.child || this.closed || !this.child.stdin.writable) throw new Error('Codex App Server is not connected');
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private receiveStdout(chunk: string): void {
    this.buffer += chunk;
    let newline = this.buffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) this.receiveLine(line);
      newline = this.buffer.indexOf('\n');
    }
  }

  private receiveLine(line: string): void {
    let message: Record<string, unknown>;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
      message = parsed as Record<string, unknown>;
    } catch {
      return;
    }
    const method = typeof message.method === 'string' ? message.method : null;
    if (method && message.id !== undefined && (typeof message.id === 'string' || typeof message.id === 'number')) {
      void this.emit({ id: message.id, method, params: message.params, kind: 'request' });
      return;
    }
    if (message.id !== undefined && (typeof message.id === 'string' || typeof message.id === 'number')) {
      const request = this.pending.get(String(message.id));
      if (!request) return;
      this.pending.delete(String(message.id));
      if (message.error && typeof message.error === 'object') {
        const errorMessage = asRecord(message.error).message;
        request.reject(new Error(typeof errorMessage === 'string' ? errorMessage.slice(0, 500) : 'Codex App Server request returned an error'));
      }
      else request.resolve(message.result);
      return;
    }
    if (method) void this.emit({ kind: 'notification', method, params: message.params });
  }

  private failPending(error: Error): void {
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  }

  private async emit(message: CodexAppServerMessage): Promise<void> {
    for (const listener of this.listeners) {
      try { await listener(message); } catch { /* event observers cannot break the protocol reader */ }
    }
  }
}

export interface CodexExecutorOptions {
  now?: () => string;
  clientFactory?: () => CodexAppServerClient;
  appServer?: ProcessCodexAppServerClientOptions;
  model?: string;
}

interface CodexApprovalEnvelope {
  request: CodexStartInput | CodexJobInput | CodexCancelInput;
  idempotencyKey: string;
}

interface PendingRpc {
  jobId: string;
  requestId: string;
  rpcId: string | number;
}

/** One process-backed Codex executor. All projects and jobs pass through this boundary. */
export class CodexAppServerExecutor {
  private readonly now: () => string;
  private readonly approvals: ApprovalService;
  private readonly clientFactory: () => CodexAppServerClient;
  private readonly model: string | undefined;
  private client: CodexAppServerClient | null = null;
  private unsubscribe: (() => void) | null = null;
  private readonly pendingRpc = new Map<string, PendingRpc>();
  private readonly cancelRequested = new Set<string>();

  constructor(private readonly store: KurisuStore, private readonly projects: CodexProjectRegistry, options: CodexExecutorOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.approvals = new ApprovalService(store, this.now);
    this.clientFactory = options.clientFactory ?? (() => new ProcessCodexAppServerClient(options.appServer));
    this.model = options.model;
  }

  async close(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.client) await this.client.close();
    this.client = null;
    this.pendingRpc.clear();
  }

  async requestStart(input: unknown, context: TrustedExecutionContext): Promise<ToolResponse> {
    const parsed = codexStartInputSchema.safeParse(input);
    if (!parsed.success) return failure('CODEX_INPUT_INVALID', 'Codex start arguments do not match the declared schema', false);
    const authorization = this.authorizeOrChallenge('kurisu.codex.start', 'high', parsed.data, context);
    if (authorization) return authorization;
    return this.startApproved(parsed.data, context, context.idempotencyKey ?? this.derivedIdempotencyKey(context, parsed.data));
  }

  async requestResume(input: unknown, context: TrustedExecutionContext): Promise<ToolResponse> {
    const parsed = codexJobInputSchema.safeParse(input);
    if (!parsed.success) return failure('CODEX_INPUT_INVALID', 'Codex resume arguments do not match the declared schema', false);
    const authorization = this.authorizeOrChallenge('kurisu.codex.resume', 'write', parsed.data, context);
    if (authorization) return authorization;
    return this.resumeApproved(parsed.data.jobId, context);
  }

  async requestCancel(input: unknown, context: TrustedExecutionContext): Promise<ToolResponse> {
    const parsed = codexCancelInputSchema.safeParse(input);
    if (!parsed.success) return failure('CODEX_INPUT_INVALID', 'Codex cancel arguments do not match the declared schema', false);
    const authorization = this.authorizeOrChallenge('kurisu.codex.cancel', 'write', parsed.data, context);
    if (authorization) return authorization;
    return this.cancelApproved(parsed.data.jobId, context, parsed.data.reason);
  }

  handlesCallback(context: TrustedExecutionContext, callback: CallbackReference | string): boolean {
    const parsed = typeof callback === 'string' ? parseCallback(callback) : callback;
    if (!parsed || parsed.kind !== 'approval' || parsed.action !== 'approve') return false;
    const approval = this.store.getApproval(parsed.id);
    if (approval?.runId === context.runId && approval.action.startsWith('kurisu.codex.')) return true;
    const value = makeCallback(parsed);
    const binding = this.store.getCallbackBinding(value);
    return Boolean(binding && binding.runId === context.runId && this.store.listCodexJobs().some((job) => job.runId === context.runId && job.pendingRequest?.callback === value));
  }

  async approveCallback(context: TrustedExecutionContext, callback: CallbackReference | string): Promise<ToolResponse> {
    const parsed = typeof callback === 'string' ? parseCallback(callback) : callback;
    if (!parsed || parsed.kind !== 'approval' || parsed.action !== 'approve') return failure('CALLBACK_INVALID', 'Codex approval callback is invalid', false);
    const approval = this.store.getApproval(parsed.id);
    if (approval?.runId === context.runId && approval.action.startsWith('kurisu.codex.')) {
      const consumed = this.approvals.consumeBound(context, parsed.id);
      if (consumed.status !== 'accepted') return consumed;
      const envelope = parseCodexApprovalEnvelope(approval.arguments);
      if (!envelope) return failure('APPROVAL_INVALID', 'Codex approval arguments are not recoverable', false);
      if (approval.action === 'kurisu.codex.start') return this.startApproved(codexStartInputSchema.parse(envelope.request), context, envelope.idempotencyKey);
      if (approval.action === 'kurisu.codex.resume') return this.resumeApproved(codexJobInputSchema.parse(envelope.request).jobId, context);
      if (approval.action === 'kurisu.codex.cancel') {
        const request = codexCancelInputSchema.parse(envelope.request);
        return this.cancelApproved(request.jobId, context, request.reason);
      }
    }
    const value = makeCallback(parsed);
    const binding = this.store.getCallbackBinding(value);
    if (!binding || binding.runId !== context.runId) return failure('APPROVAL_INVALID', 'Codex approval is missing or bound to another task', false);
    const job = this.store.listCodexJobs().find((candidate) => candidate.runId === context.runId && candidate.pendingRequest?.callback === value);
    if (!job?.pendingRequest) return failure('CODEX_REQUEST_NOT_FOUND', 'Codex approval request is no longer pending', false);
    return this.approveServerRequest(job.jobId, job.pendingRequest.requestId, context);
  }

  async status(input: unknown, context: TrustedExecutionContext): Promise<ToolResponse> {
    const parsed = codexJobInputSchema.safeParse(input);
    if (!parsed.success) return failure('CODEX_INPUT_INVALID', 'Codex job arguments do not match the declared schema', false);
    const job = this.ownedJob(parsed.data.jobId, context);
    if (!job) return failure('CODEX_JOB_NOT_FOUND', 'Codex job is not available in this conversation', false);
    return this.responseForJob(job);
  }

  async list(context: TrustedExecutionContext): Promise<ToolResponse> {
    const jobs = this.store.listCodexJobs().filter((job) => this.owns(job, context));
    return ok({ jobs: jobs.map((job) => publicJob(job)) }, [evidence('kurisu.codex-store', 'Codex jobs were listed for the current conversation')]);
  }

  /** Respond to a persisted App Server approval/input request after the user has reviewed it. */
  async respond(jobId: string, requestId: string, response: unknown, context: TrustedExecutionContext): Promise<ToolResponse> {
    const job = this.ownedJob(jobId, context);
    if (!job) return failure('CODEX_JOB_NOT_FOUND', 'Codex job is not available in this conversation', false);
    if (!job.pendingRequest || job.pendingRequest.requestId !== requestId) return failure('CODEX_REQUEST_NOT_FOUND', 'Codex job has no matching pending request', false);
    const pending = this.pendingRpc.get(`${jobId}:${requestId}`);
    if (!pending || !this.client) return unknownResult('CODEX_REQUEST_NOT_CONNECTED', 'Codex approval/input is persisted but this executor is not connected to that request', true);
    const checked = validateServerResponse(job.pendingRequest.method, response);
    if (!checked.ok) return failure('CODEX_RESPONSE_INVALID', checked.message, false);
    try {
      this.client.respond(pending.rpcId, checked.value);
    } catch (error) {
      return unknownResult('CODEX_RESPONSE_UNCERTAIN', safeError(error, 'Codex approval/input response was not confirmed'), true);
    }
    this.pendingRpc.delete(`${jobId}:${requestId}`);
    const updated = this.store.updateCodexJob(jobId, { status: 'running', pendingRequest: null }, this.now());
    this.emitJobEvent(updated, 'codex.job.request_resolved', `App Server request ${requestId} was answered`);
    this.transitionRun(updated.runId, 'running', 'Codex App Server request was answered');
    return accepted(jobId, [evidence('kurisu.codex', 'Codex App Server request was answered; turn result remains pending', requestId)]);
  }

  async approveServerRequest(jobId: string, requestId: string, context: TrustedExecutionContext): Promise<ToolResponse> {
    const job = this.ownedJob(jobId, context);
    if (!job?.pendingRequest) return failure('CODEX_REQUEST_NOT_FOUND', 'Codex job has no pending approval request', false);
    if (!['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(job.pendingRequest.method)) return failure('CODEX_RESPONSE_INVALID', 'pending Codex request is not an approval request', false);
    return this.respond(jobId, requestId, { decision: 'accept' }, context);
  }

  private authorizeOrChallenge(action: string, risk: 'write' | 'high', request: CodexApprovalEnvelope['request'], context: TrustedExecutionContext): ToolResponse | null {
    if (context.authorization.allowedActions.includes(action)) return null;
    if (!context.authorization.approvalRequiredActions.includes(risk)) return failure('TOOL_POLICY_DENIED', 'Codex action is not authorized in this context', false);
    const envelope: CodexApprovalEnvelope = {
      request,
      idempotencyKey: context.idempotencyKey ?? this.derivedIdempotencyKey(context, request),
    };
    const challenge = this.approvals.request(context, { action, arguments: envelope });
    const callback = parseCallback(challenge.callback);
    return {
      contractVersion: 'kurisu.v1',
      status: 'needs_input',
      data: {
        runId: context.runId,
        approvalId: challenge.approval.id,
        action,
        argumentsHash: challenge.approval.argumentsHash,
        expiresAt: challenge.approval.expiresAt,
        request,
        callback: challenge.callback,
      },
      evidence: [evidence('kurisu.approval', 'Codex action is paused until the exact server-bound approval is consumed', challenge.approval.id)],
      entityRefs: [],
      ...(callback ? { callbackReferences: [callback] } : {}),
    };
  }

  private async startApproved(input: CodexStartInput, context: TrustedExecutionContext, idempotencyKey: string): Promise<ToolResponse> {
    const existing = this.store.findCodexJobByIdempotencyKey(idempotencyKey);
    if (existing) {
      if (!this.owns(existing, context)) return failure('CODEX_IDEMPOTENCY_CONFLICT', 'Codex idempotency key belongs to another conversation', false);
      return this.responseForJob(existing);
    }
    let workspace: CodexWorkspace;
    try {
      workspace = await this.projects.prepare(input.projectId);
    } catch (error) {
      return failure(error instanceof CodexProjectError ? error.code : 'CODEX_PROJECT_INVALID', safeError(error, 'Codex project is not ready'), false);
    }
    const active = this.store.listCodexJobs().find((job) => job.projectId === input.projectId && job.workspaceRef === workspace.workspaceRef && !terminalJobStatus(job.status));
    if (active) return failure('CODEX_WORKSPACE_BUSY', 'the configured Codex workspace already has an active job', true);
    const jobId = `job_${createHash('sha256').update(stableJson({ idempotencyKey, projectId: input.projectId })).digest('hex').slice(0, 32)}`;
    const job = this.store.createCodexJob({
      jobId,
      runId: context.runId,
      principalKey: context.principalKey,
      sessionKey: context.sessionKey,
      idempotencyKey,
      projectId: input.projectId,
      workspaceRef: workspace.workspaceRef,
      goal: input.goal,
      constraints: input.constraints,
    }, this.now());
    this.emitJobEvent(job, 'codex.job.created', 'Codex job was durably recorded before starting App Server');
    try {
      const client = await this.getClient();
      const threadResult = await client.request('thread/start', {
        ...(this.model ? { model: this.model } : {}),
        cwd: workspace.workspaceRef,
        sandbox: 'workspace-write',
        approvalPolicy: 'on-request',
        ephemeral: false,
        developerInstructions: 'This is a controlled engineering task. Stay inside the supplied workspace, keep the requested scope narrow, obey repository AGENTS instructions, and never use network access unless an explicit server approval is returned.',
      });
      const threadId = readString(threadResult, ['thread', 'id']);
      if (!threadId) throw new Error('thread/start did not return a thread id');
      const withThread = this.store.updateCodexJob(jobId, { threadId }, this.now());
      this.emitJobEvent(withThread, 'codex.job.thread_started', 'Codex thread was created in the registered workspace', threadId);
      const turnResult = await client.request('turn/start', {
        threadId,
        input: [{ type: 'text', text: buildTaskPrompt(input) }],
        cwd: workspace.workspaceRef,
        approvalPolicy: 'on-request',
        sandboxPolicy: { type: 'workspaceWrite', writableRoots: [workspace.workspaceRef], networkAccess: false },
      });
      const turnId = readString(turnResult, ['turn', 'id']);
      if (!turnId) throw new Error('turn/start did not return a turn id');
      const running = this.store.updateCodexJob(jobId, { turnId, status: 'running' }, this.now());
      this.emitJobEvent(running, 'codex.job.turn_started', 'Codex turn started; completion will be decided from turn status', turnId);
      this.transitionRun(jobIdToRun(this.store, jobId), 'running', 'Codex turn is running under the durable job');
      this.transitionRun(jobIdToRun(this.store, jobId), 'waiting_job', 'Codex turn is running under the durable job');
      return accepted(jobId, [evidence('kurisu.codex', 'Codex job accepted with a server-owned thread and turn', threadId)]);
    } catch (error) {
      const current = this.store.getCodexJob(jobId) ?? job;
      const failed = this.store.updateCodexJob(jobId, {
        status: 'failed',
        evidence: [...current.evidence, this.evidenceItem('Codex App Server start failed', 'codex.start')],
      }, this.now());
      this.emitJobEvent(failed, 'codex.job.failed', 'Codex App Server did not start the requested turn');
      this.transitionRun(failed.runId, 'failed', 'Codex App Server start failed');
      return failure('CODEX_START_FAILED', safeError(error, 'Codex App Server did not start the task'), true);
    }
  }

  private async resumeApproved(jobId: string, context: TrustedExecutionContext): Promise<ToolResponse> {
    const job = this.ownedJob(jobId, context);
    if (!job) return failure('CODEX_JOB_NOT_FOUND', 'Codex job is not available in this conversation', false);
    if (job.status === 'cancelled') return failure('CODEX_JOB_CANCELLED', 'cancelled Codex jobs are not resumed', false);
    if (job.status === 'succeeded') return this.responseForJob(job);
    if (!job.threadId) return unknownResult('CODEX_THREAD_MISSING', 'Codex job has no persisted thread id; it was not restarted automatically', true);
    let workspace: CodexWorkspace;
    try {
      workspace = await this.projects.restore(job.projectId, job.workspaceRef);
    } catch (error) {
      return unknownResult(error instanceof CodexProjectError ? error.code : 'CODEX_WORKSPACE_INVALID', safeError(error, 'Codex workspace could not be restored'), true);
    }
    try {
      const client = await this.getClient();
      const result = await client.request('thread/resume', { threadId: job.threadId, cwd: workspace.workspaceRef, excludeTurns: false });
      const latest = latestTurn(result, job.turnId);
      if (latest?.status === 'completed') return this.finalizeFromTurn(job, latest, 'resume observed a completed turn');
      if (latest?.status === 'failed') return this.finalizeFromTurn(job, latest, 'resume observed a failed turn');
      if (latest?.status === 'interrupted') return this.finalizeFromTurn(job, latest, 'resume observed an interrupted turn');
      if (latest?.status === 'inProgress' || job.status === 'running' || job.status === 'waiting_approval' || job.status === 'waiting_input') {
        const resumed = this.store.updateCodexJob(job.jobId, { status: job.pendingRequest ? job.status : 'running' }, this.now());
        this.emitJobEvent(resumed, 'codex.job.resumed', 'Codex thread was reattached without starting a second thread or turn', job.threadId ?? undefined);
        this.transitionRun(resumed.runId, resumed.pendingRequest ? (resumed.status === 'waiting_approval' || resumed.status === 'waiting_input' ? resumed.status : 'running') : 'waiting_job', 'Codex thread was reattached');
        return accepted(job.jobId, [evidence('kurisu.codex', 'Codex thread/job mapping was restored; no duplicate start was issued', job.threadId ?? job.jobId)]);
      }
      const unknown = this.store.updateCodexJob(job.jobId, { status: 'unknown' }, this.now());
      this.emitJobEvent(unknown, 'codex.job.unknown', 'Codex thread history did not prove a terminal result after resume');
      this.transitionRun(unknown.runId, 'reconciling', 'Codex result requires reconciliation');
      return unknownResult('CODEX_RESULT_UNCERTAIN', 'Codex thread was found but the turn result is not proven; no new turn was started', true);
    } catch (error) {
      const unknown = this.store.updateCodexJob(job.jobId, { status: 'unknown' }, this.now());
      this.emitJobEvent(unknown, 'codex.job.unknown', 'Codex thread resume failed; no replacement thread was started');
      this.transitionRun(unknown.runId, 'reconciling', 'Codex thread resume failed');
      return unknownResult('CODEX_RESUME_UNCERTAIN', safeError(error, 'Codex thread could not be resumed'), true);
    }
  }

  private async cancelApproved(jobId: string, context: TrustedExecutionContext, reason: string): Promise<ToolResponse> {
    const job = this.ownedJob(jobId, context);
    if (!job) return failure('CODEX_JOB_NOT_FOUND', 'Codex job is not available in this conversation', false);
    if (terminalJobStatus(job.status)) return this.responseForJob(job);
    this.cancelRequested.add(jobId);
    if (!job.threadId || !job.turnId) {
      const cancelled = this.store.updateCodexJob(jobId, { status: 'cancelled', lastMessage: `cancelled: ${reason}` }, this.now());
      this.emitJobEvent(cancelled, 'codex.job.cancelled', 'Codex job was cancelled before a turn was attached');
      this.transitionRun(cancelled.runId, 'cancelled', 'Codex job cancelled');
      return failure('CODEX_JOB_CANCELLED', 'Codex job cancelled before turn execution', false);
    }
    try {
      const client = await this.getClient();
      await client.request('turn/interrupt', { threadId: job.threadId, turnId: job.turnId });
      const cancelled = this.store.updateCodexJob(jobId, { status: 'cancelled', lastMessage: `cancelled: ${reason}`, pendingRequest: null }, this.now());
      this.emitJobEvent(cancelled, 'codex.job.cancelled', 'Codex turn interrupt was accepted; no later continuation will be started', job.turnId);
      this.transitionRun(cancelled.runId, 'cancelled', 'Codex job cancelled');
      return failure('CODEX_JOB_CANCELLED', 'Codex job cancellation was accepted; completed file changes are not rolled back', false);
    } catch (error) {
      const unknown = this.store.updateCodexJob(jobId, { status: 'unknown', lastMessage: `cancel uncertain: ${reason}` }, this.now());
      this.emitJobEvent(unknown, 'codex.job.unknown', 'Codex cancellation was not confirmed; no automatic repeat was issued', job.turnId);
      this.transitionRun(unknown.runId, 'reconciling', 'Codex cancellation is uncertain');
      return unknownResult('CODEX_CANCEL_UNCERTAIN', safeError(error, 'Codex cancellation was not confirmed'), true);
    }
  }

  private async getClient(): Promise<CodexAppServerClient> {
    if (!this.client) {
      this.client = this.clientFactory();
      this.unsubscribe = this.client.subscribe((message) => this.handleMessage(message));
    }
    return this.client;
  }

  private async handleMessage(message: CodexAppServerMessage): Promise<void> {
    if (message.kind === 'process_exit') {
      const active = this.store.listCodexJobs().filter((job) => ['queued', 'running', 'waiting_approval', 'waiting_input'].includes(job.status));
      for (const job of active) {
        const unknown = this.store.updateCodexJob(job.jobId, { status: 'unknown' }, this.now());
        this.emitJobEvent(unknown, 'codex.job.unknown', 'Codex App Server disconnected; thread/job must be resumed before claiming a result');
        this.transitionRun(unknown.runId, 'reconciling', 'Codex App Server disconnected');
      }
      return;
    }
    if (message.kind === 'request') {
      await this.handleServerRequest(message);
      return;
    }
    const params = asRecord(message.params);
    const threadId = readString(params, ['threadId']);
    const turnId = readString(params, ['turnId']) ?? (asRecord(params.turn).id as string | undefined);
    const job = this.store.listCodexJobs().find((candidate) => candidate.threadId === threadId && (!turnId || candidate.turnId === turnId));
    if (!job) return;
    if (message.method === 'item/agentMessage/delta') {
      const delta = typeof params.delta === 'string' ? params.delta : '';
      if (delta) this.store.updateCodexJob(job.jobId, { lastMessage: `${job.lastMessage ?? ''}${delta}`.slice(-32_000) }, this.now());
      return;
    }
    if (message.method === 'item/completed') {
      const item = asRecord(params.item);
      if (item.type === 'agentMessage' && typeof item.text === 'string') this.store.updateCodexJob(job.jobId, { lastMessage: item.text.slice(-32_000) }, this.now());
      return;
    }
    if (message.method === 'turn/completed') {
      const turn = asRecord(params.turn);
      const status = typeof turn.status === 'string' ? turn.status : null;
      if (status === 'completed' || status === 'failed' || status === 'interrupted') {
        this.finalizeFromTurn(job, turn, 'Codex turn completed notification received');
      } else {
        const unknown = this.store.updateCodexJob(job.jobId, { status: 'unknown' }, this.now());
        this.emitJobEvent(unknown, 'codex.job.unknown', 'Codex sent turn completion without a terminal status');
        this.transitionRun(unknown.runId, 'reconciling', 'Codex completion status was not terminal');
      }
      return;
    }
    if (message.method === 'error') {
      const unknown = this.store.updateCodexJob(job.jobId, { status: 'unknown', lastMessage: 'Codex App Server reported an error' }, this.now());
      this.emitJobEvent(unknown, 'codex.job.unknown', 'Codex App Server reported an error; result remains unclaimed');
      this.transitionRun(unknown.runId, 'reconciling', 'Codex App Server reported an error');
    }
  }

  private async handleServerRequest(message: Extract<CodexAppServerMessage, { kind: 'request' }>): Promise<void> {
    const params = asRecord(message.params);
    const threadId = readString(params, ['threadId']);
    const turnId = readString(params, ['turnId']);
    const job = this.store.listCodexJobs().find((candidate) => candidate.threadId === threadId && (!turnId || candidate.turnId === turnId));
    if (!job) {
      if (this.client) this.client.respond(message.id, { decision: 'decline' });
      return;
    }
    const isInputRequest = message.method === 'item/tool/requestUserInput';
    const isApprovalRequest = message.method === 'item/commandExecution/requestApproval' || message.method === 'item/fileChange/requestApproval';
    if (!isInputRequest && !isApprovalRequest) {
      const unknown = this.store.updateCodexJob(job.jobId, { status: 'unknown' }, this.now());
      this.emitJobEvent(unknown, 'codex.job.unknown', `Codex sent an unsupported server request: ${message.method}`);
      this.transitionRun(unknown.runId, 'reconciling', 'Codex sent an unsupported server request');
      return;
    }
    const waitingKind = isInputRequest ? 'waiting_input' : 'waiting_approval';
    const callback = waitingKind === 'waiting_approval' ? this.makeServerRequestCallback(job, message.id) : null;
    const pending: CodexPendingRequest = {
      requestId: String(message.id),
      method: message.method,
      itemId: readString(params, ['itemId']),
      reason: readString(params, ['reason']),
      callback,
      receivedAt: this.now(),
    };
    const evidenceItems = [...job.evidence, this.evidenceItem(
      waitingKind === 'waiting_approval' ? 'Codex is waiting for an explicit approval' : 'Codex is waiting for user input',
      message.method,
      String(message.id),
    )];
    const updated = this.store.updateCodexJob(job.jobId, { status: waitingKind, pendingRequest: pending, evidence: evidenceItems }, this.now());
    this.pendingRpc.set(`${job.jobId}:${pending.requestId}`, { jobId: job.jobId, requestId: pending.requestId, rpcId: message.id });
    this.emitJobEvent(updated, `codex.job.${waitingKind}`, waitingKind === 'waiting_approval' ? 'Codex App Server approval request is pending' : 'Codex App Server user-input request is pending', pending.requestId);
    this.transitionRun(updated.runId, waitingKind, `Codex App Server request is pending: ${message.method}`);
  }

  private makeServerRequestCallback(job: CodexJobRecord, requestId: string | number): string | null {
    const id = `cx${createHash('sha256').update(`${job.jobId}:${String(requestId)}`).digest('hex').slice(0, 30)}`;
    const callback = makeCallback({ kind: 'approval', action: 'approve', id });
    const reference = parseCallback(callback);
    if (reference) this.store.bindCallback(callback, reference, { principalKey: job.principalKey, sessionKey: job.sessionKey, runId: job.runId }, this.now());
    return callback;
  }

  private finalizeFromTurn(job: CodexJobRecord, turn: Record<string, unknown>, summary: string): ToolResponse {
    const turnStatus = String(turn.status ?? '');
    const status: CodexJobStatus = turnStatus === 'completed' ? 'succeeded' : turnStatus === 'interrupted' && this.cancelRequested.has(job.jobId) ? 'cancelled' : turnStatus === 'interrupted' ? 'failed' : 'failed';
    const updated = this.store.updateCodexJob(job.jobId, { status, pendingRequest: null }, this.now());
    this.emitJobEvent(updated, `codex.job.${status}`, summary, job.turnId ?? undefined);
    this.transitionRun(updated.runId, status === 'succeeded' ? 'succeeded' : status === 'cancelled' ? 'cancelled' : 'failed', summary);
    return this.responseForJob(updated);
  }

  private responseForJob(job: CodexJobRecord): ToolResponse {
    if (job.status === 'succeeded') return ok({ job: publicJob(job) }, [evidence('kurisu.codex', 'Codex job completed with a terminal turn status', job.jobId)]);
    if (job.status === 'waiting_approval' || job.status === 'waiting_input') return {
      contractVersion: 'kurisu.v1',
      status: 'needs_input',
      data: { job: publicJob(job) },
      evidence: [evidence('kurisu.codex', 'Codex job is waiting for a persisted server request response', job.jobId)],
      entityRefs: [],
      ...(job.pendingRequest?.callback ? { callbackReferences: [parseCallback(job.pendingRequest.callback)!] } : {}),
    };
    if (job.status === 'queued' || job.status === 'running') return accepted(job.jobId, [evidence('kurisu.codex', 'Codex job remains active under its original thread', job.threadId ?? job.jobId)]);
    if (job.status === 'cancelled') return failure('CODEX_JOB_CANCELLED', 'Codex job was cancelled; completed changes were not rolled back', false);
    if (job.status === 'unknown') return unknownResult('CODEX_RESULT_UNCERTAIN', 'Codex job result is uncertain and requires explicit resume/reconciliation', true);
    return failure('CODEX_JOB_FAILED', 'Codex turn failed; it was not reported as succeeded', true);
  }

  private ownedJob(jobId: string, context: TrustedExecutionContext): CodexJobRecord | null {
    const job = this.store.getCodexJob(jobId);
    return job && this.owns(job, context) ? job : null;
  }

  private owns(job: CodexJobRecord, context: TrustedExecutionContext): boolean {
    return job.principalKey === context.principalKey && job.sessionKey === context.sessionKey;
  }

  private derivedIdempotencyKey(context: TrustedExecutionContext, request: unknown): string {
    return `codex_${argumentsHash({ principalKey: context.principalKey, sessionKey: context.sessionKey, request }).slice(0, 48)}`;
  }

  private evidenceItem(summary: string, source: string, ref?: string): ToolEvidence {
    return { source, observedAt: this.now(), summary: summary.slice(0, 1_000), ...(ref ? { ref } : {}) };
  }

  private emitJobEvent(job: CodexJobRecord, eventType: string, summary: string, ref?: string): void {
    const payload = {
      principalKey: job.principalKey,
      sessionKey: job.sessionKey,
      jobId: job.jobId,
      runId: job.runId,
      projectId: job.projectId,
      workspaceRef: job.workspaceRef,
      threadId: job.threadId,
      turnId: job.turnId,
      status: job.status,
      summary: summary.slice(0, 1_000),
      ...(ref ? { ref } : {}),
    };
    const eventKey = `codex:${job.jobId}:${eventType}:${argumentsHash(payload).slice(0, 32)}`;
    this.store.createEvent(eventType, eventKey, payload, undefined, this.now());
  }

  private transitionRun(runId: string, target: 'running' | 'waiting_job' | 'waiting_approval' | 'waiting_input' | 'succeeded' | 'failed' | 'cancelled' | 'reconciling', observation: string): void {
    const run = this.store.getRun(runId);
    if (!run || run.status === target || terminalRunStatus(run.status)) return;
    try {
      this.store.transitionRun(runId, target, { lastObservation: observation }, this.now());
    } catch {
      // The durable job remains authoritative if a host turn already moved the run.
    }
  }
}

function jobIdToRun(store: KurisuStore, jobId: string): string {
  return store.getCodexJob(jobId)?.runId ?? jobId;
}

function terminalJobStatus(status: CodexJobStatus): boolean {
  return ['succeeded', 'failed', 'cancelled'].includes(status);
}

function terminalRunStatus(status: string): boolean {
  return ['succeeded', 'failed', 'cancelled'].includes(status);
}

function buildTaskPrompt(input: CodexStartInput): string {
  const constraints = input.constraints.length > 0 ? `\nConstraints:\n${input.constraints.map((constraint) => `- ${constraint}`).join('\n')}` : '';
  return `Kurisu engineering task\nGoal:\n${input.goal}${constraints}\n\nWork only in this registered workspace. Keep the change limited to the goal, run the smallest relevant verification, and report the actual files changed and command results. Do not claim success when a command or verification failed.`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readString(value: unknown, path: string[]): string | null {
  let current: unknown = value;
  for (const key of path) current = asRecord(current)[key];
  return typeof current === 'string' && current ? current : null;
}

function latestTurn(value: unknown, turnId: string | null): Record<string, unknown> | null {
  const turns = Array.isArray(asRecord(value).thread && asRecord(asRecord(value).thread).turns)
    ? asRecord(asRecord(value).thread).turns as unknown[]
    : [];
  const matching = turns.filter((turn): turn is Record<string, unknown> => Boolean(turn) && typeof turn === 'object' && !Array.isArray(turn) && (!turnId || (turn as Record<string, unknown>).id === turnId));
  return (matching.at(-1) ?? turns.at(-1)) as Record<string, unknown> | null;
}

function publicJob(job: CodexJobRecord): Record<string, unknown> {
  return {
    jobId: job.jobId,
    projectId: job.projectId,
    workspaceRef: job.workspaceRef,
    threadId: job.threadId,
    turnId: job.turnId,
    goal: job.goal,
    constraints: job.constraints,
    status: job.status,
    evidence: job.evidence,
    lastMessage: job.lastMessage,
    pendingRequest: job.pendingRequest,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

function parseCodexApprovalEnvelope(value: unknown): CodexApprovalEnvelope | null {
  const record = asRecord(value);
  if (!record.request || typeof record.idempotencyKey !== 'string') return null;
  if (!codexStartInputSchema.safeParse(record.request).success && !codexJobInputSchema.safeParse(record.request).success && !codexCancelInputSchema.safeParse(record.request).success) return null;
  return { request: record.request as CodexApprovalEnvelope['request'], idempotencyKey: record.idempotencyKey };
}

function validateServerResponse(method: string, response: unknown): { ok: true; value: Record<string, unknown> } | { ok: false; message: string } {
  const record = asRecord(response);
  if (method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval') {
    const decision = record.decision;
    if (decision !== 'accept' && decision !== 'decline' && decision !== 'cancel') return { ok: false, message: 'only accept, decline, or cancel is allowed for a Codex approval request' };
    return { ok: true, value: { decision } };
  }
  if (method === 'item/tool/requestUserInput') {
    const answers = record.answers;
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return { ok: false, message: 'user-input response must contain an answers object' };
    for (const value of Object.values(answers as Record<string, unknown>)) {
      const answer = asRecord(value);
      if (!Array.isArray(answer.answers) || answer.answers.some((item) => typeof item !== 'string' || item.length > 1_000)) return { ok: false, message: 'each user-input answer must contain bounded string answers' };
    }
    return { ok: true, value: { answers } };
  }
  return { ok: false, message: `Codex request method ${method} is not supported by this executor` };
}

function safeError(error: unknown, fallback: string): string {
  return (error instanceof Error ? error.message : fallback).replaceAll(/Bearer\s+[^\s]+/giu, 'Bearer [redacted]').slice(0, 500);
}
