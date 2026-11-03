import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync('public/command-queue.js','utf8');
function loadQueue(){
 const window={};
 vm.runInNewContext(source,{window,globalThis:window,Map,Set,Promise,JSON,Date,Error,encodeURIComponent,console});
 return window.OficinaCommands;
}
function memoryStore(){
 const items=new Map();
 return {
   async get(id){return items.get(id)||null;},
   async put(record){items.set(record.id,structuredClone(record));},
   async delete(id){items.delete(id);},
   async list(ownerId){return [...items.values()].filter(x=>x.ownerId===String(ownerId));}
 };
}
const ok=(payload={id:4})=>({ok:true,status:200,async text(){return JSON.stringify(payload)}});
const offline=()=>{throw new Error('Network unavailable')};

test('RED: write-ahead persists before network, restores same ID after reload and never stores bearer tokens',async()=>{
 const mod=loadQueue(),store=memoryStore(),sent=[];
 const fail=mod.createQueue({store,send:async cmd=>{sent.push(cmd);offline()}});
 await assert.rejects(()=>fail.execute({ownerId:7,path:'/api/sales',method:'POST',
   body:{requestId:'sale-durable-001',paymentMethod:'PIX',items:[{serviceId:9,quantity:1}]}}),/aguardando|confirmação|pendente/i);
 const pending=await store.list('7');assert.equal(pending.length,1);
 assert.equal(pending[0].body.requestId,'sale-durable-001');
 assert.equal(JSON.stringify(pending).includes('Bearer '),false);
 const recovered=mod.createQueue({store,send:async cmd=>{sent.push(cmd);return ok()}});
 assert.equal(await recovered.replay(7,{manual:true}),1);
 assert.equal((await store.list('7')).length,0);
 assert.equal(sent[0].body.requestId,sent[1].body.requestId);
});

test('RED: a second submission with a new ID cannot double-submit an identical pending payload',async()=>{
 const mod=loadQueue(),store=memoryStore(),send=async()=>offline();
 const q=mod.createQueue({store,send});
 const payload={description:'Teste',amountCents:500,requestId:'expense-pending-001'};
 await assert.rejects(q.execute({ownerId:3,path:'/api/expenses',method:'POST',body:payload}));
 await assert.rejects(q.execute({ownerId:3,path:'/api/expenses',method:'POST',
   body:{...payload,requestId:'expense-new-002'}}),/aguardando|pendente|confirmação/i);
 assert.equal((await store.list('3')).length,1);
});

test('RED: replay is scoped to original user and does not replay for another account',async()=>{
 const mod=loadQueue(),store=memoryStore();
 const q=mod.createQueue({store,send:async()=>offline()});
 await assert.rejects(q.execute({ownerId:10,path:'/api/customers',method:'POST',
   body:{requestId:'user-a-operation',name:'Cliente A'}}));
 let calls=0;
 const other=mod.createQueue({store,send:async()=>{calls++;return ok()}});
 assert.equal(await other.replay(11),0);
 assert.equal(calls,0);
 assert.equal((await store.list('10')).length,1);
});

test('RED: deterministic HTTP errors clear the pending write, network/5xx keep it',async()=>{
 const mod=loadQueue(),store=memoryStore();
 const conflict=mod.createQueue({store,send:async()=>({ok:false,status:409,text:async()=>'{"error":"Conflito"}'})});
 const response=await conflict.execute({ownerId:2,path:'/api/schedule',method:'POST',
   body:{requestId:'event-duplicate',title:'Visita'}});
 assert.equal(response.status,409);
 assert.equal((await store.list('2')).length,0);
 const failure=mod.createQueue({store,send:async()=>({ok:false,status:503,text:async()=>'{"error":"Temporário"}'})});
 await assert.rejects(failure.execute({ownerId:2,path:'/api/schedule',method:'POST',
   body:{requestId:'event-uncertain',title:'Visita'}}),/aguardando|pendente|confirmação/i);
 assert.equal((await store.list('2')).length,1);
});

test('RED: credentials and large attachment bodies cannot enter IndexedDB',async()=>{
 const mod=loadQueue(),store=memoryStore(),calls=[];
 const q=mod.createQueue({store,send:async cmd=>{calls.push(cmd);return ok()}});
 await q.execute({ownerId:1,path:'/api/users',method:'POST',
   body:{requestId:'create-user',username:'u',password:'not-to-store'}});
 await q.execute({ownerId:1,path:'/api/work-orders/1/attachments',method:'POST',
   body:{requestId:'attachment-1',base64:'x'.repeat(200000)}});
 assert.equal((await store.list('1')).length,0);
 assert.equal(calls.length,2);
 assert.equal(mod.isQueueable('/api/auth/login',{username:'admin',password:'pass'}),false);
 assert.equal(mod.isQueueable('/api/customers',{name:'Cliente A'}),true);
});

test('RED: queued commands announce pending and confirmed transitions to the UI event bus',async()=>{
 const mod=loadQueue(),store=memoryStore(),events=[];
 const bus=mod.createEventBus();
 bus.on('pending',x=>events.push(['pending',x.requestId]));
 bus.on('confirmed',x=>events.push(['confirmed',x.requestId]));
 const q=mod.createQueue({store,bus,send:async()=>offline()});
 await assert.rejects(q.execute({ownerId:1,path:'/api/customers',method:'POST',body:{requestId:'bus-123',name:'A'}}));
 const q2=mod.createQueue({store,bus,send:async()=>ok()});
 await q2.replay(1);
 assert.deepEqual(events.map(x=>x.join(':')),['pending:bus-123','confirmed:bus-123']);
});

test('queue never sends an eligible write if durable storage is unavailable',async()=>{
 const mod=loadQueue();
 let calls=0;
 const q=mod.createQueue({
   store:{async get(){throw new Error('IndexedDB indisponível')},async list(){return []}},
   send:async()=>{calls++;return ok()}
 });
 await assert.rejects(q.execute({ownerId:9,path:'/api/expenses',method:'POST',
   body:{requestId:'no-storage-001',description:'Despesas',amountCents:100}}),/IndexedDB indisponível/);
 assert.equal(calls,0);
});

test('old pending commands require explicit user retry instead of silent delayed financial execution',async()=>{
 const mod=loadQueue(),store=memoryStore();
 const queue=mod.createQueue({store,now:()=>1000,send:async()=>offline()});
 await assert.rejects(queue.execute({ownerId:1,path:'/api/cash/current/movements',method:'POST',
   body:{requestId:'cash-stale-1',type:'SUPRIMENTO',amountCents:1000}}));
 let calls=0;
 const recovered=mod.createQueue({store,now:()=>1000+31*60*1000,send:async()=>{calls++;return ok()}});
 assert.equal(await recovered.replay(1),0);
 assert.equal(calls,0);
 assert.equal((await store.list('1')).length,1);
 assert.equal(await recovered.replay(1,{manual:true}),1);
 assert.equal(calls,1);
});
