import { randomBytes } from 'node:crypto';
import { LuckinError, type LuckinClient } from './client.js';
import type { LuckinAuthStore } from './store.js';

/** Time a draft can be confirmed in; one use only. */
export const DRAFT_TTL_MS = 10 * 60_000;
export const MAX_LINES = 5;
export const MAX_AMOUNT = 5;

export type LuckinCaller = Readonly<{ senderKey?: string; sessionKey?: string }>;
export type LuckinDeps = Readonly<{
  client: Pick<LuckinClient, 'callTool'>;
  store: LuckinAuthStore;
  drafts: DraftBook;
  inbound: InboundSequence;
  now?: () => number;
  /** Fetches the official payment QR image and turns it into a reply attachment; undefined when it cannot be delivered. */
  deliverQr?: (qrUrl: string) => Promise<unknown | undefined>;
}>;

/**
 * Counts the inbound messages of a conversation. A draft remembers the count of the turn that made it, and a confirmation must come
 * in a later turn; the confirming turn's trusted sender must also be the draft's sender, so another member's message cannot confirm it.
 */
export class InboundSequence {
  private readonly counts = new Map<string, number>();
  note(sessionKey: string): void {
    this.counts.set(sessionKey, (this.counts.get(sessionKey) ?? 0) + 1);
    if (this.counts.size > 5000) this.counts.delete(this.counts.keys().next().value as string);
  }
  current(sessionKey: string): number { return this.counts.get(sessionKey) ?? 0; }
}

type Line = Readonly<{ productId: number; skuCode: string; amount: number }>;
type Draft = {
  id: string; senderKey: string; sessionKey: string; seq: number; expiresAt: number; used: boolean;
  deptId: number; lines: readonly Line[]; longitude: number; latitude: number; couponCodes: readonly string[]; digest: string;
};

export class DraftBook {
  private readonly drafts = new Map<string, Draft>();
  create(draft: Omit<Draft, 'id' | 'used'>): Draft {
    // A sender has one live draft: a new one replaces the old.
    for (const [id, existing] of this.drafts) if (existing.senderKey === draft.senderKey || existing.expiresAt < Date.now() - DRAFT_TTL_MS) this.drafts.delete(id);
    const created: Draft = { ...draft, id: randomBytes(4).toString('hex'), used: false };
    this.drafts.set(created.id, created);
    return created;
  }
  get(id: string): Draft | undefined { return this.drafts.get(id); }
}

const AUTH_GUIDE = {
  officialUrl: 'open.lkcoffee.com',
  steps: [
    '本人用自己的手机和瑞幸账号，在瑞幸官方 AI 开放平台（open.lkcoffee.com）登录并同意协议，页面会显示本人的 Token 与有效期。',
    'Token 不要发到聊天里（群里和私聊都不要）。请交给 Lab 的维护者，用主机上的私人授权脚本写入你自己的授权文件，这样只有你的账号能下单。',
    '授权到期后重新走一遍官方登录即可；不需要授权时可以让维护者删除你的授权文件。',
  ],
} as const;

const notAuthorized = (reason: 'not_authorized' | 'expired'): Record<string, unknown> => ({ status: 'not_authorized', reason, guide: AUTH_GUIDE, contentText: '还没有授权瑞幸账号，不能点单；把官方授权步骤告诉对方，不要假装能下单，也不要让对方把 Token 发到聊天里。' });
const refused = (reason: string): Record<string, unknown> => ({ status: 'refused', reason });

const num = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
const str = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined);
const obj = (value: unknown): Record<string, unknown> | undefined => (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined);

/** Runs a call with the sender's own token. The sender is only ever the trusted message sender; no tool takes a person. */
async function withAuth(deps: LuckinDeps, caller: LuckinCaller, run: (token: string, senderKey: string, sessionKey: string) => Promise<unknown>): Promise<unknown> {
  if (!caller.senderKey) return refused('trusted_sender_metadata_unavailable');
  const record = await deps.store.read(caller.senderKey);
  if (!record) return notAuthorized('not_authorized');
  const now = (deps.now ?? Date.now)();
  if (record.expiresAt && Date.parse(record.expiresAt) <= now) return notAuthorized('expired');
  try {
    return await run(record.token, caller.senderKey, caller.sessionKey ?? '');
  } catch (error) {
    if (error instanceof LuckinError) {
      if (error.reason === 'unauthorized') return notAuthorized('expired');
      return { status: 'error', reason: error.reason === 'tool' ? 'luckin_rejected' : 'luckin_unavailable', message: error.reason === 'tool' ? error.message : '瑞幸官方接口暂时不可用' };
    }
    throw error;
  }
}

