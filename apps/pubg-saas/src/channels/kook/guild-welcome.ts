const verifiedGuildJoin = Symbol('verified-kook-guild-join');
const verifiedWelcomeTarget = Symbol('verified-kook-welcome-target');

export interface TrustedKookGuildJoin {
  readonly [verifiedGuildJoin]: true;
  botAccountId: string;
  guildId: string;
  messageId: string;
  timestamp: number;
}

export interface VerifiedKookWelcomeTarget {
  readonly [verifiedWelcomeTarget]: true;
  botAccountId: string;
  guildId: string;
  channelId: string;
  guildName: string;
}

export interface KookGuildWelcomeResolver {
  resolve(event: TrustedKookGuildJoin, signal?: AbortSignal): Promise<VerifiedKookWelcomeTarget | null>;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function id(value: unknown, max = 128): string | null {
  return typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : null;
}
function coded(code: string): Error & {code: string} {return Object.assign(new Error(code), {code});}

/** Only the documented system event addressed to this bot is a join signal. */
export function parseTrustedKookGuildJoin(data: unknown, botAccountId: string): TrustedKookGuildJoin | null {
  const event=record(data),extra=record(event?.extra),body=record(extra?.body);
  if(!event || event.type!==255 || event.channel_type!=='PERSON' || event.target_id!==botAccountId
    || event.author_id!=='1' || extra?.type!=='self_joined_guild')return null;
  const bot=id(botAccountId),guildId=id(body?.guild_id),messageId=id(event.msg_id,256);
  if(!bot || !guildId || !messageId || typeof event.msg_timestamp!=='number' || !Number.isSafeInteger(event.msg_timestamp) || event.msg_timestamp<=0)return null;
  return {[verifiedGuildJoin]:true,botAccountId:bot,guildId,messageId,timestamp:event.msg_timestamp};
}

export function isVerifiedKookWelcomeTarget(value: unknown): value is VerifiedKookWelcomeTarget {
  return Boolean(value && typeof value==='object' && (value as VerifiedKookWelcomeTarget)[verifiedWelcomeTarget]===true);
}

/** Fixed read-only APIs derive and verify the welcome destination; model/user
 * message payloads cannot supply a guild or channel override. */
export class KookGuildWelcomeApiClient implements KookGuildWelcomeResolver {
  private readonly token: string;
  private readonly botId: string;
  private readonly fetcher: typeof fetch;
  constructor(options:{token:string;botAccountId:string;fetcher?:typeof fetch}){
    const bot=id(options.botAccountId),token=id(options.token,4096);
    if(!bot || !token)throw coded('kook_welcome_config_invalid');
    this.botId=bot;this.token=token;this.fetcher=options.fetcher??fetch;
  }
  private async get(path:'guild/view'|'channel/view',query:Record<string,string>,signal?:AbortSignal):Promise<Record<string,unknown>>{
    const url=new URL(`https://www.kookapp.cn/api/v3/${path}`);
    for(const [key,value] of Object.entries(query))url.searchParams.set(key,value);
    let response:Response;
    try{
      response=await this.fetcher(url,{method:'GET',headers:{Authorization:`Bot ${this.token}`,Accept:'application/json','Cache-Control':'no-cache'},cache:'no-store',redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(5000)]):AbortSignal.timeout(5000)});
    }catch{throw coded('kook_welcome_api_unavailable');}
    if(!response.ok)throw coded(`kook_welcome_api_http_${response.status}`);
    let parsed:unknown;try{parsed=await response.json();}catch{throw coded('kook_welcome_response_invalid');}
    const envelope=record(parsed),data=record(envelope?.data);
    if(envelope?.code!==0 || !data)throw coded('kook_welcome_response_invalid');
    return data;
  }
  async verifyTarget(guildId:string,channelId:string,signal?:AbortSignal):Promise<boolean>{
    if(!id(guildId)||!id(channelId))return false;
    const channel=await this.get('channel/view',{target_id:channelId},signal);
    return channel.id===channelId && channel.guild_id===guildId && channel.type===1 && channel.is_category===false;
  }
  async resolve(event:TrustedKookGuildJoin,signal?:AbortSignal):Promise<VerifiedKookWelcomeTarget|null>{
    if(event.botAccountId!==this.botId)throw coded('kook_bot_scope_mismatch');
    const guild=await this.get('guild/view',{guild_id:event.guildId},signal);
    if(guild.id!==event.guildId)throw coded('kook_welcome_target_invalid');
    const welcome=id(guild.welcome_channel_id),fallback=id(guild.default_channel_id);
    const channelId=welcome && welcome!=='0'?welcome:fallback && fallback!=='0'?fallback:null;
    if(!channelId)return null;
    if(!await this.verifyTarget(event.guildId,channelId,signal))throw coded('kook_welcome_target_invalid');
    const rawName = typeof guild.name === 'string' ? guild.name.trim() : '';
    const guildName = rawName && rawName.length <= 80 && !/[\u0000-\u001f\u007f]/u.test(rawName)
      ? rawName : 'KOOK服务器';
    return {[verifiedWelcomeTarget]:true,botAccountId:this.botId,guildId:event.guildId,channelId,guildName};
  }
}
