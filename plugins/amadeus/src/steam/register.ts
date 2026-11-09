import { Type, type Static } from 'typebox';
import type { OpenClawPluginApi, OpenClawPluginToolContext } from 'openclaw/plugin-sdk/core';
import { configFor, type AmadeusConfig } from '../config.js';
import { groupIdFromSessionKey } from '../group-roster.js';
import { identityContextFromOpenClaw, identityMirrorExternalAccount, identityPersonIdForAlias, identityDisplayName, identityPersonIdForSender, identityWhatsAppGroupPeople } from '../identity.js';
import { registerTool } from '../shared/register-tool.js';
import { SteamClient } from './client.js';
import { renderSteamNotifications } from './notify.js';
import { steamGameInfo, steamGetAccountInfo, steamGetGameStats, steamLibraryOverlap } from './tools-extra.js';
import { POLL_INTERVAL_MS } from './domain.js';
import { businessCalendarFromConfig } from './business-day.js';
import { runDailyPlaytime } from './daily.js';
import { PresencePoller } from './poller.js';
import { SteamStore } from './store.js';
import {
  steamFriendsStatus, steamGetAchievements, steamGetOwnedGames, steamGetPlaytime, steamGetProfile, steamGetRecentGames, steamGroupSettings, steamLinkAccount, steamSetBroadcast, steamUnlink,
  type Person, type SteamCaller, type SteamToolDependencies,
} from './tools.js';

const PersonParameters = Type.Union([
  Type.Object({ reference: Type.Literal('self') }, { additionalProperties: false }),
  Type.Object({ reference: Type.Literal('mention'), mentionIndex: Type.Optional(Type.Integer({ minimum: 0, maximum: 64 })) }, { additionalProperties: false }),
  Type.Object({ reference: Type.Literal('reply_sender') }, { additionalProperties: false }),
  Type.Object({ reference: Type.Literal('alias'), alias: Type.String({ minLength: 1, maxLength: 128 }) }, { additionalProperties: false }),
], { description: '查谁：self=发消息的人自己；mention=@的人；reply_sender=被回复的人；alias=群里的称呼。只能查已绑定 Steam 且没有关闭播报的人。' });

