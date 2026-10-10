#!/usr/bin/env node
// Safe-once community bootstrap: no production credential reads or writes.
import { randomBytes } from 'node:crypto';
import { mkdir, open, stat, unlink } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const random=()=>randomBytes(32).toString('hex');
const TOOLS=[
  'pubg_resolve_players','pubg_search_matches','pubg_query_stats','pubg_compare_stats',
  'pubg_get_match','pubg_get_review_facts','pubg_get_period_review','pubg_query_team_damage',
  'pubg_prefetch_telemetry','pubg_telemetry_sync_report'
];
export function parseArgs(argv){
  if(argv.length===1 && (argv[0]==='--help'||argv[0]==='-h'))return {help:true};
  if(argv.length!==2||argv[0]!=='--model')throw Error('usage: node scripts/init-community.mjs --model YOUR_9ROUTER_MODEL');
  const model=argv[1];
  if(!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,100}$/.test(model))throw Error('invalid_9router_model_id');
  return {model};
}
export function makeOpenClawConfig(model){
  return {
    gateway:{mode:'local',bind:'lan',port:18789,auth:{mode:'token'},controlUi:{enabled:true,allowedOrigins:['http://127.0.0.1:18789','http://localhost:18789']}},
    agents:{defaults:{workspace:'/home/node/.openclaw/workspace',model:{primary:'nine_router/'+model},userTimezone:'UTC'}},
    models:{mode:'merge',providers:{nine_router:{
      baseUrl:'http://nine-router:20128/v1',
      apiKey:{source:'env',provider:'default',id:'OPENCLAW_9ROUTER_API_KEY'},
      api:'openai-completions',
      models:[{id:model,name:model,reasoning:false,input:['text'],contextWindow:128000,maxTokens:8192}]
    }}},
    tools:{profile:'minimal',alsoAllow:TOOLS},
    plugins:{enabled:true,allow:['pubg','whatsapp'],entries:{
      pubg:{enabled:true,config:{databasePath:'/data/pubg.sqlite',teamConfigFile:'/run/secrets/pubg_team.json',apiKeyFile:'/run/secrets/pubg_api_key',identityDatabasePath:'/data/identity.sqlite',timezone:'UTC',businessDayStart:'06:00'}},
      whatsapp:{enabled:true}
    }},
    channels:{whatsapp:{enabled:true,dmPolicy:'pairing',groupPolicy:'disabled',groups:{},configWrites:false}},
    tts:{auto:'off'}
  };
}
async function writeNew(path,text){
  const f=await open(path,'wx',0o600);
  try{await f.writeFile(text,'utf8');}finally{await f.close();}
}
export async function init(model,{root=ROOT,randomFn=random}={}){
  const env=join(root,'infra/community/.env'),local=join(root,'.local');
  const config=join(local,'community-openclaw.json');
  const api=join(local,'pubg-api-key');
  const team=join(local,'pubg-team.json');
  for(const path of [env,config,api,team]){
    try {await stat(path);throw Error('existing_community_file_refusing_overwrite: '+path);}
    catch(e){if(e?.code!=='ENOENT')throw e;}
  }
  await mkdir(local,{recursive:true,mode:0o700});
  const created=[];
  try{
    const values={
      NINE_ROUTER_INITIAL_PASSWORD:randomFn(),
      NINE_ROUTER_JWT_SECRET:randomFn(),
      NINE_ROUTER_API_KEY_SECRET:randomFn(),
      NINE_ROUTER_MACHINE_ID_SALT:randomFn(),
      NINE_ROUTER_PORT:'20128',
      OPENCLAW_GATEWAY_TOKEN:randomFn(),
      OPENCLAW_9ROUTER_API_KEY:'',
      OPENCLAW_PORT:'18789',
      TIMEZONE:'UTC'
    };
    await writeNew(env,Object.entries(values).map(([key,value])=>key+'='+value).join('\n')+'\n');created.push(env);
    await writeNew(config,JSON.stringify(makeOpenClawConfig(model),null,2)+'\n');created.push(config);
    await writeNew(api,'');created.push(api);
  } catch(e){
    for(const p of created.reverse())await unlink(p).catch(()=>{});
    throw e;
  }
  return {env,config,api};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try {
    const options=parseArgs(process.argv.slice(2));
    if(options.help){console.log('node scripts/init-community.mjs --model YOUR_9ROUTER_MODEL\nCreates private 9Router and OpenClaw configs (no overwrites).');}
    else{
      const output=await init(options.model);
      console.log('COMMUNITY_BOOTSTRAP=created');
      console.log('PRIVATE_ENV='+output.env);
      console.log('PRIVATE_OPENCLAW_CONFIG='+output.config);
      console.log('PUBG_API_KEY_FILE='+output.api);
      console.log('Secrets are not printed. Configure your own 9Router API key before enabling PUBG.');
    }
  }catch(e){console.error('COMMUNITY_BOOTSTRAP_FAILED='+e.message);process.exitCode=1;}
}
