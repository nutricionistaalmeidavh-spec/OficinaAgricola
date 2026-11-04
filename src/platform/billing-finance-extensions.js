import {createHash,randomBytes} from 'node:crypto';
import {parseBankStatementFile} from './billing-file-import.js';

const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const clean=v=>String(v??'').trim();
const id=()=>randomBytes(16).toString('hex');
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const changes=r=>Number(r?.changes??r?.meta?.changes??0);

export const BILLING_EXTENSIONS_DDL=Object.freeze([
 "CREATE TABLE IF NOT EXISTS billing_reminder_delivery (id TEXT PRIMARY KEY,reminder_id TEXT NOT NULL UNIQUE REFERENCES billing_reminders(id),recipient TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('SENDING','SENT','UNKNOWN')),created_at TEXT NOT NULL,updated_at TEXT NOT NULL)",
 "CREATE TABLE IF NOT EXISTS billing_refunds (id TEXT PRIMARY KEY,installment_id TEXT NOT NULL UNIQUE REFERENCES billing_installments(id),receipt_id BIGINT NOT NULL UNIQUE REFERENCES receipts(id),request_id TEXT NOT NULL UNIQUE,payload_hash TEXT NOT NULL,charge_ref TEXT NOT NULL,refund_ref TEXT,amount_cents BIGINT NOT NULL CHECK(amount_cents>0),status TEXT NOT NULL CHECK(status IN ('ISSUING','PENDING','CONFIRMED','APPLIED','FAILED')),created_at TEXT NOT NULL,updated_at TEXT NOT NULL)",
 "CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_refund_external ON billing_refunds(refund_ref) WHERE refund_ref IS NOT NULL"
]);

