import { createHash,randomBytes } from 'node:crypto';
import { lstat,readFile,realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readRenderContract } from './render-layer.mjs';

export const publicMap='fox-woodland-seven-stage-draft-a85c2974e2ee';
export const publicController='res://authority_smoke/controller_public.gd';
export const publicScene='res://classroom_draft/map.tscn';
export const godotSHA256='8d106cbe6144c2dc7e881d61d2429c1a8a76e6b22ef48bd5e48dcf934953f71e';
export const hostTTL=25*60*1000;
export const assetNames=['index.html','index.js','index.wasm','index.pck'];
const mimetypes=['text/html; charset=utf-8','text/javascript; charset=utf-8','application/wasm','application/octet-stream'];
const hash=b=>createHash('sha256').update(b).digest('hex');
const fail=(status,message='Preview unavailable')=>Object.assign(new Error(message),{status});
const reviewedManifest='711e9dca18a6fd091090814e8816b656b24dd6f0843176d926a4019f046c0943';
const reviewedAuthorityPack='676c0e00e1e2301388c5ddf8e9523c01830b1b33bf105642c8c9620348848465';
export function renderPublicConfig(env) {
  // Expected origin + service ID are explicit operator settings, not copied from a request.
  return readRenderContract(env,{origin:env.FOX_PUBLIC_APPROVED_ORIGIN,serviceId:env.FOX_PUBLIC_APPROVED_SERVICE_ID,
    manifestSHA256:reviewedManifest,authoritySHA256:reviewedAuthorityPack,roomLimit:1});
}
export async function loadPublicRelease(root,authorityPack,godot) {
  const realRoot=await realpath(root);
  const config=await readFile(resolve(realRoot,'fox-public-export.json'));
  if (hash(config)!==reviewedManifest) throw fail(500,'Public Web manifest mismatch');
  const expected=JSON.parse(config);
  if (expected.mapId!==publicMap || expected.version!=='fox-run-classroom-v1' ||
      expected.scope!=='public-fox-deer-preview-v1') throw fail(500,'Public Web identity mismatch');
  const authorityStats=await lstat(authorityPack);
  if (!authorityStats.isFile() || authorityStats.isSymbolicLink() || await realpath(authorityPack)!==authorityPack ||
      hash(await readFile(authorityPack))!==reviewedAuthorityPack ||
      hash(await readFile(godot))!==godotSHA256) throw fail(500,'Public authority pack pin mismatch');
  const publicFiles=new Map();
  for(const [i,name] of assetNames.entries()){
    const full=resolve(realRoot,name), stats=await lstat(full);
    if (!stats.isFile() || stats.isSymbolicLink() || await realpath(full)!==full ||
        hash(await readFile(full))!==expected.sha256[name]) throw fail(500,'Public Web file mismatch');
    publicFiles.set('/play/'+name,{path:full,size:stats.size,mime:mimetypes[i]});
  }
  return {root:realRoot,mapId:publicMap, asset:p=>publicFiles.get(p==='/play/'?'/play/index.html':p)};
}

const cookieName='__Host-fox_public_host';
export class PublicHostAuth {
  sessions=new Map();
  constructor(now=Date.now){this.now=now;}
  sweep(){for(const [key,v] of this.sessions)if(v.expires<=this.now())this.sessions.delete(key);}
  newHost(){
    this.sweep();
    if(this.sessions.size>=16)throw fail(429,'Preview is busy');
    const token=randomBytes(32).toString('base64url');
    const principal='host-'+randomBytes(16).toString('hex');
    this.sessions.set(hash(token),{principal,expires:this.now()+hostTTL});
    return {principal,cookie:cookieName+'='+token+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age='+hostTTL/1000};
  }
  extract(header=''){
    if(typeof header!=='string'||header.length>4096)return;
    const entries=header.split(';').map(x=>x.trim()).filter(x=>x.startsWith(cookieName+'='));
    if(entries.length!==1)return;
    const token=entries[0].slice(cookieName.length+1);
    if(!/^[A-Za-z0-9_-]{43}$/.test(token))return;
    return hash(token);
  }
  identify(header){const session=this.sessions.get(this.extract(header));return session?.expires>this.now()?session.principal:null;}
  logout(header){this.sessions.delete(this.extract(header));return this.clear();}
  clear(){return cookieName+'=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0';}
}
