import test from 'node:test';
import assert from 'node:assert/strict';
import {createPumpDriver} from '../src/multiplayer/pump.ts';

function scheduler(){
 let id=0;const callbacks=new Map();
 return {callbacks,setTimer:fn=>{const key=++id;callbacks.set(key,fn);return key;},clearTimer:key=>callbacks.delete(key),fire(){const [key,fn]=callbacks.entries().next().value;callbacks.delete(key);fn();}};
}
const ready=()=>({lastAttempt:0,busy:false,needsReconnect:false,room:{status:'running'},async pump(){}});
test('unexpected recovery rejection stops the pump and reports the exact error once',async()=>{
 const timers=scheduler(),errors=[],failure=new Error('unexpected recovery failure');
 const client={...ready(),needsReconnect:true,async recover(){throw failure;}};
 const driver=createPumpDriver(()=>client,()=>true,{...timers,clock:()=>1000,onError:error=>errors.push(error)});
 timers.fire();await driver.whenIdle();
 assert.deepEqual(errors,[failure]);assert.equal(timers.callbacks.size,0);
 driver.wake();assert.equal(timers.callbacks.size,0);driver.stop();
});
test('an obsolete recovery rejection cannot stop a newer client generation',async()=>{
 const timers=scheduler(),errors=[];let rejectRecovery,client={...ready(),needsReconnect:true,recover:()=>new Promise((_,reject)=>{rejectRecovery=reject;})};
 const driver=createPumpDriver(()=>client,()=>true,{...timers,clock:()=>1000,onError:error=>errors.push(error)});
 timers.fire();client=ready();driver.wake();rejectRecovery(new Error('old request failed'));await driver.whenIdle();
 assert.equal(errors.length,0);assert.equal(timers.callbacks.size,1);
 timers.fire();await driver.whenIdle();assert.equal(timers.callbacks.size,1);driver.stop();
});
test('stopped recovery work does not emit a late error or rearm timers',async()=>{
 const timers=scheduler(),errors=[];let rejectRecovery;
 const client={...ready(),needsReconnect:true,recover:()=>new Promise((_,reject)=>{rejectRecovery=reject;})};
 const driver=createPumpDriver(()=>client,()=>true,{...timers,clock:()=>1000,onError:error=>errors.push(error)});
 timers.fire();driver.stop();rejectRecovery(new Error('request failed after stop'));await driver.whenIdle();
 assert.equal(errors.length,0);assert.equal(timers.callbacks.size,0);
});
test('permanent membership ends timer churn until an explicit newer view wakes the driver',async()=>{
 const timers=scheduler();let calls=0,client={...ready(),membershipIssue:null,async pump(){calls++;this.membershipIssue='seat-removed';this.needsReconnect=true;}};
 const driver=createPumpDriver(()=>client,()=>true,{...timers,clock:()=>1000});timers.fire();await driver.whenIdle();assert.equal(calls,1);assert.equal(timers.callbacks.size,0);
 driver.wake();timers.fire();await driver.whenIdle();assert.equal(timers.callbacks.size,0);assert.equal(calls,1);
 client={...ready(),async pump(){calls++;}};driver.wake();timers.fire();await driver.whenIdle();assert.equal(calls,2);assert.equal(timers.callbacks.size,1);driver.stop();
});
test('membership revoked by automatic recovery does not rearm the driver',async()=>{const timers=scheduler();const client={...ready(),needsReconnect:true,async recover(){this.membershipIssue='seat-removed';}};const driver=createPumpDriver(()=>client,()=>true,{...timers,clock:()=>1000});timers.fire();await driver.whenIdle();assert.equal(timers.callbacks.size,0);driver.stop();});
for(const state of ['restored','ended','hidden'])test(`permanent ${state} client stops all timer churn before ordinary idle conditions`,async()=>{const timers=scheduler(),client={...ready(),membershipIssue:'seat-removed',room:state==='restored'?null:{status:state==='ended'?'ended':'running'}};const driver=createPumpDriver(()=>client,()=>state!=='hidden',{...timers,clock:()=>1000});timers.fire();await driver.whenIdle();assert.equal(timers.callbacks.size,0);driver.stop();});
