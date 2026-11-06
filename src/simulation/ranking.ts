export const rankingRules=(courseId:string)=>/-flow-v[12]-glide-v1$/.test(courseId)?'mapwide-glide-v1':courseId.endsWith('-flow-v2')?'flow-v2':courseId.endsWith('-flow-v1')?'flow-v1':courseId==='relay-gardens-v1'?'relay-gardens-v1-be1290f':'vertical-v1';
export type RankedEvent={sequence:number;kind:'checkpoint'|'relay'|'fall'|'finish'|'abandon';checkpoint?:number;relay?:number};
export type RunTicket={runId:string;startedMs:number;expiresMs:number;alias:string};
type Fetcher=(url:string,init?:RequestInit)=>Promise<Response>;
/** Client outbox only. Server owns score computation; client milestones are not anti-cheat proof. */
export class RankingClient {
 ticket:RunTicket|null=null;state:'practice'|'starting'|'active'|'finished'|'error'='practice';message='Practice run · personal best stays on this device.';
 private epoch=0;private sequence=1;private queue:RankedEvent[]=[];private flushing:Promise<void>|null=null;private blocked=false;private seenCheckpoint=0;private seenFalls=0;private seenRelays=new Set<number>();private finishQueued=false;
 private startChain:Promise<unknown>=Promise.resolve();
 private unresolvedStart:{courseId:string;rulesVersion:string;idempotencyKey:string}|null=null;
 private fetcher:Fetcher;private notify:()=>void;private completed:()=>void;
 constructor(fetcher:Fetcher,notify:()=>void,completed:()=>void){this.fetcher=fetcher;this.notify=notify;this.completed=completed;}
 private status(message:string){this.message=message;this.notify();}
 private async post(url:string,body:unknown){const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),10000);try{const r=await this.fetcher(url,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify(body),signal:controller.signal});const j=await r.json();if(!r.ok)throw Object.assign(Error(typeof j.message==='string'?j.message:typeof j.error==='string'?j.error:'Shared ranking request failed.'),{status:r.status});return j;}finally{clearTimeout(timeout);}}
 reset(){this.epoch++;this.ticket=null;this.queue=[];this.sequence=1;this.flushing=null;this.blocked=false;this.seenCheckpoint=0;this.seenFalls=0;this.seenRelays.clear();this.finishQueued=false;this.state='practice';this.status('Practice run · personal best stays on this device.');}
 private async issueStart(body:{courseId:string;rulesVersion:string;idempotencyKey:string}){try{return await this.post('/api/runs',body);}catch(error){const status=(error as {status?:number}).status;if(status&&status>=400&&status<500&&status!==408&&status!==429)this.unresolvedStart=null;throw error;}}
 async begin(courseId:string,enabled:boolean):Promise<boolean>{
  this.reset();if(!enabled)return true;
  const epoch=this.epoch;this.state='starting';this.status('Connecting to the shared clock…');
  const work=this.startChain.then(async()=>{
   if(epoch!==this.epoch)return false;
   try{
    const session=await this.post('/api/session',{});if(epoch!==this.epoch)return false;
    // A timed-out request may still have committed. Materialize its SAME key
    // before a new key can abandon it; a late retry then has no side effects.
    if(this.unresolvedStart){await this.issueStart(this.unresolvedStart);this.unresolvedStart=null;}
    if(epoch!==this.epoch)return false;
    const issue={courseId,rulesVersion:rankingRules(courseId),idempotencyKey:crypto.randomUUID()};
    this.unresolvedStart=issue;
    const run=await this.issueStart(issue);
    if(typeof run.runId!=='string'||!Number.isFinite(run.startedMs))throw Error('Invalid shared-clock response.');
    this.unresolvedStart=null;if(epoch!==this.epoch)return false;
    this.ticket={...run,alias:run.alias??session.alias};this.state='active';this.status(`Ranked as ${this.ticket!.alias} · server clock includes pauses.`);return true;
   }catch{if(epoch===this.epoch){this.state='error';this.status('Shared ranking unavailable. Uncheck ranked mode to play offline, or retry Start.');}return false;}
  });
  this.startChain=work.catch(()=>false);return work;
 }
 private invalidate(message:string){this.state='error';this.blocked=true;this.queue=[];this.status(message);}
 private enqueue(event:Omit<RankedEvent,'sequence'>){if(!this.ticket||this.state!=='active')return;if(this.queue.length>=250||this.sequence>256){this.invalidate('Ranked event limit reached. This run is now practice only; start a new run to rank.');return;}this.queue.push({sequence:this.sequence++,...event});if(!this.blocked)void this.flush();}
 observe(checkpoint:number,falls:number,relays:ReadonlySet<number>=new Set()){
  if(!this.ticket||this.state!=='active'||this.finishQueued)return;
  if(checkpoint>this.seenCheckpoint+1){this.invalidate('A ranked checkpoint was skipped. Finish as practice or start a new ranked run.');return;}
  // Order a checkpoint before its floor relay, and the relay before its dependent warp checkpoint.
  for(let cp=this.seenCheckpoint+1;cp<=checkpoint;cp++){if(cp===2&&relays.has(1)&&!this.seenRelays.has(1)){this.enqueue({kind:'relay',relay:1});this.seenRelays.add(1);}if(cp===4&&relays.has(2)&&!this.seenRelays.has(2)){this.enqueue({kind:'relay',relay:2});this.seenRelays.add(2);}this.enqueue({kind:'checkpoint',checkpoint:cp});this.seenCheckpoint=cp;}
  for(const relay of [1,2])if(relays.has(relay)&&!this.seenRelays.has(relay)){this.enqueue({kind:'relay',relay});this.seenRelays.add(relay);}
  while(this.seenFalls<falls){this.enqueue({kind:'fall'});this.seenFalls++;}
 }
 finish(){if(this.finishQueued||this.state!=='active')return;this.enqueue({kind:'finish'});this.finishQueued=true;this.notify();}
 retry(){this.blocked=false;return this.flush();}
 async flush():Promise<void>{if(this.flushing)return this.flushing;if(this.blocked||!this.ticket||this.state!=='active')return;const epoch=this.epoch,runId=this.ticket.runId;const work=(async()=>{while(this.queue.length&&epoch===this.epoch&&this.state==='active'){const event=this.queue[0];try{const receipt=await this.post(`/api/runs/${encodeURIComponent(runId)}/events`,event);if(epoch!==this.epoch||this.state!=='active')return;if(receipt.sequence!==event.sequence)throw Error('Mismatched event receipt.');this.queue.shift();if(receipt.status==='finished'){this.state='finished';this.status(`Shared time ${(receipt.scoreMs/1000).toFixed(2)}s posted as ${this.ticket!.alias}.`);this.completed();return;}this.status(`Ranked as ${this.ticket!.alias} · ${this.queue.length?'syncing…':'server clock includes pauses.'}`);}catch(error){if(epoch===this.epoch){const status=(error as {status?:number}).status;if(status&&status>=400&&status<500&&status!==408&&status!==429){this.invalidate('The server rejected this ranked run. Your local practice result is safe; start a new run.');}else{this.blocked=true;this.status('Shared score not confirmed. Your local run is safe; use Retry sync in the menu.');}}return;}}})();this.flushing=work;try{await work;}finally{if(epoch===this.epoch)this.flushing=null;}}
 get pending(){return this.queue.length;}
 get awaitingSubmission(){return this.finishQueued&&this.state==='active';}
}
