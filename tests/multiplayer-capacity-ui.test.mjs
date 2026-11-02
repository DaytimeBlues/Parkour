import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {ROOM_CAPACITY} from '../shared/multiplayer.mjs';
import {MP_POLICY} from '../server/lib/multiplayer.mjs';

test('capacity UI counts reserved seats, labels grandfathered rooms honestly and agrees with server',()=>{
 const source=readFileSync(new URL('../src/multiplayer/main.ts',import.meta.url),'utf8');
 const line=source.split('\n').find(line=>line.includes("$('player-count').textContent="));
 assert.equal(ROOM_CAPACITY,8);assert.equal(MP_POLICY.maxPlayers,ROOM_CAPACITY);
 for(const count of [0,7,8,12,32]){const node={textContent:''};vm.runInNewContext(line,{ROOM_CAPACITY,room:{players:Array(count)},$:id=>{assert.equal(id,'player-count');return node;}});
 assert.equal(node.textContent,count>8?`${count} legacy seats · new joins closed`:`${count} / 8 reserved seats`);}
 const html=readFileSync(new URL('../multiplayer/index.html',import.meta.url),'utf8');assert.match(html,/up to 8 reserved seats/);assert.doesNotMatch(html,/up to 32 runners/);
 assert.match(source,/ROOM_FULL:`New joins are limited to \$\{ROOM_CAPACITY\} reserved seats/);
});
