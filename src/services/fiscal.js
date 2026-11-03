import {createHash,randomUUID} from 'node:crypto';
import {nowIso,transaction} from '../db.js';
export {migrateFiscal} from '../fiscal-schema.js';

const TYPES=new Set(['NFE','NFSE']);
const SOURCES=new Set(['OS','SALE']);
const sha=value=>createHash('sha256').update(value).digest('hex');
const text=value=>String(value??'').trim();
const positive=value=>Number.isSafeInteger(Number(value))&&Number(value)>0?Number(value):null;

export function getFiscalDocument(db,id){
  const row=db.prepare('SELECT * FROM fiscal_documents WHERE id=?').get(id);
  if(!row)throw new Error('Documento fiscal não encontrado');
  return row;
}
export function listFiscalDocuments(db,{status='',limit=100}={}){
  const max=Math.min(1000,Math.max(1,Number(limit)||100));
  if(status&&!['RASCUNHO','INDETERMINADO','REJEITADA','AUTORIZADA','CANCELADA'].includes(status))
    throw new Error('Estado fiscal inválido');
  return db.prepare('SELECT * FROM fiscal_documents WHERE (?=\'\' OR status=?) ORDER BY id DESC LIMIT ?').all(status,status,max);
}
export function listFiscalEvents(db,id){
  getFiscalDocument(db,id);
  return db.prepare('SELECT * FROM fiscal_events WHERE document_id=? ORDER BY id').all(id);
}

// Distribuição determinística de desconto: centavos fecham exatamente com a operação.
// Não grava estoque, caixa ou contas a receber.
function netLines(items,discountCents,totalCents){
  const gross=items.reduce((sum,i)=>sum+Number(i.total_cents),0);
  const discount=Number(discountCents||0);
  if(!Number.isSafeInteger(gross)||gross<=0||!Number.isSafeInteger(discount)||discount<0||discount>gross||gross-discount!==Number(totalCents))
    throw new Error('Totais da origem não conciliam');
  const shares=items.map((item,index)=>{
    const raw=Number(item.total_cents)*discount/gross;
    return {index,discount:Math.floor(raw),fraction:raw-Math.floor(raw)};
  });
  let remaining=discount-shares.reduce((sum,row)=>sum+row.discount,0);
  const order=[...shares].sort((a,b)=>b.fraction-a.fraction||a.index-b.index);
  for(let i=0;i<remaining;i++)order[i%order.length].discount++;
  return items.map((item,i)=>({
    sourceItemId:item.id,kind:item.kind,description:item.description,
    quantity:Number(item.quantity),unitPriceCents:Number(item.unit_price_cents),
    subtotalCents:Number(item.total_cents),discountCents:shares[i].discount,
    totalCents:Number(item.total_cents)-shares[i].discount
  }));
}
function originSnapshot(db,originType,originId){
  const company=db.prepare('SELECT * FROM company_settings WHERE id=1').get();
  if(originType==='OS'){
    const os=db.prepare('SELECT * FROM work_orders WHERE id=?').get(originId);
    if(!os)throw new Error('Ordem de serviço não encontrada');
    const quote=db.prepare("SELECT * FROM quotes WHERE work_order_id=? AND approval_status='APROVADO'").get(originId);
    if(!quote||os.quote_total_cents!==quote.total_cents)throw new Error('Orçamento da OS não aprovado ou divergente');
    const items=db.prepare('SELECT * FROM quote_items WHERE quote_id=? ORDER BY id').all(quote.id);
    if(items.some(i=>i.kind==='TERCEIRO'))throw new Error('Serviço de terceiro exige classificação tributária e emissão própria');
    return {company,customer:JSON.parse(os.snapshot_customer),machine:JSON.parse(os.snapshot_machine),
      originType,originId,originNumber:os.os_number,approvedAt:quote.approved_at,
      lines:netLines(items,quote.discount_cents,quote.total_cents)};
  }
  const sale=db.prepare("SELECT * FROM sales WHERE id=? AND status='CONCLUIDA'").get(originId);
  if(!sale)throw new Error('Venda concluída não encontrada');
  const items=db.prepare('SELECT * FROM sale_items WHERE sale_id=? ORDER BY id').all(originId);
  if(items.some(i=>i.kind==='OUTRO'))throw new Error('Item não classificado exige revisão tributária');
  const customer=sale.customer_id?db.prepare('SELECT * FROM customers WHERE id=?').get(sale.customer_id):null;
  return {company,customer,originType,originId,originNumber:sale.sale_number,approvedAt:sale.created_at,
    lines:netLines(items,sale.discount_cents,sale.total_cents)};
}

