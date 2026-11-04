import {createHash,randomUUID} from 'node:crypto';
import {nowIso,transaction} from '../db.js';
import {getWorkOrder} from '../services/work-orders.js';

const categories=new Set(['ENTRADA','DIAGNOSTICO','SERVICO','ENTREGA','OUTRO']);
const extensions=new Map([['image/jpeg','.jpg'],['image/png','.png'],['image/webp','.webp'],['application/pdf','.pdf']]);
const fail=message=>{throw new Error(message);};
const sha=value=>createHash('sha256').update(value).digest('hex');
function migrateRemoteUploadIndex(db){
  db.exec(`CREATE TABLE IF NOT EXISTS tenant_remote_upload_requests (
    work_order_id INTEGER NOT NULL REFERENCES work_orders(id),
    request_id TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    attachment_id INTEGER NOT NULL REFERENCES attachments(id),
    PRIMARY KEY(work_order_id,request_id)
  )`);
}
function decodeAttachment(input){
  if(!categories.has(input?.category))fail('Categoria de anexo inválida');
  const ext=extensions.get(input?.mimeType);
  if(!ext)fail('Tipo de arquivo não permitido');
  const base64=String(input?.base64||'');
  // Reject silent Buffer.from(base64) truncation on invalid text.
  if(!base64||base64.length>Math.ceil(5*1024*1024/3)*4+8||
     !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64))
    fail('Anexo vazio, inválido ou excede limite');
  const raw=Buffer.from(base64,'base64');
  if(!raw.length)fail('Arquivo vazio');
  if(raw.length>5*1024*1024)fail('Arquivo excede o limite permitido');
  return {raw,ext};
}
export async function saveRemoteAttachment(db,workOrderId,input,{objectStore}={}){
  if(!objectStore||typeof objectStore.putObject!=='function'||typeof objectStore.deleteObject!=='function')
    fail('Armazenamento remoto não configurado');
  const osId=Number(workOrderId);
  if(!Number.isSafeInteger(osId)||osId<1)fail('OS inválida');
  getWorkOrder(db,osId);
  const {raw,ext}=decodeAttachment(input);
  const caption=String(input.caption??'').trim().slice(0,500);
  const originalName=String(input.originalName??'').trim().slice(0,255)||('anexo'+ext);
  const id=String(input.requestId||'').trim();
  if(id&&(!/^[\w:.-]{3,128}$/.test(id)))fail('Identificador da operação inválido');
  migrateRemoteUploadIndex(db);
  const fingerprint=sha(JSON.stringify({
    category:input.category,mimeType:input.mimeType,originalName,caption,
    bytes:raw.length,sha256:sha(raw)
  }));
  if(id){
    const existing=db.prepare('SELECT attachment_id,payload_hash FROM tenant_remote_upload_requests WHERE work_order_id=? AND request_id=?').get(osId,id);
    if(existing){
      if(existing.payload_hash!==fingerprint)fail('Identificador já utilizado com dados diferentes');
      return db.prepare('SELECT * FROM attachments WHERE id=?').get(existing.attachment_id);
    }
  }
  const key=osId+'/'+randomUUID()+ext;
  await objectStore.putObject({key,data:raw,mimeType:input.mimeType});
  try{
    return transaction(db,()=>{
      // Final re-check in same transaction for replay/concurrency.
      if(id){
        const existing=db.prepare('SELECT attachment_id,payload_hash FROM tenant_remote_upload_requests WHERE work_order_id=? AND request_id=?').get(osId,id);
        if(existing){
          if(existing.payload_hash!==fingerprint)fail('Identificador já utilizado com dados diferentes');
          return db.prepare('SELECT * FROM attachments WHERE id=?').get(existing.attachment_id);
        }
      }
      const inserted=db.prepare(`INSERT INTO attachments(
        work_order_id,category,caption,mime_type,original_name,relative_path,size_bytes,created_at
      ) VALUES(?,?,?,?,?,?,?,?)`).run(
        osId,input.category,caption,input.mimeType,originalName,'s3:'+key,raw.length,nowIso()
      );
      const attachmentId=Number(inserted.lastInsertRowid);
      if(id)db.prepare('INSERT INTO tenant_remote_upload_requests(work_order_id,request_id,payload_hash,attachment_id) VALUES(?,?,?,?)')
        .run(osId,id,fingerprint,attachmentId);
      return db.prepare('SELECT * FROM attachments WHERE id=?').get(attachmentId);
    });
  }catch(error){
    try{await objectStore.deleteObject({key});}
    catch{console.error('[remote-attachment] Falha na remoção do objeto órfão');}
    throw error;
  }
}
export async function readRemoteAttachment(row,objectStore){
  if(!row?.relative_path?.startsWith('s3:'))fail('Anexo não aponta para armazenamento remoto');
  if(!objectStore?.getObject)fail('Armazenamento remoto indisponível');
  const key=row.relative_path.slice(3);
  if(!/^[1-9]\d*\/[0-9a-f-]{36}\.(?:jpg|png|webp|pdf)$/.test(key))
    fail('Chave de anexo inválida');
  const data=await objectStore.getObject({key,maxBytes:5*1024*1024});
  if(data.length!==row.size_bytes)fail('Tamanho do anexo remoto não confere');
  return data;
}
