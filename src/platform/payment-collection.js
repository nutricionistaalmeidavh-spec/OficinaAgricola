import {createHash,randomBytes} from 'node:crypto';

// Todas as quantias são centavos inteiros. O extrato canônico continua
// sendo receipts/payment_events; esta tabela guarda somente cobranças.
export const PAYMENT_COLLECTION_DDL=Object.freeze([
 `CREATE TABLE IF NOT EXISTS payment_intents (
    id TEXT PRIMARY KEY,
    work_order_id BIGINT NOT NULL REFERENCES work_orders(id),
    request_id TEXT NOT NULL UNIQUE,
    request_hash TEXT NOT NULL,
    method TEXT NOT NULL CHECK(method IN ('PIX_STATIC','PIX_API','TEF','SMART_POS')),
    amount_cents BIGINT NOT NULL CHECK(amount_cents>0),
    status TEXT NOT NULL CHECK(status IN ('PREPARING','PENDING','PAID','FAILED')),
    provider_ref TEXT,
    pix_payload TEXT,
    receipt_id BIGINT REFERENCES receipts(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
 'CREATE INDEX IF NOT EXISTS idx_payment_intents_order ON payment_intents(work_order_id,created_at)',
 'CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_intents_provider ON payment_intents(method,provider_ref) WHERE provider_ref IS NOT NULL'
]);

export function migrateLocalPaymentCollection(db){
 for(const sql of PAYMENT_COLLECTION_DDL)db.exec(sql);
}
export async function migrateAsyncPaymentCollection(port){
 for(const sql of PAYMENT_COLLECTION_DDL)await port.run(sql);
}

const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const clean=value=>String(value??'').trim();
const amount=value=>{
 const n=Number(value);
 if(!Number.isSafeInteger(n)||n<1)fail('Valor de cobrança inválido');
 return n;
};
const numericId=value=>{
 const n=Number(value);
 if(!Number.isSafeInteger(n)||n<1)fail('Identificador inválido');
 return n;
};
const emv=(tag,value)=>{
 const payload=String(value);
 if(payload.length>99)fail('Campo Pix excede tamanho permitido');
 return tag+String(payload.length).padStart(2,'0')+payload;
};
function crc16(input){
 let crc=0xFFFF;
 for(let i=0;i<input.length;i++){
  crc^=input.charCodeAt(i)<<8;
  for(let j=0;j<8;j++)crc=(crc&0x8000)?((crc<<1)^0x1021)&0xFFFF:(crc<<1)&0xFFFF;
 }
 return crc.toString(16).toUpperCase().padStart(4,'0');
}
export function checkPixCrc(payload){
 if(typeof payload!=='string'||!/^6304[0-9A-F]{4}$/.test(payload.slice(-8)))return false;
 return crc16(payload.slice(0,-4))===payload.slice(-4);
}
const ascii=(value,max)=>{
 const s=clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase()
   .replace(/[^A-Z0-9 .-]/g,' ').replace(/\s+/g,' ').trim();
 if(!s||s.length>max)fail('Nome/cidade Pix inválido');
 return s;
};
/** BR Code estático padronizado EMV: apenas apresenta chave e valor.
 * Não comprova pagamento; jamais muda o financeiro sozinho. */
export function generateStaticPix({pixKey,merchantName,merchantCity,amountCents,txid='***'}={}){
 const key=clean(pixKey);
 if(!key||key.length>77||/[\x00-\x1F]/.test(key))fail('Chave Pix da oficina não configurada');
 const name=ascii(merchantName,25),city=ascii(merchantCity,15);
 const ref=clean(txid);
 if(ref!=='***'&&!/^[A-Za-z0-9]{1,25}$/.test(ref))fail('TxId Pix inválido');
 const total=(amount(amountCents)/100).toFixed(2);
 const merchant=emv('00','br.gov.bcb.pix')+emv('01',key);
 const payload=emv('00','01')+emv('01','11')+emv('26',merchant)+
  emv('52','0000')+emv('53','986')+emv('54',total)+emv('58','BR')+
  emv('59',name)+emv('60',city)+emv('62',emv('05',ref))+'6304';
 return payload+crc16(payload);
}

const allowed=new Set(['PIX_STATIC','PIX_API','TEF','SMART_POS']);
const confirmedMethod=method=>method.startsWith('PIX')?'PIX':'CARTAO';
const fingerprint=command=>createHash('sha256').update(JSON.stringify(command)).digest('hex');

/**
 * Integração independente do banco, do gateway e do terminal.
 * providers: adaptadores explicitamente configurados por unidade, com
 * create({requestId,amountCents,workOrderId}) -> {reference,pixPayload?}
 * status(reference,{requestId}) -> {reference,status:'PENDING'|'PAID'|'FAILED',amountCents}
 * Nenhuma requisição do navegador pode forçar status=PAID.
 */
export function createPaymentCollection(port,{
 receivePayment,getPaymentSummary,pixStatic=null,providers={}
}={}){
 if(!port||!['sqlite','postgres','d1'].includes(port.engine)||typeof port.first!=='function')
  fail('Adaptador SQL de cobrança inválido');
 if(typeof receivePayment!=='function'||typeof getPaymentSummary!=='function')
  fail('Livro financeiro canônico obrigatório');

 const find=async id=>{
  const row=await port.first('SELECT * FROM payment_intents WHERE id=?',[clean(id)]);
  if(!row)fail('Cobrança não encontrada',404);
  return row;
 };
 const findRequest=key=>port.first('SELECT * FROM payment_intents WHERE request_id=?',[key]);
 async function createIntent(input={}){
  const method=clean(input.method).toUpperCase();
  if(!allowed.has(method))fail('Forma de cobrança inválida');
  const workOrderId=numericId(input.workOrderId),amountCents=amount(input.amountCents);
  const requestId=clean(input.requestId);
  if(!/^[A-Za-z0-9_:.-]{3,128}$/.test(requestId))fail('Idempotência: requestId inválido');
  const hash=fingerprint({workOrderId,amountCents,method});
  const prior=await findRequest(requestId);
  if(prior&&prior.request_hash!==hash)fail('Idempotência: identificador reutilizado com outros dados',409);
  if(prior&&prior.status!=='PREPARING')return prior;

  const provider=providers[method];
  if(method==='PIX_STATIC'&&!pixStatic)fail('Pix estático não configurado para esta unidade',409);
  if(method!=='PIX_STATIC'&&(!provider||typeof provider.create!=='function'||
    typeof provider.status!=='function'))
   fail('Provedor '+method+' não configurado/homologado',409);

  if(!prior){
   const summary=await getPaymentSummary(workOrderId);
   if(summary.status==='CANCELADO'||Number(summary.pendingCents)<amountCents)
    fail('Saldo insuficiente ou OS cancelada',409);
  }
  const id=prior?.id??randomBytes(16).toString('hex'),at=new Date().toISOString();
  if(!prior){
   await port.run(`INSERT INTO payment_intents(
    id,work_order_id,request_id,request_hash,method,amount_cents,status,created_at,updated_at
   ) VALUES(?,?,?,?,?,?,'PREPARING',?,?) ON CONFLICT(request_id) DO NOTHING`,[
    id,workOrderId,requestId,hash,method,amountCents,at,at
   ]);
   const winner=await findRequest(requestId);
   if(winner.request_hash!==hash)fail('Idempotência: dados diferentes',409);
   if(winner.id!==id)return winner;
  }

  let reference=null,pixPayload=null;
  if(method==='PIX_STATIC'){
   pixPayload=generateStaticPix({...pixStatic,amountCents,txid:id.toUpperCase().slice(0,25)});
  }else{
   // Adaptadores externos DEVEM usar requestId como chave idempotente, inclusive
   // ao retomar status PREPARING após queda de conexão.
   const result=await provider.create({requestId,amountCents,workOrderId});
   reference=clean(result?.reference);
   if(!reference||reference.length>200)fail('Provedor não retornou referência válida',502);
   pixPayload=method==='PIX_API'?clean(result.pixPayload)||null:null;
   if(pixPayload&&pixPayload.length>10000)fail('QR do provedor excede tamanho',502);
  }
  await port.run(`UPDATE payment_intents SET status='PENDING',provider_ref=?,pix_payload=?,
    updated_at=? WHERE id=? AND status='PREPARING'`,[reference,pixPayload,new Date().toISOString(),id]);
  return find(id);
 }
 async function syncIntent(intentId){
  const current=await find(intentId);
  if(['PAID','FAILED'].includes(current.status))return current;
  if(current.status!=='PENDING')fail('Cobrança ainda em preparação',409);
  if(current.method==='PIX_STATIC')
   fail('Pix estático não permite confirmação automática: confira no banco e use recebimento manual',409);
  const adapter=providers[current.method];
  if(!adapter||typeof adapter.status!=='function')
   fail('Provedor não configurado; cobrança permanece pendente',409);
  // A fonte da verdade é a consulta autenticada no provedor, nunca um
  // parâmetro de status recebido do cliente HTTP.
  const state=await adapter.status(current.provider_ref,{requestId:current.request_id});
  if(clean(state?.reference)!==current.provider_ref)
   fail('Referência divergente na conciliação',409);
  if(!Number.isSafeInteger(Number(state?.amountCents))||
     Number(state.amountCents)!==Number(current.amount_cents))
   fail('Valor divergente na conciliação',409);
  if(state.status==='PENDING')return current;
  if(state.status==='FAILED'){
   await port.run(`UPDATE payment_intents SET status='FAILED',updated_at=? WHERE id=? AND status='PENDING'`,
    [new Date().toISOString(),current.id]);
   return find(current.id);
  }
  if(state.status!=='PAID')fail('Estado do provedor não reconhecido',409);
  // O serviço financeiro já aplica trava de saldo, idempotência e lançamento
  // único em receipts/payment_events. Nunca inserir receita aqui.
  const receipt=await receivePayment({
   workOrderId:Number(current.work_order_id),amountCents:Number(current.amount_cents),
   method:confirmedMethod(current.method),requestId:'intent:'+current.id
  });
  await port.run(`UPDATE payment_intents SET status='PAID',receipt_id=?,updated_at=?
    WHERE id=? AND status='PENDING'`,[receipt.id,new Date().toISOString(),current.id]);
  return find(current.id);
 }
 return Object.freeze({
  createIntent,syncIntent,getIntent:find,
  getCapabilities:()=>({
   manual:true,pixStatic:!!pixStatic,
   pixApi:!!providers.PIX_API,tef:!!providers.TEF,smartPos:!!providers.SMART_POS
  })
 });
}
