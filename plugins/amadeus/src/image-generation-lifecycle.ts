/** Bounded idempotency state for one authoritative detached image task lifecycle. */
export type ImageGenerationTerminal = 'succeeded' | 'failed';

type TaskState = {
  acceptedNotified: boolean;
  acceptedInFlight?: Promise<void>;
  terminal?: ImageGenerationTerminal;
  successInFlight?: Promise<void>;
  failureInFlight?: Promise<void>;
  artifacts?: Promise<unknown>;
};

const TASK_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;

export class ImageGenerationLifecycleCoordinator {
  private readonly tasks = new Map<string, TaskState>();

  constructor(private readonly maxTasks = 2048) {
    if (!Number.isSafeInteger(maxTasks) || maxTasks < 1) throw new Error('image_lifecycle_capacity_invalid');
  }

  private state(taskId: string): TaskState {
    if (!TASK_ID.test(taskId)) throw new Error('image_lifecycle_task_id_invalid');
    let state = this.tasks.get(taskId);
    if (state) {
      this.tasks.delete(taskId);
      this.tasks.set(taskId, state);
      return state;
    }
    state = { acceptedNotified: false };
    this.tasks.set(taskId, state);
    while (this.tasks.size > this.maxTasks) this.tasks.delete(this.tasks.keys().next().value!);
    return state;
  }

  /** Reserve before I/O. Failure is best effort and never re-opens admission. */
  async accepted(taskId: string, notify: () => Promise<void>): Promise<boolean> {
    const state = this.state(taskId);
    if (state.acceptedNotified || state.terminal) return false;
    state.acceptedNotified = true;
    const pending = Promise.resolve().then(notify);
    state.acceptedInFlight = pending;
    try { await pending; }
    finally { if (state.acceptedInFlight === pending) delete state.acceptedInFlight; }
    return true;
  }

  /** Cache trusted asset/caption preparation across completion retries. */
  async artifacts<T>(taskId: string, prepare: () => Promise<T>): Promise<T> {
    const state = this.state(taskId);
    if (state.artifacts) return state.artifacts as Promise<T>;
    const pending = Promise.resolve().then(prepare);
    state.artifacts = pending;
    try { return await pending; }
    catch (error) {
      if (state.artifacts === pending) delete state.artifacts;
      throw error;
    }
  }

  /** Succeeded is terminal; retries may re-enter the idempotent settlement. */
  async succeeded(taskId: string, settle: () => Promise<void>): Promise<boolean> {
    const state = this.state(taskId);
    if (state.terminal === 'failed') return false;
    state.terminal = 'succeeded';
    if (state.acceptedInFlight) await state.acceptedInFlight.catch(() => undefined);
    if (state.successInFlight) { await state.successInFlight; return true; }
    const pending = Promise.resolve().then(settle);
    state.successInFlight = pending;
    try { await pending; }
    finally { if (state.successInFlight === pending) delete state.successInFlight; }
    return true;
  }

  /** Failure is terminal and cannot supersede an already-successful task. */
  async failed(taskId: string, notify: () => Promise<void>): Promise<boolean> {
    const state = this.state(taskId);
    if (state.terminal === 'succeeded') return false;
    state.terminal = 'failed';
    if (state.acceptedInFlight) await state.acceptedInFlight.catch(() => undefined);
    if (state.failureInFlight) { await state.failureInFlight; return true; }
    const pending = Promise.resolve().then(notify);
    state.failureInFlight = pending;
    try { await pending; }
    finally { if (state.failureInFlight === pending) delete state.failureInFlight; }
    return true;
  }

  status(taskId: string): Readonly<{ acceptedNotified: boolean; terminal?: ImageGenerationTerminal }> | undefined {
    const state = this.tasks.get(taskId);
    return state ? { acceptedNotified: state.acceptedNotified, ...(state.terminal ? { terminal: state.terminal } : {}) } : undefined;
  }

  get size(): number { return this.tasks.size; }
}