export function createFiscalDraft(db,input){
  const originType=text(input?.originType).toUpperCase();
  const kind=text(input?.kind).toUpperCase();
  const originId=positive(input?.originId);
  const requestId=text(input?.requestId);
  if(!SOURCES.has(originType)||!TYPES.has(kind)||!originId)throw new Error('Origem ou tipo fiscal inválido');
  if(!requestId||requestId.length>128)throw new Error('Identificador idempotente fiscal obrigatório');
  return transaction(db,()=>{
    const keyed=db.prepare('SELECT * FROM fiscal_documents WHERE request_id=?').get(requestId);
    if(keyed){
      if(keyed.origin_type!==originType||keyed.origin_id!==originId||keyed.kind!==kind)
        throw new Error('Identificador fiscal já utilizado para outra operação');
      return keyed;
    }
    const previous=db.prepare('SELECT * FROM fiscal_documents WHERE origin_type=? AND origin_id=? AND kind=?').get(originType,originId,kind);
    if(previous)return previous; // Uma emissão por espécie e operação, inclusive após perda de resposta.
    const origin=originSnapshot(db,originType,originId);
    const selected=origin.lines.filter(line=>kind==='NFE'?line.kind==='PECA':line.kind==='MAO_DE_OBRA');
    if(!selected.length)throw new Error('Nenhum item compatível com o documento solicitado');
    const amount=selected.reduce((sum,item)=>sum+item.totalCents,0);
    if(!positive(amount))throw new Error('Valor fiscal líquido deve ser positivo');
    const snapshot=JSON.stringify({...origin,kind,lines:selected});
    const hash=sha(snapshot),now=nowIso();
    const inserted=db.prepare("INSERT INTO fiscal_documents (kind,origin_type,origin_id,status,amount_cents,snapshot_json,snapshot_hash,request_id,created_at,updated_at) VALUES (?,?,?,'RASCUNHO',?,?,?,?,?,?)")
      .run(kind,originType,originId,amount,snapshot,hash,requestId,now,now);
    const id=Number(inserted.lastInsertRowid);
    db.prepare("INSERT INTO fiscal_events(document_id,event_type,details_json,created_at) VALUES(?,'CRIADO',?,?)").run(id,JSON.stringify({snapshotHash:hash}),now);
    return getFiscalDocument(db,id);
  });
}
function addEvent(db,id,eventType,details={}){
  db.prepare('INSERT INTO fiscal_events(document_id,event_type,details_json,created_at) VALUES(?,?,?,?)')
    .run(id,eventType,JSON.stringify(details),nowIso());
}
function applyProviderResult(db,id,result,providerName){
  const status=text(result?.status).toUpperCase();
  if(status==='AUTORIZADA'){
    const key=text(result.accessKey),protocol=text(result.protocol),xml=text(result.xml);
    if(!key||!protocol||!xml.startsWith('<'))throw new Error('Retorno autorizado incompleto; consultar o fisco antes de repetir');
    const now=nowIso();
    db.prepare("UPDATE fiscal_documents SET status='AUTORIZADA',access_key=?,protocol=?,authorized_xml=?,response_json=?,last_error='',authorized_at=?,updated_at=? WHERE id=?")
      .run(key,protocol,xml,JSON.stringify({status,provider:providerName}),now,now,id);
    addEvent(db,id,'AUTORIZADA',{protocol,accessKey:key,provider:providerName});
  }else if(status==='REJEITADA'){
    const message=text(result.message).slice(0,500);
    db.prepare("UPDATE fiscal_documents SET status='REJEITADA',response_json=?,last_error=?,updated_at=? WHERE id=?")
      .run(JSON.stringify({status,code:text(result.code).slice(0,60),message}),message,nowIso(),id);
    addEvent(db,id,'REJEITADA',{code:text(result.code).slice(0,60),message});
  }else{
    const msg='Resposta fiscal inconclusiva; consultar situação antes de reenviar';
    db.prepare('UPDATE fiscal_documents SET last_error=?,updated_at=? WHERE id=?').run(msg,nowIso(),id);
    addEvent(db,id,'INDETERMINADO',{message:msg});
  }
}
function markUncertain(db,id,error){
  const message=text(error?.message||error).slice(0,500);
  transaction(db,()=>{
    db.prepare('UPDATE fiscal_documents SET last_error=?,updated_at=? WHERE id=?').run(message,nowIso(),id);
    addEvent(db,id,'FALHA_INDETERMINADA',{message});
  });
}
export async function submitFiscalDocument(db,id,{provider}={}){
  const doc=getFiscalDocument(db,id);
  if(doc.status==='INDETERMINADO')throw new Error('Documento fiscal indeterminado: consulte e concilie antes de nova tentativa');
  if(doc.status!=='RASCUNHO')throw new Error('Documento fiscal não permite nova transmissão');
  if(!provider||typeof provider.transmit!=='function')throw new Error('Emissor fiscal não configurado: nenhuma nota foi enviada');
  const attemptId=randomUUID(),providerName=text(provider.name||'local');
  transaction(db,()=>{
    const change=db.prepare("UPDATE fiscal_documents SET status='INDETERMINADO',provider_name=?,attempt_id=?,updated_at=? WHERE id=? AND status='RASCUNHO'")
      .run(providerName,attemptId,nowIso(),id);
    if(change.changes!==1)throw new Error('Documento fiscal já está em processamento');
    addEvent(db,id,'TRANSMISSAO_INICIADA',{attemptId,provider:providerName});
  });
  try{
    const result=await provider.transmit({document:getFiscalDocument(db,id),attemptId});
    transaction(db,()=>applyProviderResult(db,id,result,providerName));
  }catch(error){
    markUncertain(db,id,error);
    throw error;
  }
  return getFiscalDocument(db,id);
}
export async function reconcileFiscalDocument(db,id,{provider}={}){
  const doc=getFiscalDocument(db,id);
  if(doc.status!=='INDETERMINADO')throw new Error('Somente documentos indeterminados podem ser consultados');
  if(!provider||typeof provider.consult!=='function')throw new Error('Consulta fiscal do emissor não configurada');
  let result;
  try{ result=await provider.consult({document:doc,attemptId:doc.attempt_id}); }
  catch(error){markUncertain(db,id,error);throw error}
  transaction(db,()=>applyProviderResult(db,id,result,text(provider.name||'local')));
  return getFiscalDocument(db,id);
}
