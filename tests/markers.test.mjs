import {test} from 'node:test';import assert from 'node:assert/strict';import {markerYaw} from '../src/render/markers.ts';
test('flat image points local -Z toward each target direction',()=>{for(const [dx,dz] of [[0,-1],[1,0],[0,1],[-1,0],[2,-3]]){const a=markerYaw(dx,dz),n=Math.hypot(dx,dz);assert.ok(Math.abs(-Math.sin(a)-dx/n)<1e-9);assert.ok(Math.abs(-Math.cos(a)-dz/n)<1e-9);}});