const LinkParameters = Type.Object({
  reference: Type.String({ minLength: 1, maxLength: 256, description: 'Steam 个人资料链接、自定义主页名或 17 位 SteamID。' }),
  confirm: Type.Optional(Type.Boolean({ description: '用户明确确认昵称无误后才传 true。' })),
}, { additionalProperties: false });
const UnlinkParameters = Type.Object({
  account: Type.Optional(Type.String({ minLength: 1, maxLength: 256, description: '要解除哪一个账号：SteamID、个人资料链接或 Steam 昵称。只有一个账号时可不填。' })),
  all: Type.Optional(Type.Boolean({ description: 'true=解除自己所有 Steam 账号。' })),
}, { additionalProperties: false });
const BroadcastParameters = Type.Object({ enabled: Type.Boolean({ description: 'true=打开我的自动播报（上线、开始玩、换游戏、回来、成就解锁）；false=关掉。' }) }, { additionalProperties: false });
const EmptyParameters = Type.Object({}, { additionalProperties: false });
const ProfileParameters = Type.Object({ person: PersonParameters }, { additionalProperties: false });
const PlaytimeParameters = Type.Object({
  person: PersonParameters,
  game: Type.Optional(Type.String({ minLength: 1, maxLength: 128, description: '只看某个游戏时填游戏名（部分匹配）。' })),
  period: Type.Optional(Type.Union([Type.Literal('today'), Type.Literal('yesterday'), Type.Literal('this_week'), Type.Literal('date')], { description: '问“某一天/这周玩了多久”时填：today=今天，yesterday=昨天，this_week=本周（周一起），date=配合 date 指定某天。不填则返回 Steam 的总时长。按 PUBG 同一个业务日切天（默认 Asia/Shanghai 每天 06:00 切日：06:00→次日 06:00 算一天，“昨天”指昨天 06:00 到今天 06:00）。' })),
  date: Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: '指定某一天，格式 YYYY-MM-DD（period 可省略或填 date）。' })),
}, { additionalProperties: false });
const FriendsParameters = Type.Object({
  person: Type.Optional(PersonParameters),
  filter: Type.Optional(Type.Union([Type.Literal('playing'), Type.Literal('online'), Type.Literal('all')], { description: 'playing=正在玩游戏（默认）；online=在线（含玩游戏）；all=全部能看到状态的好友。' })),
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 64, description: '只看昵称包含这段文字的好友，用来回答“XX 在干嘛”。' })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
}, { additionalProperties: false });
const AchievementParameters = Type.Object({
  person: PersonParameters,
  game: Type.Optional(Type.String({ minLength: 1, maxLength: 128, description: '游戏名（部分匹配）或 Steam 应用 ID；不填则用对方正在玩的游戏，其次是最近玩的。' })),
  mode: Type.Optional(Type.Union([Type.Literal('summary'), Type.Literal('rarest'), Type.Literal('recent'), Type.Literal('missing')], { description: 'summary=完成度+最稀有+最近解锁（默认）；rarest=已解锁里最稀有的；recent=最近解锁；missing=还差哪些（最容易的先）。' })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
}, { additionalProperties: false });
const OwnedParameters = Type.Object({
  person: Type.Optional(PersonParameters),
  all: Type.Optional(Type.Boolean({ description: 'true=本群全部已绑定、没关播报的成员，用来排名（谁拥有的游戏最多/总时长最长）；此时不要填 person。' })),
  rankBy: Type.Optional(Type.Union([Type.Literal('games'), Type.Literal('hours')], { description: 'all=true 时的排序：games=拥有游戏数（默认），hours=总游戏时长。' })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
}, { additionalProperties: false });
const AccountInfoParameters = Type.Object({
  person: Type.Optional(PersonParameters),
  all: Type.Optional(Type.Boolean({ description: 'true=本群全部已绑定成员的 Steam 等级排名；此时不要填 person。' })),
  include: Type.Optional(Type.Array(Type.Union([Type.Literal('level'), Type.Literal('badges'), Type.Literal('bans')]), { maxItems: 3, description: '要查什么：level=Steam 等级（默认），badges=徽章数/经验，bans=封禁情况（默认也会带）。' })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 15 })),
}, { additionalProperties: false });
const GameInfoParameters = Type.Object({
  game: Type.String({ minLength: 1, maxLength: 128, description: '游戏名（中英文均可）或 Steam 应用 ID。' }),
  info: Type.Optional(Type.Union([Type.Literal('players'), Type.Literal('news'), Type.Literal('both')], { description: 'players=当前在线人数，news=最新新闻，both=两个都要（默认）。' })),
  count: Type.Optional(Type.Integer({ minimum: 1, maximum: 5, description: '新闻条数，默认 3。' })),
}, { additionalProperties: false });
const GameStatsParameters = Type.Object({
  person: Type.Optional(PersonParameters),
  game: Type.String({ minLength: 1, maxLength: 128, description: '游戏名或 Steam 应用 ID（例如 CS2）。' }),
  stat: Type.Optional(Type.String({ minLength: 1, maxLength: 64, description: '只看名字里含这段文字的统计项，例如 kills。' })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 40 })),
}, { additionalProperties: false });
const OverlapParameters = Type.Object({
  mode: Type.Union([Type.Literal('common'), Type.Literal('wishlist')], { description: 'common=共同拥有的游戏；wishlist=愿望单（多人时还会给出愿望单交集）。' }),
  people: Type.Optional(Type.Array(PersonParameters, { maxItems: 6, description: '要比较的成员；不填且没有 all 时只看提问者自己。' })),
  all: Type.Optional(Type.Boolean({ description: 'true=本群全部已绑定成员。' })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 30 })),
}, { additionalProperties: false });
const GroupParameters = Type.Object({ enabled: Type.Optional(Type.Boolean({ description: '只有 owner 能设置：true=本群开启 Steam 自动播报（含成就解锁），false=关闭。不填则只查看当前状态。' })) }, { additionalProperties: false });

const runtimes = new Map<string, { store: SteamStore; client: SteamClient }>();

export function steamRuntime(config: AmadeusConfig): { store: SteamStore; client: SteamClient } {
  const key = `${config.steamDatabasePath}\u0000${config.steamApiBaseUrl}\u0000${config.steamApiKeyFile ?? ''}`;
  let runtime = runtimes.get(key);
  if (!runtime) {
    runtime = {
      store: new SteamStore(config.steamDatabasePath),
      client: new SteamClient({ baseUrl: config.steamApiBaseUrl, ...(config.steamApiKeyFile ? { keyFile: config.steamApiKeyFile } : {}) }),
    };
    runtimes.set(key, runtime);
  }
  return runtime;
}

const senderKeyOf = (channel: string | undefined, id: string | undefined): string | undefined => {
  const digits = id?.split('@')[0]?.replace(/\D/gu, '');
  return channel === 'whatsapp' && digits ? `whatsapp:${digits}` : undefined;
};

