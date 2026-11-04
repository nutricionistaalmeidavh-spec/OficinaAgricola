import {createHash,randomBytes} from 'node:crypto';

// P3/P4: schema isolado do livro canônico receipts/payment_events.
// Não cria receita até confirmação explícita ou verificação no provedor.
export const BILLING_SCHEMA_DDL=Object.freeze([
 `CREATE TABLE IF NOT EXISTS billing_plans (
   id TEXT PRIMARY KEY,
   work_order_id BIGINT NOT NULL UNIQUE REFERENCES work_orders(id),
   request_id TEXT NOT NULL UNIQUE,
   payload_hash TEXT NOT NULL,
   amount_cents BIGINT NOT NULL CHECK(amount_cents>0),
   installment_count INTEGER NOT NULL CHECK(installment_count BETWEEN 1 AND 24),
   method TEXT NOT NULL CHECK(method IN ('MANUAL','BOLETO','PAYMENT_LINK')),
   created_at TEXT NOT NULL
 )`,
 `CREATE TABLE IF NOT EXISTS billing_installments (
   id TEXT PRIMARY KEY,
   plan_id TEXT NOT NULL REFERENCES billing_plans(id),
   installment_number INTEGER NOT NULL,
   amount_cents BIGINT NOT NULL CHECK(amount_cents>0),
   due_date TEXT NOT NULL,
   status TEXT NOT NULL CHECK(status IN ('PENDING','PAID','FAILED')),
   provider_ref TEXT,
   payment_url TEXT,
   emission_state TEXT NOT NULL DEFAULT 'READY' CHECK(emission_state IN ('READY','ISSUING','ISSUED')),
   attempt_no INTEGER NOT NULL DEFAULT 0 CHECK(attempt_no>=0),
   receipt_id BIGINT UNIQUE REFERENCES receipts(id),
   created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
   UNIQUE(plan_id,installment_number)
 )`,
 'CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_provider_ref ON billing_installments(provider_ref) WHERE provider_ref IS NOT NULL',
 'CREATE INDEX IF NOT EXISTS idx_billing_due ON billing_installments(status,due_date)',
 `CREATE TABLE IF NOT EXISTS billing_settlements (
   id TEXT PRIMARY KEY,
   installment_id TEXT NOT NULL UNIQUE REFERENCES billing_installments(id),
   request_id TEXT NOT NULL UNIQUE,
   payload_hash TEXT NOT NULL,
   gross_cents BIGINT NOT NULL CHECK(gross_cents>0),
   fee_cents BIGINT NOT NULL CHECK(fee_cents>=0),
   net_cents BIGINT NOT NULL CHECK(net_cents>=0),
   settled_at TEXT NOT NULL,created_at TEXT NOT NULL,
   CHECK(gross_cents=fee_cents+net_cents)
 )`,
 `CREATE TABLE IF NOT EXISTS billing_bank_entries (
   id TEXT PRIMARY KEY,
   bank_account TEXT NOT NULL,
   external_id TEXT NOT NULL,
   payload_hash TEXT NOT NULL,
   booked_at TEXT NOT NULL,
   amount_cents BIGINT NOT NULL CHECK(amount_cents<>0),
   description TEXT NOT NULL DEFAULT '',
   receipt_id BIGINT UNIQUE REFERENCES receipts(id),
   created_at TEXT NOT NULL,
   UNIQUE(bank_account,external_id)
 )`,
 'CREATE INDEX IF NOT EXISTS idx_billing_bank_booked ON billing_bank_entries(booked_at)',
 `CREATE TABLE IF NOT EXISTS billing_reminders (
   id TEXT PRIMARY KEY,
   installment_id TEXT NOT NULL REFERENCES billing_installments(id),
   kind TEXT NOT NULL CHECK(kind IN ('DUE_SOON','OVERDUE')),
   due_date TEXT NOT NULL,
   status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','CANCELLED')),
   created_at TEXT NOT NULL,
   UNIQUE(installment_id,kind,due_date)
 )`
]);
export function migrateLocalBilling(db){for(const sql of BILLING_SCHEMA_DDL)db.exec(sql);}
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const text=v=>String(v??'').trim();
const money=value=>{
 const n=Number(value);
 if(!Number.isSafeInteger(n)||n<1)fail('Valor financeiro inválido');
 return n;
};
const key=value=>{
 const v=text(value);
 if(!/^[A-Za-z0-9_:.-]{3,128}$/.test(v))fail('Idempotência: requestId obrigatório');
 return v;
};
const num=value=>{
 const n=Number(value);
 if(!Number.isSafeInteger(n)||n<=0)fail('Identificador inválido');
 return n;
};
const digest=data=>createHash('sha256').update(JSON.stringify(data)).digest('hex');
const identity=()=>randomBytes(16).toString('hex');
const query=(sql,params=[])=>({sql,params});
const countChanges=result=>Number(result?.changes??result?.meta?.changes??0);
function isoDay(value){
 const d=text(value);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(d))fail('Data deve estar em AAAA-MM-DD');
 const actual=new Date(d+'T12:00:00.000Z');
 if(!Number.isFinite(actual.getTime())||actual.toISOString().slice(0,10)!==d)
  fail('Data de vencimento inválida');
 return d;
}
function addMonthsClamped(first,months){
 const [year,month,day]=first.split('-').map(Number);
 const n=(year*12+month-1)+months;
 const y=Math.floor(n/12),m=n%12;
 const last=new Date(Date.UTC(y,m+1,0)).getUTCDate();
 return String(y).padStart(4,'0')+'-'+String(m+1).padStart(2,'0')+'-'+String(Math.min(day,last)).padStart(2,'0');
}
export function splitInstallments(amount,count){
 const total=money(amount),parts=Number(count);
 if(!Number.isInteger(parts)||parts<1||parts>24||total<parts)
  fail('Parcelamento exige de 1 a 24 parcelas com pelo menos R$ 0,01 por parcela');
 const base=Math.floor(total/parts),remainder=total%parts;
 return Array.from({length:parts},(_,i)=>base+(i<remainder?1:0));
}
async function atomic(port,statements){
 if(port.engine==='d1')return port.batch(statements);
 return port.transaction(async tx=>{
  const results=[];
  for(const s of statements)results.push(await tx.run(s.sql,s.params));
  return results;
 });
}
const validUrl=value=>{
 const raw=text(value);let url;
 try{url=new URL(raw);}catch{fail('Provedor não retornou URL de cobrança válida',409);}
 if(url.protocol!=='https:'||url.username||url.password||url.hash||raw.length>2048)
  fail('Provedor retornou URL de cobrança insegura',409);
 return raw;
};

