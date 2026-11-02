import {createHash} from 'node:crypto';
import {transaction,nowIso} from '../db.js';

const normalizeId=id=>{
  if(id==null||id==='')return null;
  const value=String(id).trim();
  if(value.length<3||value.length>128||!/^[\w:.-]+$/.test(value))
    throw new Error('Identificador da operação inválido (3 a 128 caracteres)');
  return value;
};
function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(value && typeof value==='object')
    return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));
  return value;
}
export function commandFingerprint(payload){
 return createHash('sha256').update(JSON.stringify(stable(payload))).digest('hex');
}
// A chave é obrigatória no frontend; chamadas antigas da API continuam válidas
// sem requestId, mas sem a garantia de replay. Nunca gera chave nova em retry.
export function runIdempotent(db,scope,requestId,payload,action){
 const id=normalizeId(requestId);
 if(!id)return transaction(db,action);
 if(!scope||typeof scope!=='string')throw new Error('Escopo da operação inválido');
 const hash=commandFingerprint(payload);
 return transaction(db,()=>{
   const existing=db.prepare('SELECT payload_hash,result_json FROM command_idempotency WHERE scope=? AND request_id=?').get(scope,id);
   if(existing){
     if(existing.payload_hash!==hash)throw new Error('Identificador já usado com dados diferentes');
     return JSON.parse(existing.result_json);
   }
   const result=action();
   db.prepare('INSERT INTO command_idempotency(scope,request_id,payload_hash,result_json,created_at) VALUES(?,?,?,?,?)')
     .run(scope,id,hash,JSON.stringify(result),nowIso());
   return result;
 });
}