export async function luckinAuthStatus(deps: LuckinDeps, caller: LuckinCaller): Promise<unknown> {
  if (!caller.senderKey) return refused('trusted_sender_metadata_unavailable');
  const record = await deps.store.read(caller.senderKey);
  const now = (deps.now ?? Date.now)();
  if (!record) return { status: 'ok', authorized: false, guide: AUTH_GUIDE };
  const expired = record.expiresAt ? Date.parse(record.expiresAt) <= now : false;
  return { status: 'ok', authorized: !expired, ...(record.expiresAt ? { expiresAt: record.expiresAt } : {}), ...(expired ? { guide: AUTH_GUIDE } : {}) };
}

export async function luckinSearchShops(deps: LuckinDeps, caller: LuckinCaller, params: { longitude: number; latitude: number; keyword?: string }): Promise<unknown> {
  if (!(params.longitude >= -180 && params.longitude <= 180 && params.latitude >= -90 && params.latitude <= 90)) return refused('invalid_coordinates');
  return withAuth(deps, caller, async (token) => {
    const data = await deps.client.callTool(token, 'queryShopList', { longitude: params.longitude, latitude: params.latitude, ...(params.keyword?.trim() ? { deptName: params.keyword.trim() } : {}) });
    const shops = (Array.isArray(data) ? data : []).flatMap((entry) => {
      const shop = obj(entry); const deptId = num(shop?.deptId);
      return shop && deptId !== undefined ? [{ deptId, name: str(shop.deptName), address: str(shop.address), distanceKm: num(shop.distance), open: [str(shop.workTimeStart), str(shop.workTimeEnd)].filter(Boolean).join('–') }] : [];
    }).slice(0, 8);
    return { status: 'ok', shops, note: '位置只用于这一次查店，不会保存。' };
  });
}

const productView = (entry: unknown): Record<string, unknown> | undefined => {
  const product = obj(entry); const productId = num(product?.productId); const skuCode = str(product?.skuCode);
  if (!product || productId === undefined || !skuCode) return undefined;
  const attrs = (Array.isArray(product.productAttrs) ? product.productAttrs : []).flatMap((group) => {
    const g = obj(group); if (!g) return [];
    return [{ attributeId: num(g.attributeId), name: str(g.attributeName), options: (Array.isArray(g.productSubAttrs) ? g.productSubAttrs : []).flatMap((option) => { const o = obj(option); return o ? [{ attributeId: num(o.attributeId), name: str(o.attributeName), selected: o.selected === true, extraPrice: num(o.price) }] : []; }) }];
  });
  return { productId, skuCode, name: str(product.productName), attributes: attrs, price: num(product.initialPrice), estimatePrice: num(product.estimatePrice), tags: Array.isArray(product.tags) ? product.tags : [] };
};

export async function luckinSearchProducts(deps: LuckinDeps, caller: LuckinCaller, params: { deptId: number; query: string }): Promise<unknown> {
  return withAuth(deps, caller, async (token) => {
    const data = await deps.client.callTool(token, 'searchProductForMcp', { deptId: params.deptId, query: params.query.trim() });
    return { status: 'ok', products: (Array.isArray(data) ? data : []).flatMap((entry) => productView(entry) ?? []).slice(0, 10) };
  });
}

export async function luckinProductDetail(deps: LuckinDeps, caller: LuckinCaller, params: { deptId: number; productId: number }): Promise<unknown> {
  return withAuth(deps, caller, async (token) => ({ status: 'ok', product: productView(await deps.client.callTool(token, 'queryProductDetailInfo', params)) ?? null }));
}

export async function luckinSwitchProduct(deps: LuckinDeps, caller: LuckinCaller, params: { deptId: number; productId: number; skuCode: string; attributeId: number; optionId: number; amount?: number }): Promise<unknown> {
  return withAuth(deps, caller, async (token) => {
    const data = await deps.client.callTool(token, 'switchProduct', {
      deptId: params.deptId, productId: params.productId, skuCode: params.skuCode, amount: params.amount ?? 1,
      attrOperationParam: { attributeId: params.attributeId, subAttr: { attributeId: params.optionId, operation: 3 } },
    });
    return { status: 'ok', product: productView(data) ?? null };
  });
}

type Preview = Readonly<{ digest: string; longitude: number; latitude: number; couponCodes: readonly string[]; summary: Record<string, unknown> }>;

