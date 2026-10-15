import type { Pool } from 'pg';
import { KookIngressQueue, type KookGuildJoinProvisioner, type KookGroupChannelProvisioner, type KookIngressDiscardLog, type KookIngressQueueOptions, type KookRequestHandler } from './application/kook-ingress-queue.js';
import { KookMessageQueue, type KookOutboxFailureDiagnostic } from './application/kook-message-queue.js';
import { createNodeWebSocketFactory, KookGatewayApiClient, KookGatewayClient, PostgresKookGatewayStateStore, type KookGatewaySocketFactory } from './channels/kook/gateway.js';
import { KookMessageApiClient } from './channels/kook/message-client.js';
import {KookGuildWelcomeApiClient} from './channels/kook/guild-welcome.js';
export interface KookApplicationRuntimeOptions {
  pool: Pool;
  botAccountId: string;
  token: string;
  handler: KookRequestHandler;
  groupChannelProvisioner?: KookGroupChannelProvisioner;
  guildJoinProvisioner?: KookGuildJoinProvisioner;
  socketFactory?: KookGatewaySocketFactory;
  fetcher?: typeof fetch;
  ingressLimits?: Omit<KookIngressQueueOptions, 'botAccountId'>;
  pollMs?: number;
  maintenance?: () => Promise<void>;
  onError?: (code: string) => void;
  onDiagnostic?: (event: KookIngressDiscardLog) => void;
  onOutboxDiagnostic?: (event: KookOutboxFailureDiagnostic) => void;
}
function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted)
    return Promise.resolve();
  return new Promise(resolve => {
    const timer = setTimeout(finish, ms);
    function finish() { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); }
    signal.addEventListener('abort', finish, { once: true });
    if (signal.aborted)
      finish();
  });
}
/** One outbound gateway plus serial ingress and outbox processors. Gateway
 * sequence advances only after durable ingress commit. The embedding process
 * owns schema migration, its Pool, signal handling and the authorized handler. */
export class KookApplicationRuntime {
  private readonly ingress: KookIngressQueue;
  private readonly outbox: KookMessageQueue;
  private readonly sender: KookMessageApiClient;
  private readonly gateway: KookGatewayClient;
  private readonly welcome:KookGuildWelcomeApiClient;
  private readonly pollMs: number;
  private running = false;
  constructor(private readonly options: KookApplicationRuntimeOptions) {
    if (typeof options.handler !== 'function')
      throw new Error('kook_runtime_handler_required');
    this.pollMs = options.pollMs ?? 250;
    if (!Number.isSafeInteger(this.pollMs) || this.pollMs < 1 || this.pollMs > 60000)
      throw new Error('kook_runtime_poll_invalid');
    this.ingress = new KookIngressQueue(options.pool, {
      ...options.ingressLimits,
      botAccountId: options.botAccountId,
      ...(options.onDiagnostic ? { onDiscard: options.onDiagnostic } : {}),
    });
    this.outbox = new KookMessageQueue(options.pool, {
      botAccountId: options.botAccountId,
      ...(options.onOutboxDiagnostic ? { onDeliveryFailure: options.onOutboxDiagnostic } : {}),
    });
    this.sender = new KookMessageApiClient({ token: options.token, ...(options.fetcher ? { fetcher: options.fetcher } : {}) });
    this.welcome=new KookGuildWelcomeApiClient({token:options.token,botAccountId:options.botAccountId,...(options.fetcher?{fetcher:options.fetcher}:{})});
    this.gateway = new KookGatewayClient({
      botAccountId: options.botAccountId,
      gatewayUrlProvider: new KookGatewayApiClient({ token: options.token, ...(options.fetcher ? { fetcher: options.fetcher } : {}) }),
      stateStore: new PostgresKookGatewayStateStore(options.pool),
      socketFactory: options.socketFactory ?? createNodeWebSocketFactory(),
      handleEvent: async (data) => { await this.ingress.ingestGatewayEvent(data); },
      ...(options.onError ? { onError: options.onError } : {}),
    });
  }
  async run(signal: AbortSignal): Promise<void> {
    if (this.running)
      throw new Error('kook_runtime_already_running');
    if (signal.aborted)
      return;
    this.running = true;
    const stop = new AbortController();
    const onAbort = () => stop.abort();
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted)
      stop.abort();
    const tasks = [this.gateway.run(stop.signal), this.processIngress(stop.signal), this.processOutbox(stop.signal)];
    try {
      await Promise.all(tasks);
    }
    finally {
      stop.abort();
      await Promise.allSettled(tasks);
      signal.removeEventListener('abort', onAbort);
      this.running = false;
    }
  }
  private async processIngress(signal: AbortSignal): Promise<void> {
    let lastPrune = 0;
    while (!signal.aborted) {
      try {
        if (Date.now() - lastPrune >= 60000) {
          await this.ingress.prune(new Date(Date.now() - 24 * 60 * 60000));
          lastPrune = Date.now();
          try {
            await this.options.maintenance?.();
          } catch {
            this.options.onError?.('kook_runtime_data_retention_failed');
          }
        }
        const result = await this.ingress.processOne(
          this.options.handler, signal, this.welcome,
          this.options.groupChannelProvisioner, this.options.guildJoinProvisioner,
        );
        if (result === 'empty' || result === 'retry')
          await delay(this.pollMs, signal);
      }
      catch {
        this.options.onError?.('kook_runtime_ingress_failed');
        await delay(this.pollMs, signal);
      }
    }
  }
  private async processOutbox(signal: AbortSignal): Promise<void> {
    let lastPrune = 0;
    while (!signal.aborted) {
      try {
        if (Date.now() - lastPrune >= 60000) {
          await this.outbox.pruneRetainedRecords(new Date(Date.now() - 7 * 24 * 60 * 60000));
          lastPrune = Date.now();
        }
        await this.outbox.deliverOne({send:(...args)=>this.sender.send(...args),sendDirect:(...args)=>this.sender.sendDirect(...args),verifyWelcomeTarget:(guild,channel)=>this.welcome.verifyTarget(guild,channel)});
      }
      catch {
        this.options.onError?.('kook_runtime_outbox_failed');
      }
      await delay(this.pollMs, signal);
    }
  }
}
