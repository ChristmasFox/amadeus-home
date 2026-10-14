import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {Pool} from 'pg';
import {KookApplicationRuntime,KookGuildWelcomeApiClient,KookIngressQueue,KookMessageQueue,migratePublicDatabase,parseKookRequest,parseTrustedKookGuildJoin,type KookGatewaySocket,type KookGatewaySocketEvent} from '../src/index.js';

const databaseUrl=process.env.PUBG_SAAS_TEST_DATABASE_URL;
function joined(bot:string,guild:string){return {type:255,channel_type:'PERSON',target_id:bot,author_id:'1',msg_id:randomUUID(),msg_timestamp:Date.now(),verify_token:'excluded-verifier',extra:{type:'self_joined_guild',body:{guild_id:guild,state:'excluded-oauth-state',channel_id:'spoofed-channel'}}};}
function response(data:unknown){return new Response(JSON.stringify({code:0,data}));}

test('only a bot-addressed self_joined_guild system event enters durable welcome intake',()=>{
  const data=joined('fixture-bot','fixture-guild');
  const parsed=parseTrustedKookGuildJoin(data,'fixture-bot');assert.ok(parsed);assert.equal(parsed.guildId,'fixture-guild');
  assert.equal(parseTrustedKookGuildJoin({...data,target_id:'another-bot'},'fixture-bot'),null);
  assert.equal(parseTrustedKookGuildJoin({...data,author_id:'ordinary-user'},'fixture-bot'),null);
  assert.equal(parseTrustedKookGuildJoin({...data,extra:{...data.extra,type:'self_exited_guild'}},'fixture-bot'),null);
  const stored=JSON.stringify(parseKookRequest(data,'fixture-bot')?.envelope);
  assert.equal(stored.includes('excluded-oauth-state'),false);assert.equal(stored.includes('excluded-verifier'),false);assert.equal(stored.includes('spoofed-channel'),false);
});

test('welcome destination uses fixed guild/channel APIs and never follows a foreign/voice/category target',async()=>{
  let channelGuild='fixture-guild';let type=1;const requested:string[]=[];
  const client=new KookGuildWelcomeApiClient({token:'fixture-token',botAccountId:'fixture-bot',fetcher:async(input,init)=>{
    const url=new URL(String(input));assert.equal(url.origin,'https://www.kookapp.cn');assert.equal(init?.redirect,'error');
    assert.equal(new Headers(init?.headers).get('authorization'),'Bot fixture-token');requested.push(url.pathname);
    return url.pathname.endsWith('/guild/view')?response({id:'fixture-guild',welcome_channel_id:'0',default_channel_id:'default-channel'}):response({id:'default-channel',guild_id:channelGuild,type,is_category:false});
  }});
  const event=parseTrustedKookGuildJoin(joined('fixture-bot','fixture-guild'),'fixture-bot')!;
  const target=await client.resolve(event);assert.equal(target?.channelId,'default-channel');assert.equal(target?.guildId,'fixture-guild');
  assert.deepEqual(requested,['/api/v3/guild/view','/api/v3/channel/view']);
  channelGuild='foreign-guild';await assert.rejects(client.resolve(event),error=>error instanceof Error&&error.message==='kook_welcome_target_invalid');
  channelGuild='fixture-guild';type=2;await assert.rejects(client.resolve(event),/kook_welcome_target_invalid/u);
});

test('welcome retries survive restart, dedupe, isolate guild backlog and revalidate the pinned channel before send',{skip:!databaseUrl},async()=>{
  const pool=new Pool({connectionString:databaseUrl,max:6}),suffix=randomUUID(),bot=`welcome-${suffix}`,guildA=`guild-a-${suffix}`,guildB=`guild-b-${suffix}`;
  let failA=true,foreignA=false,noChannel=false;
  const api=new KookGuildWelcomeApiClient({token:'fixture-token',botAccountId:bot,fetcher:async(input)=>{
    const url=new URL(String(input));
    if(url.pathname.endsWith('/guild/view')){
      const guild=url.searchParams.get('guild_id')!;
      if(guild===guildA&&failA)return new Response('unavailable',{status:503});
      return response({id:guild,welcome_channel_id:noChannel?'0':`channel-${guild}`,default_channel_id:'0'});
    }
    const channel=url.searchParams.get('target_id')!;
    return response({id:channel,guild_id:foreignA&&channel===`channel-${guildA}`?'foreign':channel.replace(/^channel-/u,''),type:1,is_category:false});
  }});
  const queue=new KookIngressQueue(pool,{botAccountId:bot}),signal=new AbortController().signal;
  const handler=async()=>assert.fail('welcome must bypass business/LLM handler');
  try{
    await migratePublicDatabase(pool);
    const a=joined(bot,guildA);await queue.ingestGatewayEvent(a);
    assert.equal(await queue.processOne(handler,signal,api),'retry');
    await pool.query("UPDATE kook_ingress_events SET next_attempt_at=now()+interval '1 minute' WHERE bot_account_id=$1 AND event_id=$2",[bot,a.msg_id]);
    const b=joined(bot,guildB);await queue.ingestGatewayEvent(b);
    assert.equal(await queue.processOne(handler,signal,api),'done'); // a's retry cannot block another guild
    failA=false;await pool.query('UPDATE kook_ingress_events SET next_attempt_at=now() WHERE bot_account_id=$1 AND event_id=$2',[bot,a.msg_id]);
    const restarted=new KookIngressQueue(pool,{botAccountId:bot});assert.equal(await restarted.processOne(handler,signal,api),'done');
    assert.equal(await restarted.ingestGatewayEvent(a),'duplicate');
    assert.equal((await pool.query('SELECT 1 FROM tenants WHERE bot_account_id=$1',[bot])).rowCount,0);
    assert.equal((await pool.query('SELECT 1 FROM channel_bindings WHERE bot_account_id=$1',[bot])).rowCount,0);
    assert.equal((await pool.query('SELECT 1 FROM kook_ingress_events WHERE bot_account_id=$1 AND event_json IS NOT NULL',[bot])).rowCount,0);
    const outbox=new KookMessageQueue(pool,{botAccountId:bot}),sent:string[]=[];
    const sender={async send(target:string){sent.push(target);},verifyWelcomeTarget:(guild:string,channel:string)=>api.verifyTarget(guild,channel)};
    assert.equal(await outbox.deliverOne(sender),'sent');assert.deepEqual(sent,[`channel-${guildB}`]);
    foreignA=true;assert.equal(await outbox.deliverOne(sender),'dead');assert.equal(sent.length,1);
    assert.equal((await pool.query("SELECT last_error_code FROM message_outbox WHERE bot_account_id=$1 AND status='dead'",[bot])).rows[0]?.last_error_code,'kook_welcome_target_invalid');
    noChannel=true;await queue.ingestGatewayEvent(joined(bot,`empty-${suffix}`));
    assert.equal(await queue.processOne(handler,signal,api),'dead');
    assert.equal((await pool.query("SELECT last_error_code FROM kook_ingress_events WHERE bot_account_id=$1 AND status='dead'",[bot])).rows[0]?.last_error_code,'kook_welcome_channel_unconfigured');
  }finally{
    await pool.query('DELETE FROM message_outbox WHERE bot_account_id=$1',[bot]);await pool.query('DELETE FROM kook_ingress_events WHERE bot_account_id=$1',[bot]);await pool.end();
  }
});