export function callerFrom(config: AmadeusConfig, context: OpenClawPluginToolContext): SteamCaller {
  const identity = identityContextFromOpenClaw(context);
  const groupId = groupIdFromSessionKey(context.sessionKey);
  const replyKey = senderKeyOf(identity.replySender?.channel, identity.replySender?.platformUserId);
  const senderKey = senderKeyOf(identity.channel, identity.senderId);
  return {
    ...(senderKey ? { senderKey } : {}),
    ...(groupId ? { groupId } : {}),
    isOwner: context.senderIsOwner === true,
    mentions: (identity.mentions ?? []).map((mention) => senderKeyOf(mention.channel ?? identity.channel, mention.platformUserId) ?? ''),
    ...(replyKey ? { replySender: replyKey } : {}),
    personForAlias: (alias) => identityPersonIdForAlias(config, alias, context),
    selfPerson: () => identityPersonIdForSender(config, { type: 'self' }, context),
    mentionPerson: (index) => identityPersonIdForSender(config, { type: 'mention', index }, context),
    replyPerson: () => identityPersonIdForSender(config, { type: 'reply_sender' }, context),
    displayName: (personId) => identityDisplayName(config, personId),
    mirrorLink: (steamId, label) => identityMirrorExternalAccount(config, context, 'steam', steamId, label),
  };
}

