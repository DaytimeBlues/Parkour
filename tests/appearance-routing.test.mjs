import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createServer} from 'vite';
/** HTTP/package route only: not a browser, GPU or ordinary-control acceptance test. */
test('existing Vite preview route serves all exact imported GLBs rather than fallback HTML',async()=>{const root=fileURLToPath(new URL('../',import.meta.url)),server=await createServer({root,configFile:false,server:{host:'127.0.0.1',port:0},logLevel:'silent'});try{await server.listen();const address=server.httpServer.address();assert.ok(address&&typeof address!=='string');const base=`http://127.0.0.1:${address.port}`;for(const name of ['avatar-fox','avatar-rabbit','wings-angel','wings-devil','wings-parakeet','wings-elephant','wings-glow','wings-dragon']){const response=await fetch(`${base}/models/appearance/${name}.glb`);assert.equal(response.status,200,name);assert.doesNotMatch(response.headers.get('content-type')??'',/text\/html/);const served=Buffer.from(await response.arrayBuffer()),source=readFileSync(new URL(`../public/models/appearance/${name}.glb`,import.meta.url));assert.equal(served.readUInt32LE(0),0x46546c67);assert.equal(createHash('sha256').update(served).digest('hex'),createHash('sha256').update(source).digest('hex'),name);}}finally{await server.close();}});