async function preview(deps: LuckinDeps, token: string, deptId: number, lines: readonly Line[]): Promise<Preview | undefined> {
  const data = obj(await deps.client.callTool(token, 'previewOrder', { deptId, productList: lines.map((line) => ({ amount: line.amount, productId: line.productId, skuCode: line.skuCode })) }));
  const shop = obj(data?.shopInfo);
  const longitude = num(shop?.longitude); const latitude = num(shop?.latitude); const price = num(data?.discountPrice);
  if (!data || !shop || longitude === undefined || latitude === undefined || price === undefined) return undefined;
  const items = (Array.isArray(data.productInfoList) ? data.productInfoList : []).flatMap((entry) => {
    const item = obj(entry); return item ? [{ name: str(item.name), amount: num(item.amount), spec: str(item.additionDesc), lineTotal: num(item.estimateTotalPrice) }] : [];
  });
  const coupons = (Array.isArray(data.couponCodeList) ? data.couponCodeList : []).filter((code): code is string => typeof code === 'string');
  const summary = {
    store: { name: str(shop.deptName), address: str(shop.address), open: [str(shop.workTimeStart), str(shop.workTimeEnd)].filter(Boolean).join('–') },
    items, payablePrice: price, originalPrice: num(data.totalInitialPrice), discount: num(data.privilegeMoney), pickupAt: num(data.aboutTime) ? new Date(num(data.aboutTime)!).toISOString() : undefined,
    fulfilment: '到店自取（官方创建订单接口没有配送参数）',
  };
  const digest = JSON.stringify({ deptId, lines: lines.map((line) => [line.productId, line.skuCode, line.amount]), price, coupons: [...coupons].sort(), items: items.map((item) => [item.name, item.spec, item.amount]) });
  return { digest, longitude, latitude, couponCodes: coupons, summary };
}

function draftReply(draft: Draft, summary: Record<string, unknown>, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status: 'draft', draftId: draft.id, expiresInMinutes: DRAFT_TTL_MS / 60_000, ...summary, ...extra,
    contentText: `把门店、品项、规格、数量、价格、自取展示给发消息的人，问是否确认下单；他在之后的新消息里明确说确认，再用 draftId=${draft.id} 调用 luckin_confirm_order。你不能自己替他确认，也不能代付；付款只能他自己用手机扫官方二维码。`,
  };
}

export async function luckinDraftOrder(deps: LuckinDeps, caller: LuckinCaller, params: { deptId: number; items: ReadonlyArray<{ productId: number; skuCode: string; amount: number }> }): Promise<unknown> {
  const lines = params.items.map((item) => ({ productId: item.productId, skuCode: item.skuCode, amount: item.amount }));
  if (!lines.length || lines.length > MAX_LINES || lines.some((line) => !Number.isInteger(line.productId) || !Number.isInteger(line.amount) || line.amount < 1 || line.amount > MAX_AMOUNT || !/^[\w.-]{1,64}$/u.test(line.skuCode))) return refused('invalid_items');
  return withAuth(deps, caller, async (token, senderKey, sessionKey) => {
    const result = await preview(deps, token, params.deptId, lines);
    if (!result) return { status: 'error', reason: 'luckin_preview_incomplete', message: '官方预览没有返回完整的门店或价格，不能生成草稿。' };
    const draft = deps.drafts.create({ senderKey, sessionKey, seq: deps.inbound.current(sessionKey), expiresAt: (deps.now ?? Date.now)() + DRAFT_TTL_MS, deptId: params.deptId, lines, longitude: result.longitude, latitude: result.latitude, couponCodes: result.couponCodes, digest: result.digest });
    return draftReply(draft, result.summary);
  });
}