export function registerSteamTools(api: OpenClawPluginApi): void {
  const deps = (): SteamToolDependencies => ({ ...steamRuntime(configFor(api)), calendar: businessCalendarFromConfig(api.config) });
  const caller = (context: OpenClawPluginToolContext): SteamCaller => callerFrom(configFor(api), context);
  const person = (params: { person: unknown }): Person => params.person as Person;

  registerTool(api, 'steam_link_account', '给发消息的人自己绑定一个 Steam 账号；一个人可以绑多个账号，新的不会覆盖旧的（用于查询自己的 Steam 信息，并默认在开启了播报的群里被播报上线）。先不带 confirm 调用得到昵称，让用户确认后再 confirm=true。只能绑定发消息的人自己。', LinkParameters,
    async (params, context) => steamLinkAccount(deps(), caller(context), params as Static<typeof LinkParameters>));
  registerTool(api, 'steam_unlink', '解除发消息的人自己的一个 Steam 账号（有多个账号时用 account 指定哪一个，或 all=true 全部解除），并删除相关记录。', UnlinkParameters,
    async (params, context) => steamUnlink(deps(), caller(context), params as Static<typeof UnlinkParameters>));
  registerTool(api, 'steam_set_broadcast', '打开或关闭发消息的人自己的 Steam 自动播报（上线、开始玩、换游戏、离开后回来、成就解锁都会自动播到已开启播报的群；在群里打开会把这个人加入本群的播报名单）。用户说“关掉/打开我的播报”时调用。', BroadcastParameters,
    async (params, context) => steamSetBroadcast(deps(), caller(context), params as Static<typeof BroadcastParameters>));
  registerTool(api, 'steam_get_profile', '查某个已绑定 Steam 的人的资料：昵称、当前在线状态与正在玩的游戏、账号创建时间。资料不公开的字段会返回 known:false，不要编造。', ProfileParameters,
    async (params, context) => steamGetProfile(deps(), caller(context), { person: person(params as { person: unknown }) }));
  registerTool(api, 'steam_get_playtime', '查某个已绑定 Steam 的人的游戏时长。不带 period：Steam 的总时长、最常玩的游戏或某个游戏的时长（游戏详情不公开时 known:false）。带 period（today/yesterday/this_week/date+date）：按 PUBG 同一个业务日切天（默认 Asia/Shanghai，每天 06:00 切日，06:00→次日 06:00 为一天；回答时说明按 6 点切日，和 PUBG 战报同一天），返回那段时间里实际玩了哪些游戏各多久和合计，多个账号合并；例如“我昨天玩了多久”用 person=self、period=yesterday，再按游戏列出时长。记录只从开始记录的时间起有，更早的日子如实说没有数据，不要编造。', PlaytimeParameters,
    async (params, context) => {
      const typed = params as Static<typeof PlaytimeParameters>;
      return steamGetPlaytime(deps(), caller(context), { person: person(typed), ...(typed.game ? { game: typed.game } : {}), ...(typed.period ? { period: typed.period } : {}), ...(typed.date ? { date: typed.date } : {}) });
    });
  registerTool(api, 'steam_get_recent_games', '查某个已绑定 Steam 的人近两周玩过的游戏及时长。不公开时返回 known:false。', ProfileParameters,
    async (params, context) => steamGetRecentGames(deps(), caller(context), { person: person(params as { person: unknown }) }));
  registerTool(api, 'steam_get_achievements', '查某个已绑定 Steam 的人在某个游戏里的成就：完成度、已解锁数、最稀有/最近解锁的成就（含全球解锁率）、还差哪些。对方游戏详情不公开、或游戏没有成就时返回 known:false，不要编造数字。', AchievementParameters,
    async (params, context) => {
      const typed = params as Static<typeof AchievementParameters>;
      return steamGetAchievements(deps(), caller(context), { person: person(typed), ...(typed.game ? { game: typed.game } : {}), ...(typed.mode ? { mode: typed.mode } : {}), ...(typed.limit ? { limit: typed.limit } : {}) });
    });
  registerTool(api, 'steam_get_owned_games', '查已绑定 Steam 的人拥有多少款游戏、总游戏时长和玩得最久的游戏（官方 GetOwnedGames，含免费游戏）。用户问“我有多少游戏/库存/游戏数/总时长/谁的游戏最多/排名”时必须调用本工具，不要用近两周游戏去猜，也不要爬网页。默认查提问者自己；person 可查群里其他已绑定、没关播报的成员；all=true 对本群全部已绑定成员按游戏数（或 rankBy=hours 按总时长）排名。一个人多个账号会合并（同一款游戏只算一次）；游戏详情没公开返回 known:false（“游戏详情未公开”），排名里会排除并注明，不要当成 0。', OwnedParameters,
    async (params, context) => {
      const typed = params as Static<typeof OwnedParameters>;
      return steamGetOwnedGames(deps(), caller(context), { ...(typed.person ? { person: person(typed as { person: unknown }) } : {}), ...(typed.all ? { all: true } : {}), ...(typed.rankBy ? { rankBy: typed.rankBy } : {}), ...(typed.limit ? { limit: typed.limit } : {}) });
    });
  registerTool(api, 'steam_get_account_info', '查已绑定 Steam 的人的账号等级（Steam 等级）、徽章数/经验和封禁情况（VAC/游戏封禁、距上次封禁多少天、社区/交易封禁）。问“我几级/谁的等级最高/有没有被封过”时调用；默认查提问者自己，person 可查其他已绑定成员，all=true 对全群按等级排名（等级未公开的会排除并注明）。封禁只陈述事实，不要指控或推测原因；多个账号分别列出。', AccountInfoParameters,
    async (params, context) => {
      const typed = params as Static<typeof AccountInfoParameters>;
      return steamGetAccountInfo(deps(), caller(context), { ...(typed.person ? { person: person(typed as { person: unknown }) } : {}), ...(typed.all ? { all: true } : {}), ...(typed.include ? { include: typed.include } : {}), ...(typed.limit ? { limit: typed.limit } : {}) });
    });
  registerTool(api, 'steam_game_info', '查某个游戏当前的 Steam 在线人数和最新新闻（官方接口）。问“XX 现在多少人在玩/有什么新闻、更新了什么”时调用；game 可填游戏名或应用 ID，会先在提问者的游戏库里找，再用官方商店搜索。不要爬网页。PUBG 的战绩/数据仍然用 pubg_* 工具。', GameInfoParameters,
    async (params, context) => steamGameInfo(deps(), caller(context), params as Static<typeof GameInfoParameters>));
  registerTool(api, 'steam_get_game_stats', '查某个已绑定 Steam 的人在某个游戏里的个人统计数字（如 CS2 的击杀、胜场等，官方 GetUserStatsForGame）。游戏没有统计或对方游戏详情未公开时如实说，不要编造。PUBG 不适用：PUBG 的战绩请用 pubg_* 工具。', GameStatsParameters,
    async (params, context) => {
      const typed = params as Static<typeof GameStatsParameters>;
      return steamGetGameStats(deps(), caller(context), { game: typed.game, ...(typed.person ? { person: person(typed as { person: unknown }) } : {}), ...(typed.stat ? { stat: typed.stat } : {}), ...(typed.limit ? { limit: typed.limit } : {}) });
    });
  registerTool(api, 'steam_library_overlap', '比较已绑定成员：mode=common 找几位成员共同拥有的游戏（可 all=true 全群，或 people 指定），mode=wishlist 查愿望单（官方 GetWishlist；多人时给出愿望单交集）。问“我们都有什么游戏/一起玩什么/谁想要 XX/愿望单”时调用。游戏详情或愿望单没公开的成员会列出并排除，不要当成 0。', OverlapParameters,
    async (params, context) => {
      const typed = params as Static<typeof OverlapParameters>;
      return steamLibraryOverlap(deps(), caller(context), { mode: typed.mode, ...(typed.people ? { people: typed.people.map((entry) => entry as unknown as Person) } : {}), ...(typed.all ? { all: true } : {}), ...(typed.limit ? { limit: typed.limit } : {}) });
    });
  registerTool(api, 'steam_friends_status', '查某个已绑定 Steam 的人的好友列表和好友现在的状态（谁在玩什么、谁在线），数据来自 Steam Web API。用户问“我的好友列表/我有哪些好友/好友谁在玩/某某在干嘛”时必须调用本工具，禁止 web_fetch 或搜索 steamcommunity 去爬好友页。默认查提问者自己已绑定的账号（person 不填=self）；也可以用 person 查群里其他已绑定、且没关播报的成员；多个账号会合并。好友列表没公开时返回 known:false（“好友列表未公开”），如实说，不要编造；列表有数量上限（群里更短），可用 name 查某个好友。', FriendsParameters,
    async (params, context) => steamFriendsStatus(deps(), caller(context), params as Static<typeof FriendsParameters>));
  registerTool(api, 'steam_group_settings', '查看或（仅 owner）开启/关闭当前群的 Steam 自动播报（默认开启；播报内容含上线、开始玩、换游戏、离开后回来、成就解锁）。返回的是开关和名单人数，不列出播报事件；事件范围见技能说明。', GroupParameters,
    async (params, context) => steamGroupSettings(deps(), caller(context), params as Static<typeof GroupParameters>));
}

