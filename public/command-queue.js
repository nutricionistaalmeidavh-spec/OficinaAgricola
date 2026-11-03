// Command Queue local: write-ahead IndexedDB + requestId canônico do backend.
// Dependências: APIs nativas do navegador; nenhuma hospedagem/serviço externo.
(function(root){
 'use strict';
 const MAX_BYTES=128*1024,MAX_PENDING=80,DB_NAME='artisys-oficina-commands-v1';
 const privateKey=/^(?:password|confirmPassword|secret|token|accessToken|refreshToken|base64|file|attachment|apiKey)$/i;
 const forbiddenPath=/^\/api\/(?:auth(?:\/|$)|setup(?:\/|$)|users(?:\/|$))|\/attachments(?:\/|$)|\/documents(?:\/|$)/i;
 function stringify(value){return JSON.stringify(value);}
 function hasPrivateValue(value){
   if(!value||typeof value!=='object')return false;
   if(Array.isArray(value))return value.some(hasPrivateValue);
   return Object.keys(value).some(k=>privateKey.test(k)||hasPrivateValue(value[k]));
 }
 function isQueueable(path,body){
   if(typeof path!=='string'||!path.startsWith('/api/')||forbiddenPath.test(path))return false;
   if(!body||typeof body!=='object'||Array.isArray(body)||hasPrivateValue(body))return false;
   try{return stringify(body).length<=MAX_BYTES}catch{return false}
 }
 function createEventBus(){
   const listeners=new Map();
   return {
     on(type,handler){
       if(typeof handler!=='function')throw new TypeError('Handler inválido');
       const values=listeners.get(type)||new Set();values.add(handler);listeners.set(type,values);
       return ()=>values.delete(handler);
     },
     emit(type,data){
       for(const callback of [...(listeners.get(type)||[])])
         try{callback(data)}catch(error){console.error('[commands]',error)}
     }
   };
 }
 function pendingError(){
   const error=new Error('Operação aguardando confirmação. Ela está salva neste dispositivo; tente novamente pelo aviso de operações pendentes.');
   error.code='PENDING_CONFIRMATION';
   error.pending=true;
   return error;
 }
 function openIndexedDB({indexedDB=root.indexedDB,dbName=DB_NAME}={}){
   let promise=null;
   function db(){
     if(!promise)promise=new Promise((resolve,reject)=>{
       if(!indexedDB){reject(new Error('Armazenamento local indisponível. Nenhuma operação foi enviada.'));return}
       const request=indexedDB.open(dbName,1);
       request.onupgradeneeded=()=>{
         const database=request.result;
         const store=database.createObjectStore('commands',{keyPath:'id'});
         store.createIndex('ownerId','ownerId',{unique:false});
       };
       request.onsuccess=()=>resolve(request.result);
       request.onerror=()=>reject(request.error||new Error('Erro ao abrir armazenamento local'));
       request.onblocked=()=>reject(new Error('Armazenamento local bloqueado por outra aba'));
     }).catch(error=>{promise=null;throw error});
     return promise;
   }
   async function operation(mode,makeRequest){
     const database=await db();
     return new Promise((resolve,reject)=>{
       const transaction=database.transaction('commands',mode);
       let result=null;
       const req=makeRequest(transaction.objectStore('commands'));
       req.onsuccess=()=>{result=req.result};
       transaction.oncomplete=()=>resolve(result);
       transaction.onerror=()=>reject(transaction.error||req.error||new Error('Erro no armazenamento local'));
       transaction.onabort=()=>reject(transaction.error||new Error('Armazenamento local interrompido'));
     });
   }
   return {
     get:id=>operation('readonly',store=>store.get(id)),
     put:record=>operation('readwrite',store=>store.put(record)),
     delete:id=>operation('readwrite',store=>store.delete(id)),
     list:ownerId=>operation('readonly',store=>store.index('ownerId').getAll(String(ownerId)))
   };
 }
 function createQueue({store=openIndexedDB(),send,bus=createEventBus(),now=()=>Date.now(),
   createId=()=>root.crypto?.randomUUID?.()||('op-'+Date.now()+'-'+Math.random().toString(36).slice(2))}={}){
   if(typeof send!=='function')throw new Error('Transportador de comandos obrigatório');
   const inFlight=new Map();
   let replaying=null;
   const notify=(type,record,extra={})=>bus.emit(type,{
     requestId:record.body.requestId,ownerId:record.ownerId,
     method:record.method,path:record.path,...extra
   });
   const fingerprint=(method,path,body)=>method+' '+path+' '+stringify(
     Object.fromEntries(Object.entries(body).filter(([key])=>key!=='requestId').sort(([a],[b])=>a.localeCompare(b)))
   );
   async function attempt(record){
     if(inFlight.has(record.id))return inFlight.get(record.id);
     const task=(async()=>{
       let response;
       try{response=await send({method:record.method,path:record.path,body:record.body,ownerId:record.ownerId})}
       catch(error){
         await store.put({...record,status:'pending',lastAttemptAt:now(),lastError:'Sem conexão'});
         notify('pending',record);
         throw pendingError();
       }
       if(response?.ok){
         await store.delete(record.id);
         notify('confirmed',record);
         return response;
       }
       if(response?.status===401||response?.status===403){
         await store.put({...record,status:'auth',lastAttemptAt:now(),lastError:'Acesso necessário'});
         notify('pending',record);
         return response;
       }
       if(!response||response.status===408||response.status===429||response.status>=500){
         await store.put({...record,status:'pending',lastAttemptAt:now(),lastError:'Sem confirmação do servidor'});
         notify('pending',record);
         throw pendingError();
       }
       // Erro de validação (4xx): servidor recusou a mutação; não repetir.
       await store.delete(record.id);
       notify('rejected',record,{status:response.status});
       return response;
     })().finally(()=>inFlight.delete(record.id));
     inFlight.set(record.id,task);
     return task;
   }
   async function execute({ownerId,path,method='POST',body={}}){
     const verb=String(method).toUpperCase();
     if(!isQueueable(path,body))return send({ownerId,path,method:verb,body});
     if(ownerId===null||ownerId===undefined||ownerId==='')throw new Error('Sessão necessária para salvar operação');
     const user=String(ownerId);
     const requestId=String(body.requestId||createId());
     const payload=JSON.parse(stringify({...body,requestId}));
     const id=user+':'+verb+':'+path+':'+requestId;
     const hash=fingerprint(verb,path,payload);
     const existing=await store.get(id);
     if(existing&&fingerprint(existing.method,existing.path,existing.body)!==hash)
       throw new Error('Identificador de operação usado com dados diferentes');
     if(!existing){
       const pending=await store.list(user);
       if(pending.length>=MAX_PENDING)throw new Error('Limite de operações pendentes atingido. Confirme as operações anteriores.');
       if(pending.some(r=>fingerprint(r.method,r.path,r.body)===hash))
         throw pendingError();
     }
     const record=existing||{id,ownerId:user,method:verb,path,body:payload,
       createdAt:now(),status:'sending'};
     // Persistência ANTES de chamar HTTP: em caso de queda nada é perdido.
     await store.put(record);
     return attempt(record);
   }
   async function replay(ownerId,{manual=false,maxAutoAgeMs=30*60*1000}={}){
     if(ownerId===null||ownerId===undefined)return 0;
     if(replaying)return replaying;
     replaying=(async()=>{
       let count=0;
       const entries=(await store.list(String(ownerId))).sort((a,b)=>a.createdAt-b.createdAt);
       for(const record of entries){
         if(!manual&&now()-record.createdAt>maxAutoAgeMs)continue;
         if(record.status==='auth'&&!manual)continue;
         try{
           const response=await attempt(record);
           if(response?.ok)count++;
           else if(response?.status===401||response?.status===403)break;
         }catch(error){
           if(error?.pending)break;
           throw error;
         }
       }
       return count;
     })().finally(()=>{replaying=null});
     return replaying;
   }
   return {execute,replay,list:ownerId=>store.list(String(ownerId)),bus};
 }
 root.OficinaCommands={createQueue,createEventBus,openIndexedDB,isQueueable};
})(window);
