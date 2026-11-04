import {createHash,randomBytes} from 'node:crypto';

// Native PostgreSQL quote approval. Tokens are random 256-bit secrets; only a
// SHA256 digest is stored. Public reads/writes still pass through the trusted
// gateway that selects the proper tenant by registry identity.
const fail=(message,status=409)=>{throw Object.assign(new Error(message),{status});};
const now=()=>new Date().toISOString();
const sha=value=>createHash('sha256').update(value).digest('hex');
const ident=value=>{
 const n=Number(value);
 if(!Number.isSafeInteger(n)||n<1)fail('Identificador inválido',400);
 return n;
};
function hashQuote(quote){
 return sha(JSON.stringify([
  Number(quote.id),Number(quote.work_order_id),Number(quote.total_cents),
  quote.updated_at,
  quote.items.map(x=>[Number(x.id),x.kind,x.description,Number(x.quantity),
    Number(x.unit_price_cents),Number(x.total_cents)])
 ]));
}
const tokenHash=token=>{
 if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))
   fail('Link de aprovação inválido',404);
 return sha(token);
};
async function loadQuote(tx,workOrderId){
 const quote=await tx.first('SELECT * FROM quotes WHERE work_order_id=?',[workOrderId]);
 if(!quote)fail('Orçamento não encontrado',404);
 return {...quote,items:await tx.all('SELECT * FROM quote_items WHERE quote_id=? ORDER BY id',[quote.id])};
}
async function loadLink(tx,token,forUpdate=false){
 const link=await tx.first('SELECT * FROM quote_approval_links WHERE token_hash=?'+
  (forUpdate?' FOR UPDATE':''),[tokenHash(token)]);
 if(!link)fail('Link de aprovação não encontrado',404);
 return link;
}
function quoteStillValid(quote,link){
 if(quote.approval_status!=='AGUARDANDO'||hashQuote(quote)!==link.quote_digest)
   fail('Orçamento alterado: solicite novo link');
 if(quote.valid_until&&quote.valid_until<now().slice(0,10))
   fail('Orçamento vencido');
}
export function createPostgresQuoteApprovals(port){
 if(port?.engine!=='postgres'||typeof port.transaction!=='function')
   throw Error('Aprovação pública nativa exige PostgreSQL transacional');
 async function createApprovalLink(workOrderId,{expiresInHours=48}={}){
   const id=ident(workOrderId),hours=Number(expiresInHours);
   if(!Number.isInteger(hours)||hours<1||hours>168)
     fail('Prazo de aprovação inválido',400);
   return port.transaction(async tx=>{
     const os=await tx.first('SELECT id,status FROM work_orders WHERE id=? FOR UPDATE',[id]);
     if(!os)fail('OS não encontrada',404);
     if(os.status!=='AGUARDANDO_APROVACAO')fail('OS não aguarda aprovação');
     const quote=await loadQuote(tx,id);
     if(quote.approval_status!=='AGUARDANDO'||quote.valid_until&&quote.valid_until<now().slice(0,10))
       fail('Orçamento não aguarda aprovação ou está vencido');
     const token=randomBytes(32).toString('hex');
     const expiresAt=new Date(Date.now()+hours*3600000).toISOString();
     await tx.run("UPDATE quote_approval_links SET status='REVOGADO' WHERE work_order_id=? AND status='ATIVO'",[id]);
     await tx.run(
       'INSERT INTO quote_approval_links(work_order_id,token_hash,quote_digest,expires_at,created_at) VALUES(?,?,?,?,?)',
       [id,sha(token),hashQuote(quote),expiresAt,now()]);
     return {token,expiresAt,path:'/approval.html?token='+token};
   });
 }
 async function getApprovalProposal(token){
   const link=await loadLink(port,token);
   if(link.status==='REVOGADO')fail('Link de aprovação revogado');
   if(link.status==='ATIVO'&&link.expires_at<=now())fail('Link de aprovação expirado');
   const quote=await loadQuote(port,link.work_order_id);
   if(link.status==='ATIVO')quoteStillValid(quote,link);
   const os=await port.first('SELECT os_number FROM work_orders WHERE id=?',[link.work_order_id]);
   return {
     status:link.status,totalCents:Number(quote.total_cents),
     validUntil:quote.valid_until,expiresAt:link.expires_at,
     items:quote.items.map(x=>({kind:x.kind,description:x.description,
       quantity:Number(x.quantity),totalCents:Number(x.total_cents)})),
     workOrderNumber:Number(os.os_number)
   };
 }
 async function resolveApproval(token,{decision,reason}={}){
   const action=String(decision??'').trim().toUpperCase(),
     why=String(reason??'').trim();
   if(!['APROVAR','REJEITAR'].includes(action))fail('Decisão inválida',400);
   if(action==='REJEITAR'&&(!why||why.length>500))
     fail('Informe o motivo da reprovação',400);
   const target=action==='APROVAR'?'APROVADO':'REJEITADO';
   return port.transaction(async tx=>{
     const link=await loadLink(tx,token,true);
     if(link.status===target)return {status:target,workOrderId:Number(link.work_order_id)};
     if(link.status!=='ATIVO')fail('Link já utilizado ou revogado');
     if(link.expires_at<=now())fail('Link de aprovação expirado');
     const os=await tx.first('SELECT * FROM work_orders WHERE id=? FOR UPDATE',[link.work_order_id]);
     if(!os||os.status!=='AGUARDANDO_APROVACAO')fail('OS não aguarda aprovação');
     const quote=await loadQuote(tx,link.work_order_id);
     quoteStillValid(quote,link);
     const at=now();
     const state=action==='APROVAR'?'APROVADA':'REPROVADA';
     const updated=await tx.run(
       'UPDATE work_orders SET status=?,quote_total_cents=?,version=version+1,updated_at=? WHERE id=? AND status=?',
       [state,action==='APROVAR'?Number(quote.total_cents):Number(os.quote_total_cents),
        at,os.id,'AGUARDANDO_APROVACAO']);
     if(Number(updated.changes)!==1)fail('Conflito de versão da OS');
     if(action==='APROVAR')
       await tx.run("UPDATE quotes SET approval_status='APROVADO',approved_at=?,updated_at=? WHERE id=? AND approval_status='AGUARDANDO'",[at,at,quote.id]);
     else
       await tx.run("UPDATE quotes SET approval_status='REPROVADO',rejection_reason=?,rejected_at=?,updated_at=? WHERE id=? AND approval_status='AGUARDANDO'",[why,at,at,quote.id]);
     await tx.run('INSERT INTO work_order_status_history(work_order_id,from_status,to_status,reason,changed_at) VALUES(?,?,?,?,?)',
       [os.id,os.status,state,action==='APROVAR'?'Orçamento aprovado por link':why,at]);
     await tx.run("UPDATE quote_approval_links SET status=?,responded_at=? WHERE id=? AND status='ATIVO'",
       [target,at,link.id]);
     return {status:target,workOrderId:Number(os.id)};
   });
 }
 return Object.freeze({createApprovalLink,getApprovalProposal,resolveApproval});
}