export function createBillingService(port,{receivePayment,getPaymentSummary,providers={}}={}){
 if(!port||!['sqlite','postgres','d1'].includes(port.engine)||
   !['first','all','run','batch','transaction'].every(fn=>typeof port[fn]==='function'))
  fail('Porta SQL canônica obrigatória');
 if(typeof receivePayment!=='function'||typeof getPaymentSummary!=='function')
  fail('Livro de recebimento canônico obrigatório');
 const loadPlan=async id=>{
  const p=await port.first('SELECT * FROM billing_plans WHERE id=?',[text(id)]);
  if(!p)fail('Plano de cobrança não encontrado',404);
  return {...p,installments:await port.all(
   'SELECT * FROM billing_installments WHERE plan_id=? ORDER BY installment_number',[p.id])};
 };
 const loadInstallment=async id=>{
  const row=await port.first(`SELECT i.*,p.work_order_id,p.method
   FROM billing_installments i JOIN billing_plans p ON p.id=i.plan_id WHERE i.id=?`,[text(id)]);
  if(!row)fail('Parcela não encontrada',404);
  return row;
 };
 async function createPlan(input={}){
  const workOrderId=num(input.workOrderId),amountCents=money(input.amountCents);
  const count=Number(input.count),method=text(input.method).toUpperCase();
  const firstDueDate=isoDay(input.firstDueDate),requestId=key(input.requestId);
  if(!['MANUAL','BOLETO','PAYMENT_LINK'].includes(method))fail('Modalidade de cobrança inválida');
  const amounts=splitInstallments(amountCents,count);
  const hash=digest({workOrderId,amountCents,count,method,firstDueDate});
  const prior=await port.first('SELECT * FROM billing_plans WHERE request_id=?',[requestId]);
  if(prior){
   if(prior.payload_hash!==hash)fail('Idempotência: plano solicitado com dados diferentes',409);
   return loadPlan(prior.id);
  }
  const summary=await getPaymentSummary(workOrderId);
  // Uma OS tem um plano de cobrança. Todas as demais entradas financeiras
  // continuam no mesmo ledger, sem criar valor a receber fictício.
  if(summary.status==='CANCELADO'||Number(summary.pendingCents)!==amountCents)
   fail('Parcelamento deve corresponder exatamente ao saldo pendente aprovado',409);
  const planId=identity(),at=new Date().toISOString();
  const rows=amounts.map((cents,index)=>({
   id:identity(),installmentNumber:index+1,amountCents:cents,
   dueDate:addMonthsClamped(firstDueDate,index)
  }));
  const statements=[
   query(`INSERT INTO billing_plans(id,work_order_id,request_id,payload_hash,
    amount_cents,installment_count,method,created_at)
    SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(
      SELECT 1 FROM work_orders wo JOIN quotes q ON q.work_order_id=wo.id
      WHERE wo.id=? AND q.approval_status='APROVADO' AND wo.status<>'CANCELADA'
        AND wo.quote_total_cents-
         COALESCE((SELECT SUM(r.amount_cents) FROM receipts r
                   WHERE r.work_order_id=wo.id AND r.reversed_at IS NULL),0)=?
    ) AND NOT EXISTS(SELECT 1 FROM billing_plans WHERE work_order_id=?)`,[
    planId,workOrderId,requestId,hash,amountCents,count,method,at,
    workOrderId,amountCents,workOrderId
   ]),
   ...rows.map(row=>query(`INSERT INTO billing_installments(
       id,plan_id,installment_number,amount_cents,due_date,status,created_at,updated_at)
     SELECT ?,?,?,?,?, 'PENDING',?,? WHERE EXISTS(
       SELECT 1 FROM billing_plans WHERE id=? AND payload_hash=?)`,[
     row.id,planId,row.installmentNumber,row.amountCents,row.dueDate,at,at,planId,hash
   ]))
  ];
  try{
   const result=await atomic(port,statements);
   if(countChanges(result[0])!==1)fail('Já existe plano de cobrança ou saldo diferente',409);
  }catch(error){
   const replay=await port.first('SELECT * FROM billing_plans WHERE request_id=?',[requestId]);
   if(replay){
    if(replay.payload_hash!==hash)fail('Idempotência: plano divergente',409);
    return loadPlan(replay.id);
   }
   throw error;
  }
  return loadPlan(planId);
 }
 async function activateInstallment(installmentId){
  const installment=await loadInstallment(installmentId);
  if(installment.status==='PAID')return installment;
  if(installment.method==='MANUAL')return installment;
  if(installment.provider_ref)return installment;
  const provider=providers[installment.method];
  if(!provider||typeof provider.create!=='function'||typeof provider.status!=='function')
   fail('Provedor de '+installment.method+' não configurado',409);
  // Proteção de concorrência do lado do banco antes de qualquer operação externa.
  // Falhas ambíguas ficam ISSUING e só podem ser recuperadas por consulta ao PSP.
  const cmd={
   requestId:installment.id,workOrderId:Number(installment.work_order_id),
   amountCents:Number(installment.amount_cents),dueDate:installment.due_date
  };
  let result;
  if(installment.emission_state==='ISSUING'){
   if(typeof provider.recover!=='function')
    fail('Emissão em andamento: recuperação externa é necessária',409);
   result=await provider.recover(cmd);
   if(!result)fail('Emissão em andamento: confirme com o provedor antes de reemitir',409);
  }else if(installment.emission_state==='READY'){
   const claim=await port.run(`UPDATE billing_installments SET emission_state='ISSUING',
     updated_at=? WHERE id=? AND status='PENDING' AND provider_ref IS NULL
     AND emission_state='READY'`,[new Date().toISOString(),installment.id]);
   if(countChanges(claim)!==1)fail('Emissão em andamento: outra sessão já solicitou a cobrança',409);
   // Nunca repetir automaticamente após falha ou timeout. Somente recover
   // (consulta sem POST) pode liberar uma emissão anteriormente desconhecida.
   result=await provider.create(cmd);
  }else fail('Emissão externa inconsistente, conciliação necessária',409);
  const reference=text(result?.reference);
  if(!reference||reference.length>200)fail('Provedor não retornou referência de cobrança',409);
  const paymentUrl=validUrl(result?.paymentUrl);
  await port.run(`UPDATE billing_installments SET provider_ref=?,payment_url=?,
    emission_state='ISSUED',updated_at=?
    WHERE id=? AND status='PENDING' AND provider_ref IS NULL AND emission_state='ISSUING'`,[
    reference,paymentUrl,new Date().toISOString(),installment.id
   ]);
  const current=await loadInstallment(installment.id);
  if(current.provider_ref!==reference)fail('Conflito de referência externa de cobrança',409);
  return current;
 }
 async function finalize(row,method){
  const receipt=await receivePayment({
   workOrderId:Number(row.work_order_id),amountCents:Number(row.amount_cents),
   method,requestId:'billing:'+row.id+':'+Number(row.attempt_no??0)
  });
  await port.run(`UPDATE billing_installments SET status='PAID',receipt_id=?,updated_at=?
   WHERE id=? AND status='PENDING'`,[receipt.id,new Date().toISOString(),row.id]);
  const updated=await loadInstallment(row.id);
  if(updated.receipt_id!==receipt.id)fail('Conflito na confirmação de parcela',409);
  return updated;
 }
 async function confirmManual(installmentId,{verified=false,method='TRANSFERENCIA'}={}){
  const row=await loadInstallment(installmentId);
  if(row.status==='PAID')return row;
  if(row.method!=='MANUAL')fail('Cobrança externa exige confirmação autenticada do provedor',409);
  if(verified!==true)fail('Confirmação bancária/caixa explícita é obrigatória',409);
  const allowed=new Set(['PIX','TRANSFERENCIA','BOLETO','DINHEIRO','CARTAO']);
  if(!allowed.has(method))fail('Forma do recebimento manual inválida');
  return finalize(row,method);
 }
 async function syncInstallment(installmentId){
  const row=await loadInstallment(installmentId);
  if(row.status==='PAID'||row.status==='FAILED')return row;
  if(row.method==='MANUAL')fail('Parcela manual depende de confirmação pelo financeiro',409);
  if(!row.provider_ref)fail('Cobrança não foi emitida pelo provedor',409);
  const provider=providers[row.method];
  if(!provider||typeof provider.status!=='function')fail('Provedor indisponível',409);
  const state=await provider.status(row.provider_ref,{requestId:row.id,workOrderId:Number(row.work_order_id)});
  if(state?.reference!==row.provider_ref||
    !Number.isSafeInteger(state?.amountCents)||state.amountCents!==Number(row.amount_cents))
   fail('Cobrança externa divergente: valor ou referência incompatíveis',409);
  if(state.status==='PENDING')return row;
  if(state.status==='FAILED'){
   await port.run(`UPDATE billing_installments SET status='FAILED',updated_at=?
    WHERE id=? AND status='PENDING'`,[new Date().toISOString(),row.id]);
   return loadInstallment(row.id);
  }
  if(state.status!=='PAID')fail('Estado externo de pagamento desconhecido',409);
  return finalize(row,row.method==='BOLETO'?'BOLETO':'LINK_PAGAMENTO');
 }
 async function recordSettlement(input={}){
  const installment=await loadInstallment(input.installmentId);
  if(installment.status!=='PAID'||!installment.receipt_id)
   fail('Repasse só pode ser conciliado após recebimento comprovado',409);
  const fee=Number(input.feeCents),gross=Number(installment.amount_cents);
  if(!Number.isSafeInteger(fee)||fee<0||fee>gross)fail('Taxa de operadora inválida');
  const settledAt=isoDay(input.settledAt),requestId=key(input.requestId);
  const hash=digest({installmentId:installment.id,fee,settledAt});
  const previous=await port.first('SELECT * FROM billing_settlements WHERE request_id=?',[requestId]);
  if(previous){
   if(previous.payload_hash!==hash)fail('Idempotência: repasse divergente',409);
   return previous;
  }
  const id=identity(),at=new Date().toISOString();
  await port.run(`INSERT INTO billing_settlements(
    id,installment_id,request_id,payload_hash,gross_cents,fee_cents,net_cents,settled_at,created_at
  ) VALUES(?,?,?,?,?,?,?,?,?)`,[
    id,installment.id,requestId,hash,gross,fee,gross-fee,settledAt,at
  ]);
  return port.first('SELECT * FROM billing_settlements WHERE id=?',[id]);
 }
 async function importStatement(input={}){
  const bankAccount=text(input.bankAccount),externalId=text(input.externalId),description=text(input.description);
  if(!bankAccount||bankAccount.length>80||!externalId||externalId.length>128||
    description.length>300)fail('Identificação do lançamento bancário inválida');
  const bookedAt=isoDay(input.bookedAt);
  const amountCents=Number(input.amountCents);
  if(!Number.isSafeInteger(amountCents)||amountCents===0)fail('Valor bancário inválido');
  const hash=digest({bankAccount,externalId,bookedAt,amountCents,description});
  const prior=await port.first('SELECT * FROM billing_bank_entries WHERE bank_account=? AND external_id=?',
    [bankAccount,externalId]);
  if(prior){
   if(prior.payload_hash!==hash)fail('Idempotência: lançamento bancário divergente',409);
   return prior;
  }
  const id=identity(),at=new Date().toISOString();
  try{
   await port.run(`INSERT INTO billing_bank_entries(
    id,bank_account,external_id,payload_hash,booked_at,amount_cents,description,created_at
   ) VALUES(?,?,?,?,?,?,?,?)`,[id,bankAccount,externalId,hash,bookedAt,amountCents,description,at]);
  }catch(error){
   const current=await port.first('SELECT * FROM billing_bank_entries WHERE bank_account=? AND external_id=?',
    [bankAccount,externalId]);
   if(current&&current.payload_hash===hash)return current;
   if(current)fail('Idempotência: lançamento bancário divergente',409);
   throw error;
  }
  return port.first('SELECT * FROM billing_bank_entries WHERE id=?',[id]);
 }
 async function matchStatement(entryId,receiptId){
  const entry=await port.first('SELECT * FROM billing_bank_entries WHERE id=?',[text(entryId)]);
  if(!entry)fail('Lançamento bancário não encontrado',404);
  const receipt=await port.first('SELECT * FROM receipts WHERE id=?',[num(receiptId)]);
  if(!receipt||receipt.reversed_at)fail('Recebimento não existe ou foi estornado',409);
  if(Number(entry.amount_cents)<=0||Number(entry.amount_cents)!==Number(receipt.amount_cents))
   fail('Valor de extrato não coincide com recebimento',409);
  if(entry.receipt_id!=null){
   if(Number(entry.receipt_id)===Number(receipt.id))return entry;
   fail('Lançamento já conciliado com outro recebimento',409);
  }
  // Conciliação é associação, NÃO cria outra receita. UNIQUE(receipt_id)
  // impede uso de um recebimento em dois lançamentos bancários.
  const result=await port.run('UPDATE billing_bank_entries SET receipt_id=? WHERE id=? AND receipt_id IS NULL',
    [receipt.id,entry.id]);
  if(countChanges(result)!==1)fail('Conciliação já executada',409);
  return port.first('SELECT * FROM billing_bank_entries WHERE id=?',[entry.id]);
 }
 async function prepareReminders({asOf=new Date().toISOString().slice(0,10),daysAhead=3}={}){
  const day=isoDay(asOf),days=Number(daysAhead);
  if(!Number.isInteger(days)||days<0||days>30)fail('Janela de lembretes inválida');
  const threshold=new Date(day+'T12:00:00.000Z');
  threshold.setUTCDate(threshold.getUTCDate()+days);
  const maxDate=threshold.toISOString().slice(0,10);
  const rows=await port.all(`SELECT id,due_date FROM billing_installments
   WHERE status='PENDING' AND due_date<=? ORDER BY due_date,id`,[maxDate]);
  const at=new Date().toISOString();
  for(const installment of rows){
   const kind=installment.due_date<day?'OVERDUE':'DUE_SOON';
   await port.run(`INSERT INTO billing_reminders(
      id,installment_id,kind,due_date,status,created_at
    ) VALUES(?,?,?,?,'DRAFT',?) ON CONFLICT(installment_id,kind,due_date) DO NOTHING`,[
    identity(),installment.id,kind,installment.due_date,at
   ]);
  }
  return port.all(`SELECT r.* FROM billing_reminders r
   JOIN billing_installments i ON i.id=r.installment_id
   WHERE r.status='DRAFT' AND i.status='PENDING' ORDER BY r.due_date,r.id`);
 }
 async function getPlanForOrder(workOrderId){
  const row=await port.first('SELECT id FROM billing_plans WHERE work_order_id=?',[num(workOrderId)]);
  return row?loadPlan(row.id):null;
 }
 async function listStatements({limit=100}={}){
  const n=Number(limit);
  if(!Number.isInteger(n)||n<1||n>200)fail('Limite de extrato inválido');
  // LIMIT bound parameter works on SQLite, D1 and PostgreSQL.
  return port.all('SELECT * FROM billing_bank_entries ORDER BY booked_at DESC,id DESC LIMIT ?',[n]);
 }
 async function listAvailableReceipts({limit=100}={}){
  const n=Number(limit);
  if(!Number.isInteger(n)||n<1||n>200)fail('Limite de recebimentos inválido');
  return port.all(`SELECT r.id,r.work_order_id,r.amount_cents,r.method,r.received_at,
    wo.os_number,c.name AS customer_name FROM receipts r
    JOIN work_orders wo ON wo.id=r.work_order_id
    JOIN customers c ON c.id=wo.customer_id
    WHERE r.reversed_at IS NULL AND NOT EXISTS(
      SELECT 1 FROM billing_bank_entries bank WHERE bank.receipt_id=r.id
    ) ORDER BY r.received_at DESC,r.id DESC LIMIT ?`,[n]);
 }
 async function financeReport({asOf=new Date().toISOString().slice(0,10)}={}){
  const day=isoDay(asOf);
  const installments=await port.first(`SELECT
    COALESCE(SUM(CASE WHEN status='PAID' THEN amount_cents ELSE 0 END),0) received,
    COALESCE(SUM(CASE WHEN status='PENDING' THEN amount_cents ELSE 0 END),0) pending,
    COALESCE(SUM(CASE WHEN status='PENDING' AND due_date<? THEN amount_cents ELSE 0 END),0) overdue
    FROM billing_installments`,[day]);
  const settlements=await port.first(`SELECT
    COALESCE(SUM(gross_cents),0) gross,
    COALESCE(SUM(fee_cents),0) fee,
    COALESCE(SUM(net_cents),0) net FROM billing_settlements`);
  const bank=await port.first(`SELECT
    COUNT(*) imported,
    COALESCE(SUM(CASE WHEN receipt_id IS NOT NULL THEN 1 ELSE 0 END),0) matched
    FROM billing_bank_entries`);
  return {
   grossReceivedCents:Number(installments.received),
   pendingCents:Number(installments.pending),
   overdueCents:Number(installments.overdue),
   grossSettledCents:Number(settlements.gross),
   feeCents:Number(settlements.fee),
   netSettledCents:Number(settlements.net),
   bankEntries:Number(bank.imported),bankMatched:Number(bank.matched)
  };
 }
 return Object.freeze({
  createPlan,getPlan:loadPlan,getPlanForOrder,getInstallment:loadInstallment,activateInstallment,
  syncInstallment,confirmManual,recordSettlement,importStatement,matchStatement,
  prepareReminders,financeReport,listStatements,listAvailableReceipts,
  capabilities:()=>({manual:true,boleto:Boolean(providers.BOLETO),
   paymentLink:Boolean(providers.PAYMENT_LINK)})
 });
}