export function createBillingFinanceExtensions({port,importStatement,prepareReminders,
 loadInstallment,providers={},reversePayment=null,reminderSender=null}={}){
 if(!port||typeof importStatement!=='function'||typeof prepareReminders!=='function'||
   typeof loadInstallment!=='function')fail('Porta de extensões financeiras inválida');
 async function importStatementFile({format,content,bankAccount}={}){
  const parsed=parseBankStatementFile({format,content,bankAccount});
  let imported=0,repeated=0;
  for(const row of parsed){
   const exists=await port.first(
    'SELECT id FROM billing_bank_entries WHERE bank_account=? AND external_id=?',
    [row.bankAccount,row.externalId]);
   await importStatement(row);
   if(exists)repeated++;else imported++;
  }
  return {format:String(format).toUpperCase(),total:parsed.length,imported,repeated,matched:0};
 }
 async function listReminders({limit=100}={}){
  const n=Number(limit);
  if(!Number.isInteger(n)||n<1||n>200)fail('Limite de lembretes inválido');
  return port.all('SELECT r.*,d.status AS delivery_status,d.recipient FROM billing_reminders r LEFT JOIN billing_reminder_delivery d ON d.reminder_id=r.id ORDER BY r.due_date DESC,r.id DESC LIMIT ?',[n]);
 }
 async function dispatchReminders({asOf,daysAhead=3}={}){
  const prepared=await prepareReminders({asOf,daysAhead});
  if(typeof reminderSender!=='function')return {prepared:prepared.length,sent:0,disabled:true};
  const rows=await port.all("SELECT r.id,r.kind,r.due_date,i.amount_cents,wo.os_number,c.name AS customer_name,c.email AS customer_email FROM billing_reminders r JOIN billing_installments i ON i.id=r.installment_id JOIN billing_plans p ON p.id=i.plan_id JOIN work_orders wo ON wo.id=p.work_order_id JOIN customers c ON c.id=wo.customer_id WHERE r.status='DRAFT' AND i.status='PENDING' AND NOT EXISTS(SELECT 1 FROM billing_reminder_delivery d WHERE d.reminder_id=r.id) ORDER BY r.due_date,r.id LIMIT 50");
  let sent=0,unavailable=0,uncertain=0;
  for(const row of rows){
   const email=clean(row.customer_email);
   if(!/^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(email)||email.length>254){
    unavailable++;continue;
   }
   const at=new Date().toISOString();
   const claim=await port.run("INSERT INTO billing_reminder_delivery(id,reminder_id,recipient,status,created_at,updated_at) SELECT ?,?,?,'SENDING',?,? WHERE EXISTS(SELECT 1 FROM billing_installments i JOIN billing_reminders r ON r.installment_id=i.id WHERE r.id=? AND r.status='DRAFT' AND i.status='PENDING') ON CONFLICT(reminder_id) DO NOTHING",[id(),row.id,email,at,at,row.id]);
   if(changes(claim)!==1)continue;
   const subject='Oficina — lembrete de pagamento da OS '+String(row.os_number);
   const value=(Number(row.amount_cents)/100).toFixed(2).replace('.',',');
   const body='Olá, '+clean(row.customer_name).replace(/[\r\n]/g,' ')+'.\n'+
    'Lembrete de parcela da OS '+row.os_number+'.\n'+
    'Vencimento: '+row.due_date+'. Valor: R$ '+value+'.\n'+
    'Se já realizou o pagamento, desconsidere este lembrete.\n'+
    'Em caso de dúvida, contate a oficina.';
   try{
    await reminderSender({to:email,subject,body,reminderId:row.id});
    await port.run("UPDATE billing_reminder_delivery SET status='SENT',updated_at=? WHERE reminder_id=? AND status='SENDING'",
     [new Date().toISOString(),row.id]);
    sent++;
   }catch{
    // SMTP timeout pode indicar entrega incerta: não reenvia automaticamente.
    await port.run("UPDATE billing_reminder_delivery SET status='UNKNOWN',updated_at=? WHERE reminder_id=? AND status='SENDING'",
     [new Date().toISOString(),row.id]);
    uncertain++;
   }
  }
  return {prepared:prepared.length,sent,unavailable,uncertain,disabled:false};
 }
 async function loadRefund(refundId){
  const row=await port.first('SELECT * FROM billing_refunds WHERE id=?',[clean(refundId)]);
  if(!row)fail('Estorno externo não encontrado',404);
  return row;
 }
 async function requestExternalRefund(installmentId,{requestId}={}){
  const code=clean(requestId);
  if(!/^[A-Za-z0-9_:.-]{3,128}$/.test(code))fail('Identificador de estorno obrigatório');
  const row=await loadInstallment(installmentId);
  if(row.method==='MANUAL'||row.status!=='PAID'||!row.receipt_id||!row.provider_ref)
   fail('Somente cobrança externa liquidada pode ser estornada pelo provedor',409);
  const provider=providers[row.method];
  if(typeof provider?.refund!=='function'||typeof provider?.refundStatus!=='function')
   fail('Provedor não oferece estorno externo homologado',409);
  const receipt=await port.first('SELECT * FROM receipts WHERE id=?',[row.receipt_id]);
  if(!receipt||receipt.reversed_at)fail('Recebimento já estornado ou ausente',409);
  if(await port.first('SELECT id FROM billing_bank_entries WHERE receipt_id=?',[row.receipt_id]))
   fail('Desfaça conciliação bancária antes de solicitar estorno externo',409);
  if(await port.first('SELECT id FROM billing_settlements WHERE installment_id=?',[row.id]))
   fail('Repasse conciliado impede estorno externo',409);
  const fingerprint=hash({installmentId:row.id,receiptId:Number(row.receipt_id),
   amountCents:Number(row.amount_cents),reference:row.provider_ref});
  const existing=await port.first('SELECT * FROM billing_refunds WHERE installment_id=? OR request_id=?',
   [row.id,code]);
  if(existing){
   if(existing.request_id!==code||existing.payload_hash!==fingerprint)
    fail('Estorno já solicitado: idempotência divergente',409);
   return existing;
  }
  const refundId=id(),at=new Date().toISOString();
  // Claime único antes da chamada remota: timeout nunca dispara reembolso novo.
  await port.run("INSERT INTO billing_refunds(id,installment_id,receipt_id,request_id,payload_hash,charge_ref,amount_cents,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'ISSUING',?,?)",
   [refundId,row.id,row.receipt_id,code,fingerprint,row.provider_ref,row.amount_cents,at,at]);
  const result=await provider.refund({requestId:refundId,
   chargeReference:row.provider_ref,amountCents:Number(row.amount_cents)});
  const reference=clean(result?.reference);
  if(!reference||reference.length>200)fail('Provedor não retornou referência do estorno',409);
  await port.run("UPDATE billing_refunds SET refund_ref=?,status='PENDING',updated_at=? WHERE id=? AND status='ISSUING'",
   [reference,new Date().toISOString(),refundId]);
  return loadRefund(refundId);
 }
 async function syncExternalRefund(refundId){
  let refund=await loadRefund(refundId);
  if(refund.status==='APPLIED'||refund.status==='FAILED')return refund;
  if(refund.status==='ISSUING')fail('Estorno externo ambíguo: consulte provedor manualmente; não reenvie',409);
  if(refund.status==='PENDING'){
   const row=await loadInstallment(refund.installment_id);
   const provider=providers[row.method];
   if(typeof provider?.refundStatus!=='function')fail('Verificação externa indisponível',409);
   const state=await provider.refundStatus(refund.refund_ref,{
    requestId:refund.id,chargeReference:refund.charge_ref,
    workOrderId:Number(row.work_order_id)
   });
   if(state?.reference!==refund.refund_ref||state?.chargeReference!==refund.charge_ref||
    !Number.isSafeInteger(state?.amountCents)||state.amountCents!==Number(refund.amount_cents))
    fail('Estorno externo divergente: valor ou referências incompatíveis',409);
   if(state.status==='PENDING')return refund;
   if(state.status==='FAILED'){
    await port.run("UPDATE billing_refunds SET status='FAILED',updated_at=? WHERE id=? AND status='PENDING'",
      [new Date().toISOString(),refund.id]);
    return loadRefund(refund.id);
   }
   if(state.status!=='REFUNDED')fail('Status de estorno externo desconhecido',409);
   await port.run("UPDATE billing_refunds SET status='CONFIRMED',updated_at=? WHERE id=? AND status='PENDING'",
    [new Date().toISOString(),refund.id]);
   refund=await loadRefund(refund.id);
  }
  if(refund.status==='CONFIRMED'){
   if(typeof reversePayment!=='function')fail('Estorno local canônico não configurado',409);
   const row=await loadInstallment(refund.installment_id);
   const receipt=await port.first('SELECT reversed_at FROM receipts WHERE id=?',[refund.receipt_id]);
   if(!receipt)fail('Recebimento de estorno não encontrado',409);
   if(!receipt.reversed_at)await reversePayment({
    workOrderId:Number(row.work_order_id),receiptId:Number(refund.receipt_id),
    externalRefundId:refund.id,note:'Estorno externo confirmado: '+refund.refund_ref
   });
   await port.run("UPDATE billing_refunds SET status='APPLIED',updated_at=? WHERE id=? AND status='CONFIRMED'",
    [new Date().toISOString(),refund.id]);
  }
  return loadRefund(refund.id);
 }
 return Object.freeze({
  importStatementFile,listReminders,dispatchReminders,
  requestExternalRefund,syncExternalRefund,getExternalRefund:loadRefund,
  billingExtrasCapabilities:()=>({externalRefunds:Object.values(providers).some(p=>
   typeof p?.refund==='function'&&typeof p.refundStatus==='function'),
   reminderDelivery:typeof reminderSender==='function',statementFileFormats:['CSV','OFX']})
 });
}
