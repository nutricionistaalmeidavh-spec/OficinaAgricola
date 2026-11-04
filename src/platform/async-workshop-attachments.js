import {createHash,randomUUID,randomBytes} from 'node:crypto';

const clean=value=>String(value??'').trim();
const hash=value=>createHash('sha256').update(value).digest('hex');
const newId=()=>randomBytes(6).readUIntBE(0,6);
const positive=value=>{
 const n=Number(value);
 if(!Number.isSafeInteger(n)||n<1)throw Error('Identificador inválido');
 return n;
};
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const now=()=>new Date().toISOString();
const mimeToExt=new Map([
 ['image/jpeg','.jpg'],['image/png','.png'],['image/webp','.webp'],
 ['application/pdf','.pdf']
]);
const categories=new Set(['ENTRADA','DIAGNOSTICO','SERVICO','ENTREGA','OUTRO']);
const maxSize=5*1024*1024;
function decode(input){
 if(!categories.has(input?.category))fail('Categoria de anexo inválida');
 const ext=mimeToExt.get(input?.mimeType);
 if(!ext)fail('Tipo de arquivo não permitido');
 const data=String(input?.base64||'');
 if(!data||data.length>Math.ceil(maxSize/3)*4)
   fail('Arquivo excede o limite permitido');
 if(data.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(data))
   fail('Anexo base64 inválido');
 const raw=Buffer.from(data,'base64');
 if(!raw.length||raw.length>maxSize)fail('Arquivo vazio ou acima do limite');
 if(raw.toString('base64')!==data)fail('Anexo base64 inválido');
 return {raw,ext};
}
const sqlRequestTable=`CREATE TABLE IF NOT EXISTS tenant_remote_upload_requests(
 work_order_id INTEGER NOT NULL REFERENCES work_orders(id),
 request_id TEXT NOT NULL,
 payload_hash TEXT NOT NULL,
 attachment_id INTEGER NOT NULL REFERENCES attachments(id),
 PRIMARY KEY(work_order_id,request_id)
)`;
export function createAsyncWorkshopAttachments(port,{objectStore=null}={}){
 if(!['sqlite','postgres','d1'].includes(port?.engine))
   fail('Adaptador SQL inválido');
 const store=()=>{
   if(!objectStore||typeof objectStore.putObject!=='function'||
     typeof objectStore.getObject!=='function'||
     typeof objectStore.deleteObject!=='function')
     fail('Armazenamento remoto não configurado',503);
   return objectStore;
 };
 let migrated=false;
 async function ensureRequestTable(){
   if(migrated)return;
   // The local SQLite database has this table only after the first
   // legacy remote upload; native PG/D1 migration creates it in advance.
   if(port.engine==='sqlite')await port.run(sqlRequestTable);
   migrated=true;
 }
 async function getAttachment(attachmentId){
   const row=await port.first('SELECT * FROM attachments WHERE id=?',[positive(attachmentId)]);
   if(!row)fail('Anexo não encontrado',404);
   return row;
 }
 async function listAttachments(workOrderId){
   const os=positive(workOrderId);
   if(!await port.first('SELECT id FROM work_orders WHERE id=?',[os]))
     fail('OS não encontrada',404);
   return port.all('SELECT * FROM attachments WHERE work_order_id=? ORDER BY id DESC',[os]);
 }
 async function saveAttachment(workOrderId,input={}){
   const backend=store();
   const os=positive(workOrderId);
   if(!await port.first('SELECT id FROM work_orders WHERE id=?',[os]))
     fail('OS não encontrada',404);
   const {raw,ext}=decode(input);
   const caption=clean(input.caption).slice(0,500),
     name=clean(input.originalName).slice(0,255)||('anexo'+ext),
     request=clean(input.requestId);
   if(request&&!/^[\w:.-]{3,128}$/.test(request))
     fail('Identificador da operação inválido');
   await ensureRequestTable();
   const fingerprint=hash(JSON.stringify({
     category:input.category,mimeType:input.mimeType,caption,originalName:name,
     bytes:raw.length,sha256:hash(raw)
   }));
   async function previous(){
     if(!request)return null;
     const row=await port.first(`SELECT attachment_id,payload_hash
       FROM tenant_remote_upload_requests WHERE work_order_id=? AND request_id=?`,[os,request]);
     if(!row)return null;
     if(row.payload_hash!==fingerprint)
       fail('Identificador já utilizado com dados diferentes',409);
     return getAttachment(row.attachment_id);
   }
   const replay=await previous();
   if(replay)return replay;
   const objectKey=os+'/'+randomUUID()+ext,attachmentId=newId(),stamp=now();
   const insert={sql:`INSERT INTO attachments(
     id,work_order_id,category,caption,mime_type,original_name,
     relative_path,size_bytes,created_at
   ) VALUES(?,?,?,?,?,?,?,?,?)`,params:[
     attachmentId,os,input.category,caption,input.mimeType,name,
     's3:'+objectKey,raw.length,stamp
   ]};
   const requestInsert=request?{sql:`INSERT INTO tenant_remote_upload_requests(
     work_order_id,request_id,payload_hash,attachment_id
   ) VALUES(?,?,?,?)`,params:[os,request,fingerprint,attachmentId]}:null;
   const event={sql:`INSERT INTO domain_outbox(
     event_key,event_id,event_type,payload_json,meta_json,created_at
   ) VALUES(?,?,'ANEXO_CRIADO',?,?,?)`,params:[
     'ANEXO_CRIADO:'+attachmentId,randomUUID(),
     JSON.stringify({workOrderId:os,attachmentId}),
     JSON.stringify({source:'async-workshop'}),stamp
   ]};
   let committed=false;
   try{
     await backend.putObject({key:objectKey,data:raw,mimeType:input.mimeType});
     const queries=[insert,...(requestInsert?[requestInsert]:[]),event];
     if(port.engine==='d1')await port.batch(queries);
     else await port.transaction(async tx=>{
       for(const q of queries)await tx.run(q.sql,q.params);
     });
     committed=true;
     return getAttachment(attachmentId);
   }catch(error){
     // A completed PUT followed by failed metadata insertion/HEAD must not
     // leave an orphan object; also handles idempotency races safely.
     if(!committed){
       try{await backend.deleteObject({key:objectKey});}
       catch{console.error('[native-attachment] S3 object cleanup failed');}
     }
     const restored=await previous();
     if(restored)return restored;
     throw error;
   }
 }
 async function readAttachment(attachmentId){
   const backend=store(),row=await getAttachment(attachmentId);
   if(!row.relative_path?.startsWith('s3:'))
     fail('Anexo legado em disco: migração explícita necessária',409);
   const path=row.relative_path.slice(3);
   if(!new RegExp('^'+row.work_order_id+'/[0-9a-f-]{36}\\.(jpg|png|webp|pdf)$').test(path))
     fail('Chave de armazenamento inválida',409);
   const bytes=Buffer.from(await backend.getObject({key:path,maxBytes:maxSize}));
   if(bytes.length!==Number(row.size_bytes))
     fail('Tamanho de anexo remoto não confere',409);
   return bytes;
 }
 return Object.freeze({saveAttachment,getAttachment,listAttachments,readAttachment});
}