class WelcomeSocket implements KookGatewaySocket{
  private listeners=new Map<string,Array<(event:KookGatewaySocketEvent)=>void>>();
  addEventListener(type:string,listener:(event:KookGatewaySocketEvent)=>void){const values=this.listeners.get(type)??[];values.push(listener);this.listeners.set(type,values);}
  send(_data:string){}close(){this.emit('close',{});}open(){this.emit('open',{});}frame(value:unknown){this.emit('message',{data:JSON.stringify(value)});}
  private emit(type:string,event:KookGatewaySocketEvent){for(const listener of this.listeners.get(type)??[])listener(event);}
}
async function waitFor(check:()=>Promise<boolean>|boolean){for(let i=0;i<200;i++){if(await check())return;await new Promise(resolve=>setTimeout(resolve,10));}assert.fail('welcome fixture timed out');}

test('runtime acknowledges persisted guild join before slow target resolution, then sends exactly one welcome outbox reply',{skip:!databaseUrl},async()=>{
  const pool=new Pool({connectionString:databaseUrl,max:6}),suffix=randomUUID(),bot=`runtime-welcome-${suffix}`,guild=`guild-${suffix}`;
  const socket=new WelcomeSocket();let connected=false,unblock:()=>void=()=>{},sends=0;const blocked=new Promise<void>(resolve=>{unblock=resolve;});
  const stop=new AbortController();let run:Promise<void>|null=null;
  try{
    await migratePublicDatabase(pool);
    const runtime=new KookApplicationRuntime({pool,botAccountId:bot,token:'fixture-token',pollMs:5,socketFactory:()=>{connected=true;return socket;},handler:async()=>assert.fail('join entered business handler'),fetcher:async(input,init)=>{
      const url=new URL(String(input));
      if(url.pathname.endsWith('/gateway/index'))return response({url:'wss://gateway.kookapp.cn/gateway?token=fixture'});
      if(url.pathname.endsWith('/guild/view')){await blocked;return response({id:guild,welcome_channel_id:'welcome-channel'});}
      if(url.pathname.endsWith('/channel/view'))return response({id:'welcome-channel',guild_id:guild,type:1,is_category:false});
      assert.equal(url.pathname,'/api/v3/message/create');const body=init?.body as URLSearchParams;
      assert.equal(body.get('target_id'),'welcome-channel');assert.equal(body.get('type'),'1');assert.equal(body.has('quote'),false);sends++;return response({msg_id:'welcome-response'});
    }});
    run=runtime.run(stop.signal);await waitFor(()=>connected);socket.open();socket.frame({s:1,d:{code:0,session_id:'welcome-session'}});
    const event=joined(bot,guild);socket.frame({s:0,sn:1,d:event});
    await waitFor(async()=>Number((await pool.query('SELECT last_sn FROM kook_gateway_state WHERE bot_account_id=$1',[bot])).rows[0]?.last_sn)===1);
    assert.equal(sends,0);unblock();
    await waitFor(async()=>(await pool.query("SELECT 1 FROM message_outbox WHERE bot_account_id=$1 AND status='sent'",[bot])).rowCount===1);
    socket.frame({s:0,sn:2,d:event});await waitFor(async()=>Number((await pool.query('SELECT last_sn FROM kook_gateway_state WHERE bot_account_id=$1',[bot])).rows[0]?.last_sn)===2);
    stop.abort();await run;assert.equal(sends,1);
  }finally{
    unblock();stop.abort();if(run)await run.catch(()=>undefined);await pool.query('DELETE FROM message_outbox WHERE bot_account_id=$1',[bot]);await pool.query('DELETE FROM kook_ingress_events WHERE bot_account_id=$1',[bot]);await pool.query('DELETE FROM kook_gateway_state WHERE bot_account_id=$1',[bot]);await pool.end();
  }
});
