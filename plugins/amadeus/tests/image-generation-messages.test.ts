import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import { createImageGenerationMessageEnricher } from '../src/image-generation-messages.js';

async function fixture(complete: (input: any) => Promise<{text:string}>) {
  const root=await mkdtemp(join(tmpdir(),'amadeus-lifecycle-message-'));
  const workspace=join(root,'workspace');await mkdir(workspace);await writeFile(join(workspace,'SOUL.md'),'Kurisu is sharp-minded, reliable, and lightly teasing.');
  const calls:any[]=[];
  const api={config:{},logger:{info(){}},runtime:{agent:{resolveAgentDir:()=>root,resolveAgentWorkspaceDir:()=>workspace},subagent:{complete:async(input:any)=>{calls.push(input);return await complete(input);}}}} as unknown as OpenClawPluginApi;
  return {root,api,calls};
}

test('accepted/failure lifecycle copy uses current Kurisu persona and only safe semantic task context', async()=>{
  const f=await fixture(async(input)=>({text:input.message.startsWith('The image-generation task has actually been accepted')?'图像生成已经开始了，稍等片刻。':'这次图没有生成成功，换个描述再试一次吧。'}));
  try{
    const enrich=createImageGenerationMessageEnricher(f.api);
    const start=await enrich('accepted','main');const failure=await enrich('failed','main');
    assert.equal(start,'图像生成已经开始了，稍等片刻。');assert.equal(failure,'这次图没有生成成功，换个描述再试一次吧。');
    assert.ok(f.calls.every(call=>call.extraSystemPrompt.includes('Kurisu is sharp-minded')));
    assert.ok(f.calls[1].message.includes('Do not expose internal failure details'));
    assert.ok(!f.calls[1].message.includes('stack'));
  }finally{await rm(f.root,{recursive:true,force:true});}
});

test('failure message model error or malformed protocol uses safe Kurisu fallback only', async()=>{
  const failed=await fixture(async()=>{throw new Error('SECRET provider stack payload');});
  const malformed=await fixture(async()=>({text:'{"message":"SECRET protocol"}'}));
  try{
    const safeFailure=await createImageGenerationMessageEnricher(failed.api)('failed','main');
    const malformedFailure=await createImageGenerationMessageEnricher(malformed.api)('failed','main');
    assert.equal(safeFailure,'画像生成に失敗したわ。条件を変えて、もう一度試して。');
    assert.equal(malformedFailure,safeFailure);
    assert.equal(safeFailure.includes('SECRET'),false);
    assert.equal(failed.calls.length,1);assert.equal(malformed.calls.length,1,'fallback never calls a second model');
  }finally{await Promise.all([rm(failed.root,{recursive:true,force:true}),rm(malformed.root,{recursive:true,force:true})]);}
});

test('image-generation Skill prevents a second final-reply acknowledgement for accepted detached work', async()=>{
  const skill=await readFile(new URL('../skills/image-generation/SKILL.md',import.meta.url),'utf8');
  assert.ok(skill.includes('typed image-generation lifecycle coordinator'));
  assert.ok(skill.includes('Do not echo a second start'));
  assert.ok(skill.includes('Return a silent DeliveryEnvelope'));
  assert.ok(skill.includes('Never infer this lifecycle from started-receipt prose'));
});
