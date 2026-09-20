import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  adaptWorldlineNotification,
  assertValid,
  validateOwnerNotificationPresentation,
  type OwnerNotificationPresentation,
  type PresentationFact,
  type PresentationLink,
  type WorldlineNotificationIntent,
} from '@agent/presentation';
import type { RadarEvent } from '../../core/events/events.js';
import type { Listing, Price, ProductStatus } from '../../core/listing/model.js';
import type { NotificationChannel, NotificationMessage } from '../../core/notification/ports.js';

export interface OwnerNotificationEvent extends OwnerNotificationPresentation {
  version: 1;
}

type OwnerNotificationInput = OwnerNotificationPresentation;

function fileId(eventKey: string): string {
  return createHash('sha256').update(eventKey).digest('hex').slice(0, 40);
}

function bounded(value: string, max: number): string {
  return value.replace(/[\u0000\r]/gu, '').trim().slice(0, max);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function listingFor(event: RadarEvent): Listing | undefined {
  const payload = record(event.payload);
  for (const candidate of [event.after, payload?.listing, event.before]) {
    const item = record(candidate);
    if (typeof item?.title === 'string' && typeof item.url === 'string') return item as unknown as Listing;
  }
  return undefined;
}

function fact(label: string, value: PresentationFact['value']): PresentationFact {
  return { label, value, evidenceRefs: [] };
}

function priceFacts(label: string, price: Price | null | undefined): PresentationFact[] {
  return [
    fact(`${label}金额`, price?.amount ?? null),
    fact(`${label}币种`, price?.currency?.toUpperCase() ?? null),
  ];
}

function status(value: ProductStatus | null | undefined): string | null {
  return value ?? null;
}

function listingFacts(listing: Listing | undefined, sourceDisplayName: string): PresentationFact[] {
  if (!listing) return [fact('来源', sourceDisplayName)];
  const seller = listing.seller?.name ?? listing.seller?.externalId ?? null;
  return [
    fact('来源', sourceDisplayName),
    fact('来源标识', listing.source),
    fact('商品标题', listing.title),
    fact('卖家', seller),
    ...priceFacts('当前价格', listing.price),
    fact('状态', status(listing.status)),
  ];
}

function listingLink(listing: Listing | undefined): PresentationLink[] {
  return listing?.url ? [{ label: '查看商品', url: listing.url }] : [];
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function radarIntent(event: RadarEvent, sourceDisplayName: string): WorldlineNotificationIntent {
  const payload = record(event.payload) ?? {};
  const listing = listingFor(event);
  const facts = listingFacts(listing, sourceDisplayName);
  let kind = 'listing_updated';
  let severity: WorldlineNotificationIntent['severity'] = 'info';
  let significance: WorldlineNotificationIntent['significance'] = 'minor';
  let headline = '商品信息更新';
  let summary = 'Product Radar 产生了一条结构化商品事件。';

  if (event.type === 'ListingMatchedEvent') {
    kind = 'listing_matched';
    significance = 'notable';
    headline = '发现匹配商品';
    summary = '检测到符合当前监控条件的商品。';
    const matchedKeywords = Array.isArray(payload.matchedKeywords) ? payload.matchedKeywords.filter((item): item is string => typeof item === 'string') : [];
    facts.push(fact('命中关键词', matchedKeywords.length ? matchedKeywords.join('、') : null));
  } else if (event.type === 'SimilarListingMatchedEvent') {
    kind = 'similar_listing_matched';
    significance = 'notable';
    headline = '发现相似商品';
    summary = '检测到相似度达到阈值的商品。';
    facts.push(fact('相似度', asNumber(payload.similarity)), fact('相似度阈值', asNumber(payload.threshold)));
  } else if (event.type === 'ProductPriceChangedEvent') {
    kind = 'price_changed';
    severity = 'warning';
    significance = 'major';
    headline = '商品价格变化';
    summary = '监控商品的价格发生变化。';
    facts.push(...priceFacts('变化前价格', event.before as Price | null), ...priceFacts('变化后价格', event.after as Price | null));
    const before = (event.before as Price | null)?.amount;
    const after = (event.after as Price | null)?.amount;
    facts.push(fact('价格方向', before === undefined || after === undefined ? null : after < before ? '下降' : after > before ? '上升' : '不变'));
  } else if (event.type === 'ProductStatusChangedEvent') {
    kind = 'status_changed';
    severity = 'warning';
    significance = 'major';
    headline = '商品状态变化';
    summary = '监控商品的可用状态发生变化。';
    facts.push(fact('变化前状态', status(event.before as ProductStatus | null)), fact('变化后状态', status(event.after as ProductStatus)));
  } else {
    const fields = Array.isArray(payload.fields) ? payload.fields.filter((item): item is string => typeof item === 'string') : [];
    facts.push(fact('变化字段', fields.length ? fields.join('、') : null));
  }

  const links = listingLink(listing);
  return {
    type: 'worldline_notification_intent',
    eventType: `product_radar_${event.type}`,
    kind,
    severity,
    significance,
    eventKey: event.eventKey,
    source: `product-radar:${event.type}`,
    headline,
    summary,
    facts,
    ...(links.length ? { links } : {}),
    dataUpdatedAt: event.occurredAt,
    occurredAt: event.occurredAt,
  };
}

function heartbeatIntent(event: RadarEvent, payload: unknown, sourceDisplayName: string): WorldlineNotificationIntent {
  const values = record(payload) ?? {};
  const statusValue = typeof values.status === 'string' ? values.status : 'UNKNOWN';
  const degraded = statusValue === 'DEGRADED' || statusValue === 'ERROR';
  const facts: PresentationFact[] = [
    fact('来源', sourceDisplayName),
    fact('监控类型', typeof values.watchType === 'string' ? values.watchType : null),
    fact('状态', statusValue),
    fact('检查次数', asNumber(values.checks)),
    fact('成功检查', asNumber(values.successfulChecks)),
    fact('失败检查', asNumber(values.failedChecks)),
    fact('新商品', asNumber(values.newListings)),
    fact('候选商品', asNumber(values.candidates)),
    fact('图片比较', asNumber(values.imageComparisons)),
    fact('FashionSigLIP 调用', asNumber(values.imageModelCalls)),
    fact('FashionSigLIP 处理图片', asNumber(values.imageModelImagesProcessed)),
    fact('FashionSigLIP 缓存命中', asNumber(values.imageModelCacheHits)),
    fact('最高相似度', asNumber(values.bestScore)),
    fact('达到阈值', asNumber(values.aboveThreshold)),
    fact('相似度阈值', asNumber(values.threshold)),
    fact('已发送通知', asNumber(values.notificationsSent)),
    fact('Token 数', asNumber(values.tokenCount)),
    fact('Feed 异常', Array.isArray(values.feedErrors) && values.feedErrors.length ? values.feedErrors.filter((item): item is string => typeof item === 'string').join('、') : null),
  ];
  return {
    type: 'worldline_notification_intent',
    eventType: 'product_radar_heartbeat',
    kind: 'heartbeat',
    severity: degraded ? 'warning' : 'info',
    significance: degraded ? 'major' : 'notable',
    eventKey: event.eventKey,
    source: 'product-radar:heartbeat',
    headline: 'Product Radar 心跳',
    summary: 'Product Radar 周期性监控摘要。',
    facts,
    dataUpdatedAt: event.occurredAt,
    occurredAt: event.occurredAt,
  };
}

export async function enqueueOwnerNotification(event: OwnerNotificationInput, outboxDir: string): Promise<string> {
  const normalized: OwnerNotificationEvent = {
    version: 1,
    ...assertValid(validateOwnerNotificationPresentation(event)),
  };
  await mkdir(outboxDir, { recursive: true, mode: 0o700 });
  const id = fileId(normalized.eventKey);
  const pending = join(outboxDir, `${id}.pending.json`);
  const sent = join(outboxDir, `${id}.sent.json`);
  try {
    await readFile(pending);
    return 'already-pending';
  } catch { /* first enqueue */ }
  try {
    await readFile(sent);
    return 'already-sent';
  } catch { /* not delivered yet */ }
  const temporary = join(outboxDir, `.${id}.${process.pid}.${Date.now()}.tmp`);
  await writeFile(temporary, `${JSON.stringify(normalized)}\n`, { encoding: 'utf8', mode: 0o600 });
  try {
    await rename(temporary, pending);
  } catch (error) {
    try { await readFile(pending); } catch { throw error; }
  }
  return 'queued';
}

function fallbackPresentation(message: NotificationMessage): OwnerNotificationPresentation {
  const text = message.text?.trim() || 'Product Radar event';
  return {
    type: 'owner_notification',
    eventType: `product_radar_${message.event.type}`,
    severity: 'info',
    significance: 'notable',
    theme: 'worldline_observation',
    eventKey: message.event.eventKey,
    source: `product-radar:${message.event.type}`,
    headline: 'Amadeus • 世界线观测 · Product Radar',
    facts: [],
    summary: bounded(text, 16_000),
    occurredAt: message.event.occurredAt,
  };
}

function presentationFromMessage(message: NotificationMessage): OwnerNotificationPresentation {
  const payload = record(message.payload);
  if (payload?.type === 'owner_notification') return assertValid(validateOwnerNotificationPresentation(payload));
  return fallbackPresentation(message);
}

export class OwnerNotificationChannel implements NotificationChannel {
  readonly id = 'owner-notification';
  readonly recipient = 'owner';

  constructor(private readonly outboxDir: string) {}

  prepare(event: RadarEvent, sourceDisplayName: string): NotificationMessage {
    return { event, recipient: this.recipient, payload: adaptWorldlineNotification(radarIntent(event, sourceDisplayName)) };
  }

  prepareHeartbeat(event: RadarEvent, payload: unknown, sourceDisplayName: string): NotificationMessage {
    return { event, recipient: this.recipient, payload: adaptWorldlineNotification(heartbeatIntent(event, payload, sourceDisplayName)) };
  }

  async send(message: NotificationMessage): Promise<void> {
    await enqueueOwnerNotification(presentationFromMessage(message), this.outboxDir);
  }
}
