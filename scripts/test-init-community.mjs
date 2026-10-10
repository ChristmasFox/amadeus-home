import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { init, makeOpenClawConfig, parseArgs } from './init-community.mjs';

test('community config contains only PUBG tools and restricted WhatsApp defaults', () => {
  const config=makeOpenClawConfig('demo-chat');
  assert.equal(config.agents.defaults.model.primary,'nine_router/demo-chat');
  assert.equal(config.models.providers.nine_router.apiKey.id,'OPENCLAW_9ROUTER_API_KEY');
  assert.equal(config.channels.whatsapp.dmPolicy,'pairing');
  assert.equal(config.channels.whatsapp.groupPolicy,'disabled');
  assert.equal(config.tools.profile,'minimal');
  assert.deepEqual(config.plugins.allow,['pubg','whatsapp']);
  assert.ok(config.tools.alsoAllow.includes('pubg_query_stats'));
  assert.equal(JSON.stringify(config).includes('dangerouslyAllowPrivateNetwork'),false);
  assert.equal(JSON.stringify(config).includes('telegram'),false);
  assert.equal(JSON.stringify(config).includes('arthur'),false);
  assert.throws(()=>parseArgs(['--model','bad model']),/invalid_9router_model_id/);
});

test('bootstrap is non-overwriting and generates private, distinct secrets',async()=>{
  const root=await mkdtemp(join(tmpdir(),'amadeus-community-'));
  try {
    await mkdir(join(root,'infra/community'),{recursive:true});
    let n=0;
    const result=await init('community-model',{root,randomFn:()=>('fixture-'+(++n))});
    const env=await readFile(result.env,'utf8');
    assert.match(env,/NINE_ROUTER_INITIAL_PASSWORD=fixture-1/);
    assert.match(env,/NINE_ROUTER_JWT_SECRET=fixture-2/);
    assert.match(env,/OPENCLAW_GATEWAY_TOKEN=fixture-5/);
    assert.match(env,/OPENCLAW_9ROUTER_API_KEY=\n/);
    assert.equal((await readFile(result.api,'utf8')),'');
    assert.equal(JSON.parse(await readFile(result.config,'utf8')).plugins.entries.pubg.config.teamConfigFile,'/run/secrets/pubg_team.json');
    if(process.platform!=='win32')for(const p of [result.env,result.config,result.api])assert.equal((await stat(p)).mode&0o777,0o600);
    await assert.rejects(()=>init('different',{root}),/existing_community_file_refusing_overwrite/);
    assert.equal(await readFile(result.env,'utf8'),env);
  } finally {await rm(root,{recursive:true,force:true});}
});