/** Timer loop: one poll every 60 s, day and night. Idle (and silent) unless the mode is 'deliver'. */
export function registerSteamPresenceService(api: OpenClawPluginApi): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = true;
  api.registerService({
    id: 'amadeus-steam-presence',
    async start() {
      const config = configFor(api);
      if (config.steamBroadcastMode !== 'deliver') { api.logger.info('amadeus steam presence is off'); return; }
      const { store, client } = steamRuntime(config);
      const sendToGroup = async (groupId: string, message: string, idempotencyKey: string): Promise<void> => {
        await (api.runtime.gateway as unknown as { request(method: string, params: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown> })
          .request('send', { channel: 'whatsapp', to: groupId, accountId: config.steamWhatsappAccountId, message, idempotencyKey }, { timeoutMs: 20_000 });
      };
      const poller = new PresencePoller({
        store,
        client,
        compose: (facts) => renderSteamNotifications(facts, new Date()),
        displayName: (personId) => identityDisplayName(config, personId),
        groupPeople: () => identityWhatsAppGroupPeople(config),
        send: sendToGroup,
        log: (message) => api.logger.info(`amadeus ${message}`),
      });
      stopped = false;
      let missingKeyLogged = false;
      const loop = async (): Promise<void> => {
        if (stopped) return;
        try {
          if (!await client.hasKey()) {
            if (!missingKeyLogged) { api.logger.warn('amadeus steam presence waiting for the API key file'); missingKeyLogged = true; }
          } else {
            const report = await poller.tick();
            if (report.sent || report.failed) api.logger.info(`amadeus steam presence tick sent=${report.sent} failed=${report.failed}`);
          }
        } catch (error) {
          api.logger.warn(`amadeus steam presence tick failed: ${error instanceof Error ? error.message : 'unknown'}`);
        }
        try {
          // The 09:30 play-time message (same business day and clock as the PUBG daily review) uses only local data, so it does not wait for the Steam key.
          const daily = await runDailyPlaytime({
            store, calendar: businessCalendarFromConfig(api.config), now: Date.now(), send: sendToGroup, log: (message) => api.logger.info(`amadeus ${message}`),
            nameOf: (personId, fallback) => (personId ? identityDisplayName(config, personId) : undefined) ?? fallback,
          });
          if (daily.sent || daily.failed) api.logger.info(`amadeus steam daily playtime sent=${daily.sent} failed=${daily.failed}`);
        } catch (error) {
          api.logger.warn(`amadeus steam daily playtime failed: ${error instanceof Error ? error.message : 'unknown'}`);
        }
        if (!stopped) timer = setTimeout(() => { void loop(); }, POLL_INTERVAL_MS);
      };
      void loop();
    },
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  });
}
