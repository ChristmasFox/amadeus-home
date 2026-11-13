import { Type, type Static } from 'typebox';
import type { OpenClawPluginApi, OpenClawPluginToolContext } from 'openclaw/plugin-sdk/core';
import { configFor } from '../config.js';
import { importPaymentQrImage } from '../image-assets.js';
import { registerTool } from '../shared/register-tool.js';
import { callerFrom } from '../steam/register.js';
import { LuckinClient, LUCKIN_MCP_HOST_SUFFIX } from './client.js';
import { LuckinAuthStore } from './store.js';
import {
  DraftBook, InboundSequence, isLuckinOutOfBandCall, LUCKIN_BLOCK_REASON, luckinAuthStatus, luckinCancelOrder, luckinConfirmOrder, luckinDraftOrder, luckinOrderStatus, luckinProductDetail,
  luckinSearchProducts, luckinSearchShops, luckinSwitchProduct, MAX_AMOUNT, MAX_LINES, type LuckinCaller, type LuckinDeps,
} from './tools.js';

const MAX_QR_BYTES = 2 * 1024 * 1024;

const Empty = Type.Object({}, { additionalProperties: false });
const ShopsParameters = Type.Object({
  longitude: Type.Number({ minimum: -180, maximum: 180, description: '对方这次告诉你的经度（只用于这一次查店，不保存）。' }),
  latitude: Type.Number({ minimum: -90, maximum: 90, description: '对方这次告诉你的纬度。' }),
  keyword: Type.Optional(Type.String({ minLength: 1, maxLength: 64, description: '门店名称关键字。' })),
}, { additionalProperties: false });
const ProductsParameters = Type.Object({ deptId: Type.Integer({ minimum: 1 }), query: Type.String({ minLength: 1, maxLength: 128, description: '对方想喝什么，原话即可。' }) }, { additionalProperties: false });
const DetailParameters = Type.Object({ deptId: Type.Integer({ minimum: 1 }), productId: Type.Integer({ minimum: 1 }) }, { additionalProperties: false });
const SwitchParameters = Type.Object({
  deptId: Type.Integer({ minimum: 1 }), productId: Type.Integer({ minimum: 1 }), skuCode: Type.String({ pattern: '^[\\w.-]{1,64}$' }),
  attributeId: Type.Integer({ minimum: 1, description: '属性组 ID（如杯型、温度）。' }), optionId: Type.Integer({ minimum: 1, description: '要选的属性值 ID。' }), amount: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_AMOUNT })),
}, { additionalProperties: false });
const DraftParameters = Type.Object({
  deptId: Type.Integer({ minimum: 1 }),
  items: Type.Array(Type.Object({ productId: Type.Integer({ minimum: 1 }), skuCode: Type.String({ pattern: '^[\\w.-]{1,64}$' }), amount: Type.Integer({ minimum: 1, maximum: MAX_AMOUNT }) }, { additionalProperties: false }), { minItems: 1, maxItems: MAX_LINES }),
}, { additionalProperties: false });
const ConfirmParameters = Type.Object({ draftId: Type.String({ pattern: '^[0-9a-f]{8}$' }) }, { additionalProperties: false });
const OrderParameters = Type.Object({ orderRef: Type.String({ minLength: 3, maxLength: 16 }) }, { additionalProperties: false });

