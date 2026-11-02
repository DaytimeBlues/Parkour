import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeFrameSeconds, physicsFrameSeconds } from '../src/simulation/timing.ts';
test('active wall clock includes long stalls while simulation is capped', () => {
 const active = activeFrameSeconds(true, 6000, 1000);
 assert.equal(active, 5); assert.equal(physicsFrameSeconds(active), .1);
});
test('paused time does not accrue', () => assert.equal(activeFrameSeconds(false, 6000, 1000), 0));
test('clock reversal cannot subtract time', () => assert.equal(activeFrameSeconds(true, 100, 200), 0));
test('fall penalties add to active time', () => {let elapsed=activeFrameSeconds(true,1500,1000); elapsed+=3; assert.equal(elapsed,3.5);});
