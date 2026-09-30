import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { assetPath, readRegisteredAsset } from '../src/delivery-assets.js';
import { createAttachmentPart } from '../src/delivery-envelope.js';

const bytes=Buffer.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1]);
const id=`img_${'a'.repeat(32)}`; const sha=createHash('sha256').update(bytes).digest('hex');
const part=createAttachmentPart({assetId:id,mimeType:'image/png',fileName:'image.png',disposition:'document',byteSize:bytes.length,sha256:sha});
test('asset paths reject traversal, absolute, Windows, empty segments before normalization',()=>{
  for(const path of ['../image.png','a/../image.png','/etc/passwd','a\\image.png','a//image.png','./image.png','']) assert.throws(()=>assetPath('/assets',path));
});
test('registered ready asset is bounded, MIME/size/digest verified; escapes and failures rejected',async()=>{
  const root=await mkdtemp(join(tmpdir(),'delivery-assets-'));const outside=await mkdtemp(join(tmpdir(),'delivery-outside-'));
  try{
    await mkdir(join(root,'derived'));await writeFile(join(root,'derived/image.png'),bytes);await writeFile(join(outside,'image.png'),bytes);
    const metadata={imageId:id,storageKey:'derived/image.png',mimeType:'image/png',byteSize:bytes.length,sha256:sha,status:'ready'};
    const result=await readRegisteredAsset(root,part,metadata);assert.deepEqual(result.bytes,bytes);assert.equal(result.sha256,sha);
    await assert.rejects(readRegisteredAsset(root,part,{...metadata,status:'failed'}));
    await assert.rejects(readRegisteredAsset(root,part,{...metadata,imageId:'missing'}));
    await assert.rejects(readRegisteredAsset(root,part,{...metadata,storageKey:'missing.png'}));
    await assert.rejects(readRegisteredAsset(root,part,{...metadata,byteSize:bytes.length+1}));
    await assert.rejects(readRegisteredAsset(root,part,{...metadata,sha256:'b'.repeat(64)}));
    await symlink(join(outside,'image.png'),join(root,'escape.png'));await assert.rejects(readRegisteredAsset(root,part,{...metadata,storageKey:'escape.png'}));
    await symlink(outside,join(root,'escape-dir'));await assert.rejects(readRegisteredAsset(root,part,{...metadata,storageKey:'escape-dir/image.png'}));
    await writeFile(join(root,'derived/image.png'),Buffer.alloc(bytes.length));await assert.rejects(readRegisteredAsset(root,part,metadata));
  }finally{await rm(root,{recursive:true,force:true});await rm(outside,{recursive:true,force:true});}
});
