import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash} from 'node:crypto';

// PostgreSQL command journaling must share the SAME transaction/connection as
// the business mutation. Inserting the journal after a separate commit could
// duplicate sales, payments or stock in a network-failure replay.
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const identifier=value=>typeof value==='string'&&/^[A-Za-z0-9_:.-]{3,128}$/.test(value);
function stable(value){
 if(Array.isArray(value))return value.map(stable);
 if(value&&typeof value==='object')
  return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));
 return value;
}
export function createPostgresCommandJournal(port){
 if(port?.engine!=='postgres'||typeof port.transaction!=='function')
   throw Error('Journal exige adaptador PostgreSQL com transações reais');
 const context=new AsyncLocalStorage();
 const current=()=>context.getStore()||port;
 const scoped=Object.freeze({
   engine:'postgres',
   all:(sql,params=[])=>current().all(sql,params),
   first:(sql,params=[])=>current().first(sql,params),
   run:(sql,params=[])=>current().run(sql,params),
   async transaction(fn){
     if(typeof fn!=='function')fail('Transação exige callback');
     if(context.getStore())return fn(scoped);
     return port.transaction(tx=>context.run(tx,()=>fn(scoped)));
   },
   batch(statements){
     if(!Array.isArray(statements)||!statements.length)fail('Batch vazio');
     return scoped.transaction(async tx=>{
       const results=[];
       for(const item of statements)results.push(await tx.run(item.sql,item.params??[]));
       return results;
     });
   }
 });
 async function commandStatus(scope,requestId){
   if(typeof scope!=='string'||!scope.startsWith('http:')||!identifier(requestId))
     fail('Consulta de operação inválida');
   const row=await scoped.first(
     'SELECT result_json FROM command_idempotency WHERE scope=? AND request_id=?',
     [scope,requestId]);
   return {status:row?'CONFIRMED':'UNKNOWN',requestId,
     ...(row?{result:JSON.parse(row.result_json)}:{})};
 }
 async function execute({scope,requestId,body,action}={}){
   if(typeof scope!=='string'||!scope.startsWith('http:')||!identifier(requestId)||
      typeof action!=='function')fail('Comando idempotente inválido');
   const payload=stable({body:body??{}});
   const fingerprint=createHash('sha256').update(JSON.stringify(payload)).digest('hex');
   const advisory=createHash('sha256').update(scope+'\0'+requestId)
     .digest().readBigInt64BE(0).toString();
   return scoped.transaction(async tx=>{
     await tx.first('SELECT pg_advisory_xact_lock(?::bigint) AS locked',[advisory]);
     const stored=await tx.first(
       'SELECT payload_hash,result_json FROM command_idempotency WHERE scope=? AND request_id=?',
       [scope,requestId]);
     if(stored){
       if(stored.payload_hash!==fingerprint)
         fail('Identificador já utilizado com dados diferentes',409);
       return {cached:true,body:JSON.parse(stored.result_json)};
     }
     const result=await action();
     if(!(result instanceof Response))
       fail('Comando retornou resposta inválida',502);
     if(!result.ok){
       const serialized=await result.text();
       // Roll back any writes the nested handler may have performed before
       // returning an error. Do not persist unsuccessful replies.
       const error=fail('Comando falhou',result.status);
       error.safeResponse={status:result.status,body:serialized,
         contentType:result.headers.get('content-type')||'application/json'};
       throw error;
     }
     const raw=await result.clone().text();
     if(Buffer.byteLength(raw)>1024*1024)fail('Resposta de comando excede limite',502);
     let data;
     try{data=JSON.parse(raw);}catch{fail('Comando retornou JSON inválido',502);}
     await tx.run(
       'INSERT INTO command_idempotency(scope,request_id,payload_hash,result_json,created_at) VALUES(?,?,?,?,?)',
       [scope,requestId,fingerprint,JSON.stringify(data),new Date().toISOString()]);
     return {cached:false,body:data,status:result.status};
   });
 }
 return Object.freeze({port:scoped,execute,commandStatus});
}