/** Downloads the QR image from the official host only; anything else is never fetched. */
async function fetchQr(url: string): Promise<{ bytes: Buffer; mimeType: string } | undefined> {
  const target = new URL(url);
  if (target.protocol !== 'https:' || !target.hostname.endsWith(LUCKIN_MCP_HOST_SUFFIX)) return undefined;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(target, { redirect: 'manual', signal: controller.signal });
    const mimeType = (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
    if (!response.ok || !['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)) return undefined;
    const bytes = Buffer.from(await response.arrayBuffer());
    return bytes.length > 0 && bytes.length <= MAX_QR_BYTES ? { bytes, mimeType } : undefined;
  } finally {
    clearTimeout(timer);
  }
}

export function registerLuckinTools(api: OpenClawPluginApi): void {
  const drafts = new DraftBook();
  const inbound = new InboundSequence();
  const runtime = (): Omit<LuckinDeps, 'deliverQr'> => {
    const config = configFor(api);
    return { client: new LuckinClient({ url: config.luckinMcpUrl }), store: new LuckinAuthStore(config.luckinAuthDir), drafts, inbound };
  };
  const caller = (context: OpenClawPluginToolContext): LuckinCaller => {
    const steam = callerFrom(configFor(api), context);
    return { ...(steam.senderKey ? { senderKey: steam.senderKey } : {}), ...(context.sessionKey ? { sessionKey: context.sessionKey } : {}) };
  };

  // One count per inbound message of a conversation; a draft can only be confirmed in a later turn, by the same sender.
  api.on('before_dispatch', (event, hookContext) => {
    const sessionKey = hookContext.sessionKey ?? event.sessionKey;
    if (sessionKey) inbound.note(sessionKey);
  });

  // The official skill suggests curl, token files and an IP lookup; Lab never lets the model do any of that.
  api.on('before_tool_call', (event) => {
    if (!isLuckinOutOfBandCall(event.toolName, event.params)) return undefined;
    api.logger.warn(`blocked out-of-band Luckin access via ${event.toolName}`);
    return { block: true, blockReason: LUCKIN_BLOCK_REASON };
  });

  const both = '只能用发消息的人自己授权的瑞幸账号，只能给他自己点；不要用 person、@、别名去替别人点。';
  registerTool(api, 'luckin_auth_status', `查发消息的人有没有授权自己的瑞幸账号，以及怎么走瑞幸官方授权。未授权时把返回的官方步骤告诉他，不要假装能下单，也不要让他把 Token 发到聊天里。${both}`, Empty,
    async (_params, context) => luckinAuthStatus(runtime(), caller(context)));
  registerTool(api, 'luckin_search_shops', `按对方这次告诉你的位置（经纬度）查附近瑞幸门店（官方接口）。位置不保存。${both}`, ShopsParameters,
    async (params, context) => luckinSearchShops(runtime(), caller(context), params as Static<typeof ShopsParameters>));
  registerTool(api, 'luckin_search_products', `在某家瑞幸门店里按对方想喝的东西搜商品，返回商品、规格选项和价格（官方接口）。${both}`, ProductsParameters,
    async (params, context) => luckinSearchProducts(runtime(), caller(context), params as Static<typeof ProductsParameters>));
  registerTool(api, 'luckin_product_detail', `查某家门店里某个商品的规格与价格（官方接口）。${both}`, DetailParameters,
    async (params, context) => luckinProductDetail(runtime(), caller(context), params as Static<typeof DetailParameters>));
  registerTool(api, 'luckin_switch_product', `切换商品的一个规格（杯型、温度等），返回切换后的 skuCode（官方接口；官方目前不一定稳定，失败就如实说只能点默认规格）。${both}`, SwitchParameters,
    async (params, context) => luckinSwitchProduct(runtime(), caller(context), params as Static<typeof SwitchParameters>));
  registerTool(api, 'luckin_draft_order', `生成订单草稿（官方预览，不会下单）：门店、品项、规格、数量、价格/优惠、到店自取。把草稿完整展示给发消息的人，等他在之后的新消息里明确确认。${both}`, DraftParameters,
    async (params, context) => luckinDraftOrder(runtime(), caller(context), params as Static<typeof DraftParameters>));
  registerTool(api, 'luckin_confirm_order', `发消息的人在新消息里明确确认草稿后，用 draftId 创建订单，并把官方微信支付二维码作为图片发回。只有生成草稿的同一个人在同一个会话里才能确认，草稿 10 分钟内有效、只能用一次；价格或内容变了要重新确认。绝对不能代付：付款只能本人用手机扫码。${both}`, ConfirmParameters,
    async (params, context, _notifier, signal) => luckinConfirmOrder({
      ...runtime(),
      deliverQr: async (qrUrl) => {
        const image = await fetchQr(qrUrl);
        return image ? importPaymentQrImage(configFor(api), image.bytes, image.mimeType, context, signal) : undefined;
      },
    }, caller(context), params as Static<typeof ConfirmParameters>));
  registerTool(api, 'luckin_order_status', `查自己用 Lab 下的瑞幸订单的状态（用订单尾号 orderRef）。${both}`, OrderParameters,
    async (params, context) => luckinOrderStatus(runtime(), caller(context), params as Static<typeof OrderParameters>));
  registerTool(api, 'luckin_cancel_order', `取消自己的、还没付款的瑞幸订单（用订单尾号 orderRef）；已付款的不能用它取消。${both}`, OrderParameters,
    async (params, context) => luckinCancelOrder(runtime(), caller(context), params as Static<typeof OrderParameters>));
}
