import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
const read=p=>readFileSync(new URL('../'+p,import.meta.url));
const manifest=JSON.parse(read('assets/appearance-source/refined-manifest.json'));
function glb(name){const bytes=read(`public/models/appearance/${name}.glb`);assert.equal(bytes.readUInt32LE(0),0x46546c67);assert.equal(bytes.readUInt32LE(4),2);assert.equal(bytes.readUInt32LE(8),bytes.length);assert.equal(bytes.readUInt32LE(16),0x4e4f534a);return JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)));}
const expected={'avatar-fox':[2932,16],'avatar-rabbit':[3486,19],'wings-angel':[1144,6],'wings-devil':[772,6],'wings-parakeet':[1144,16],'wings-elephant':[1172,6],'wings-glow':[212,6],'wings-dragon':[1172,6]};
test('refined shipping models and complete editable generator match frozen manifest',()=>{
 assert.equal(manifest.files.length,9);assert.equal(new Set(manifest.files.map(x=>x.path)).size,9);
 for(const file of manifest.files){assert.ok(file.path.startsWith('public/models/appearance/')||file.path==='assets/appearance-source/generate_refined_assets.py');const b=read(file.path);assert.equal(b.length,file.bytes,file.path);assert.equal(createHash('sha256').update(b).digest('hex'),file.sha256,file.path);}
 assert.deepEqual(manifest.assets.map(x=>x.name).sort(),Object.keys(expected).sort());
});
test('eight revised exports retain self-contained rigid-clip/material interface and exact measured geometry',()=>{
 for(const [name,[triangles,meshes]] of Object.entries(expected)){
  const j=glb(name),wing=name.startsWith('wings-'),names=new Set(j.nodes.map(x=>x.name));
  assert.match(j.asset.generator,/Blender/);assert.ok(j.buffers.every(x=>!x.uri));assert.equal((j.images??[]).length,0);assert.equal((j.textures??[]).length,0);assert.equal((j.skins??[]).length,0);assert.equal((j.cameras??[]).length,0);assert.ok((j.extensionsRequired??[]).every(x=>x==='KHR_materials_emissive_strength'));
  assert.ok(names.has(wing?'Wings':'Avatar'));for(const n of wing?['WingLeft','WingRight']:['WingSocket','FrontLeft','FrontRight','BackLeft','BackRight'])assert.ok(names.has(n),name+' '+n);
  const count=j.meshes.flatMap(x=>x.primitives).reduce((n,p)=>n+j.accessors[p.indices??p.attributes.POSITION].count/3,0);assert.equal(count,triangles,name);assert.equal(j.meshes.length,meshes,name);
  for(const m of j.materials){assert.equal(m.doubleSided??false,false);assert.equal(m.alphaMode??'OPAQUE','OPAQUE');assert.equal(m.pbrMetallicRoughness?.baseColorTexture,undefined);assert.equal(m.normalTexture,undefined);}
  assert.deepEqual(j.animations.map(x=>x.name).sort(),(wing?['WingOpen','WingFold','WingGlide']:['AvatarIdle','AvatarRun','AvatarGlide']).sort());
  for(const clip of j.animations)for(const ch of clip.channels){assert.match(j.nodes[ch.target.node].name,wing?/^Wing(Left|Right)$/:/^(Front|Back)(Left|Right)$/);assert.ok(['translation','rotation','scale'].includes(ch.target.path));}
 }
});
test('explicit refined asset cost is bounded independently for raw and active batched paths',()=>{
 const source=read('src/multiplayer/remote-avatar.ts').toString(),expression=source.match(/REMOTE_AVATAR_BUDGET=Object\.freeze\((\{[^\n]+\})\)/)[1],b=vm.runInNewContext('('+expression+')');
 const maxAvatar=Math.max(expected['avatar-fox'][0],expected['avatar-rabbit'][0]),maxWing=Math.max(...Object.entries(expected).filter(([k])=>k.startsWith('wings')).map(([,v])=>v[0]));
 assert.equal(b.trianglesPerAvatar,maxAvatar+maxWing+12);assert.equal(b.drawCallsPerAvatar,19+16+1);assert.equal(b.batchedDrawCallsPerAvatar,19+6+1);assert.equal(b.entries,32);assert.equal(b.templates,8);
 assert.match(read('src/multiplayer/scene.ts').toString(),/batchParakeet:true/);assert.equal(8*b.trianglesPerAvatar,37360);assert.equal(8*b.batchedDrawCallsPerAvatar,208);assert.equal(8*b.optimizedDrawCallsPerAvatar,160);assert.match(read('src/multiplayer/scene.ts').toString(),/batchAvatars:true/);
});