export async function luckinConfirmOrder(deps: LuckinDeps, caller: LuckinCaller, params: { draftId: string }): Promise<unknown> {
  return withAuth(deps, caller, async (token, senderKey, sessionKey) => {
    const draft = deps.drafts.get(params.draftId);
    if (!draft) return refused('draft_not_found');
    // The same sender, in the same conversation, who made the draft. Another member, the owner included, can never confirm it.
    if (draft.senderKey !== senderKey) return refused('draft_belongs_to_another_sender');
    if (draft.sessionKey !== sessionKey) return refused('draft_belongs_to_another_conversation');
    if (draft.used) return refused('draft_already_used');
    if (draft.expiresAt <= (deps.now ?? Date.now)()) return refused('draft_expired');
    // The confirmation has to be a later message of the sender, not the turn that produced the draft.
    if (deps.inbound.current(sessionKey) <= draft.seq) return refused('needs_a_new_message_from_the_sender_to_confirm');
    draft.used = true;
    const fresh = await preview(deps, token, draft.deptId, draft.lines);
    if (!fresh) return { status: 'error', reason: 'luckin_preview_incomplete', message: '官方预览没有返回完整信息，没有下单。' };
    if (fresh.digest !== draft.digest) {
      const replacement = deps.drafts.create({ senderKey, sessionKey, seq: deps.inbound.current(sessionKey), expiresAt: (deps.now ?? Date.now)() + DRAFT_TTL_MS, deptId: draft.deptId, lines: draft.lines, longitude: fresh.longitude, latitude: fresh.latitude, couponCodes: fresh.couponCodes, digest: fresh.digest });
      return draftReply(replacement, fresh.summary, { changed: true, note: '价格或内容和刚才的草稿不一样了，旧的确认作废，需要对方重新确认这份新草稿。' });
    }
    // The pickup point's own coordinates, from the preview; no personal location is stored or sent.
    const created = obj(await deps.client.callTool(token, 'createOrder', { deptId: draft.deptId, productList: draft.lines.map((line) => ({ amount: line.amount, productId: line.productId, skuCode: line.skuCode })), longitude: fresh.longitude, latitude: fresh.latitude, ...(fresh.couponCodes.length ? { couponCodeList: fresh.couponCodes } : {}) }));
    const orderId = str(created?.orderIdStr) ?? (num(created?.orderId) !== undefined ? String(created!.orderId) : undefined);
    if (!orderId) return { status: 'error', reason: 'luckin_order_id_missing', message: '官方没有返回订单号，请让对方去瑞幸 App 里确认是否已生成待付款订单。' };
    const orderRef = await deps.store.addOrder(senderKey, orderId, new Date((deps.now ?? Date.now)()));
    const needPay = created?.needPay !== false;
    const qrUrl = str(created?.payOrderQrCodeUrl);
    const attachment = needPay && qrUrl && deps.deliverQr ? await deps.deliverQr(qrUrl).catch(() => undefined) : undefined;
    return {
      status: 'ok', orderRef, payablePrice: num(created?.discountPrice) ?? fresh.summary.payablePrice, needPay, ...fresh.summary,
      ...(attachment ? { deliveryAttachments: [attachment] } : {}),
      contentText: !needPay ? '订单已创建，不需要支付。把订单号尾号告诉对方，并提醒到店自取。'
        : attachment ? '订单已创建，官方微信支付二维码已作为图片附在回复里；告诉对方要自己用手机扫码付款，你不能代付；不要复述二维码或链接。'
        : '订单已创建但二维码没能发出来：让对方打开瑞幸 App，在待付款订单里自己付款；不要编造二维码或链接。',
    };
  });
}

const orderIdForRef = async (deps: LuckinDeps, senderKey: string, ref: string): Promise<string | undefined> => deps.store.orderIdFor(senderKey, ref);

export async function luckinOrderStatus(deps: LuckinDeps, caller: LuckinCaller, params: { orderRef: string }): Promise<unknown> {
  return withAuth(deps, caller, async (token, senderKey) => {
    const orderId = await orderIdForRef(deps, senderKey, params.orderRef);
    if (!orderId) return refused('order_not_found_for_this_sender');
    const data = obj(await deps.client.callTool(token, 'queryOrderDetailInfo', { orderId }));
    const shop = obj(data?.shopInfo); const meal = obj(data?.takeMealCodeInfo);
    return { status: 'ok', orderRef: params.orderRef, state: str(data?.orderStatusName), stateCode: num(data?.orderStatus), store: str(shop?.deptName), amountPaid: num(data?.orderPayAmount), pickupCode: str(meal?.code),
      items: (Array.isArray(data?.orderCommodityList) ? data!.orderCommodityList as unknown[] : []).flatMap((entry) => str(obj(entry)?.commodityName) ?? []) };
  });
}

export async function luckinCancelOrder(deps: LuckinDeps, caller: LuckinCaller, params: { orderRef: string }): Promise<unknown> {
  return withAuth(deps, caller, async (token, senderKey) => {
    const orderId = await orderIdForRef(deps, senderKey, params.orderRef);
    if (!orderId) return refused('order_not_found_for_this_sender');
    const detail = obj(await deps.client.callTool(token, 'queryOrderDetailInfo', { orderId }));
    if (num(detail?.orderStatus) !== 10) return { status: 'refused', reason: 'only_unpaid_orders_can_be_cancelled', state: str(detail?.orderStatusName) };
    const done = await deps.client.callTool(token, 'cancelOrder', { orderId });
    return { status: done === true ? 'ok' : 'error', orderRef: params.orderRef, cancelled: done === true };
  });
}
