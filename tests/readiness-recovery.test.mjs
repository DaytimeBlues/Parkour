import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const read=p=>readFileSync(new URL('../'+p,import.meta.url));
const hash=b=>createHash('sha256').update(b).digest('hex');
test('NEW candidate delivery receipt is complete and does not assert recovery of missing native/archive/media originals',()=>{
 const d=JSON.parse(read('assets/appearance-source/delivery-manifest.json'));
 assert.equal(d.revision,'readiness-reconstruction-20261104');assert.equal(d.originalCheckpointRecovered,false);
 assert.match(d.editableNativeIdentity,/not original native bytes/);assert.ok(d.missingOriginals.length>=3);
 assert.equal(d.files.filter(f=>f.path.endsWith('.blend')).length,8);assert.equal(d.files.filter(f=>f.path.endsWith('.glb')).length,8);
 for(const f of d.files){const b=read(f.path);assert.equal(b.length,f.bytes,f.path);assert.equal(hash(b),f.sha256,f.path);}
});
test('pre-reset GLB identities match independently recorded original hashes while regenerated native identity stays distinct',()=>{
 const r=JSON.parse(read('recovery-evidence/model-author-recovery-handoff.json'));
 for(const f of r.byteIdenticalOriginalRuntimeAssets)assert.equal(hash(read('public/models/appearance/'+f.name)),f.expectedOriginalSha256);
 for(const f of r.regeneratedEditableNativeIdentity){const h=hash(read('assets/appearance-source/'+f.name));assert.equal(h,f.actualRegeneratedSha256);assert.notEqual(h,f.expectedOriginalSha256);}
 assert.equal(hash(read('assets/appearance-source/generate_animated_assets.py')),'ce7bee1bc3850d9bfd73579a76dd5a7c069f07df17fef7d12d53e6e0d381f2e4');
});
