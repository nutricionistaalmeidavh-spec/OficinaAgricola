const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const amount=value=>{
 const n=Number(value);
 if(!Number.isSafeInteger(n)||n<1)fail('Valor Asaas inválido');
 return n;
};
const centavos=value=>{
 const s=Number(value).toFixed(2),n=Number(value);
 if(!Number.isFinite(n)||!Number.isSafeInteger(Math.round(n*100))||
   Math.abs(n*100-Math.round(n*100))>0.00001||n<=0)
  fail('Valor monetário do Asaas inválido');
 return Math.round(n*100);
};
const validateReference=value=>{
 const s=String(value??'').trim();
 if(!/^[A-Za-z0-9_:.-]{3,128}$/.test(s))fail('Referência externa inválida');
 return s;
};
/**
 * Transporte da API Asaas, sem dependências ou endpoints controlados pelo browser.
 * Por segurança, produção fica fora do construtor padrão até homologação
 * operacional explícita. Credencial apenas no servidor, nunca na UI.
 */
export function createAsaasHttpTransport({
 apiKey,environment='sandbox',productionApproved=false,fetchImpl=fetch
}={}){
 if(typeof apiKey!=='string'||apiKey.length<8)
  fail('Chave Asaas não configurada');
 if(!['sandbox','production'].includes(environment))fail('Ambiente Asaas inválido');
 if(environment==='production'&&productionApproved!==true)
  fail('Asaas produção exige autorização explícita e homologação');
 if(typeof fetchImpl!=='function')fail('Transporte Asaas inválido');
 const base=environment==='sandbox'
  ?'https://api-sandbox.asaas.com/v3':'https://api.asaas.com/v3';
 return async(method,path,body)=>{
  if(!['GET','POST'].includes(method)||typeof path!=='string'||
    !/^\/(?:payments)(?:\/[A-Za-z0-9_-]+)?$/.test(path))
   fail('Método/caminho Asaas não autorizado');
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),15000);
  try{
   const response=await fetchImpl(base+path,{
    method,
    headers:{access_token:apiKey,'User-Agent':'ArtiSys-Oficina/1.0',
      'Content-Type':'application/json','Accept':'application/json'},
    ...(method==='POST'?{body:JSON.stringify(body)}:{}),
    signal:controller.signal,redirect:'error'
   });
   if(!response.ok)fail('Asaas recusou consulta ou criação de cobrança',502);
   const raw=await response.text();
   if(raw.length>65536)fail('Resposta Asaas excessiva',502);
   return JSON.parse(raw);
  }finally{clearTimeout(timeout);}
 };
}
/**
 * Integração BOLETO ou PAYMENT_LINK:
 * PAYMENT_LINK aqui significa invoiceUrl individual de /v3/payments
 * (não um paymentLink reutilizável sem associação 1:1).
 * resolveCustomer(idOs) tem de mapear o cliente do tenant no servidor.
 */
export function createAsaasBillingProvider({transport,resolveCustomer,method}={}){
 if(typeof transport!=='function'||typeof resolveCustomer!=='function')
  fail('Asaas exige transporte autenticado e resolução de cliente no servidor');
 if(!['BOLETO','PAYMENT_LINK'].includes(method))fail('Modalidade Asaas inválida');
 const billingType=method==='BOLETO'?'BOLETO':'UNDEFINED';
 return Object.freeze({
  async create({requestId,workOrderId,amountCents,dueDate}={}){
   const ref=validateReference(requestId),sum=amount(amountCents);
   if(!/^\d{4}-\d{2}-\d{2}$/.test(String(dueDate)))
    fail('Vencimento Asaas inválido');
   const customer=String(await resolveCustomer(workOrderId)??'').trim();
   if(!/^cus_[A-Za-z0-9]+$/.test(customer))
    fail('Cliente Asaas não vinculado à OS e à unidade');
   // Recuperação antes de reemitir: o Asaas não garante que um timeout
   // signifique ausência da cobrança. Nunca repetir POST sem consulta.
   const previous=await transport('GET','/payments?externalReference='+encodeURIComponent(ref));
   const matches=Array.isArray(previous?.data)?
     previous.data.filter(row=>row.externalReference===ref):[];
   if(matches.length>1)fail('Asaas retornou cobranças duplicadas: conciliação manual necessária',409);
   const created=matches[0]??await transport('POST','/payments',{
    customer,billingType,value:Number((sum/100).toFixed(2)),
    dueDate,externalReference:ref,
    description:'Oficina - cobrança vinculada à OS'
   });
   if(created?.customer!==customer||created?.billingType!==billingType||
     created?.externalReference!==ref||centavos(created?.value)!==sum||
     !/^pay_[A-Za-z0-9_-]+$/.test(String(created?.id??'')))
    fail('Asaas retornou referência, cliente ou valor divergente',409);
   const url=String(method==='BOLETO'?(created.bankSlipUrl||created.invoiceUrl):created.invoiceUrl);
   if(!url.startsWith('https://'))fail('Asaas não retornou link HTTPS da cobrança',409);
   return {reference:created.id,paymentUrl:url};
  },
  async status(reference,{requestId,workOrderId}={}){
   const id=String(reference??'');
   if(!/^pay_[A-Za-z0-9_-]+$/.test(id))fail('ID Asaas inválido');
   const current=await transport('GET','/payments/'+id);
   const customer=String(await resolveCustomer(workOrderId)??'').trim();
   if(current?.id!==id||current?.externalReference!==validateReference(requestId)||
      current?.customer!==customer||current?.billingType!==billingType)
    fail('Asaas retornou cobrança não vinculada à parcela',409);
   const cents=centavos(current.value);
   const status=String(current.status??'');
   // CONFIRMED significa pagamento reconhecido, mas ainda não disponível.
   // Para conciliação conservadora, a baixa ocorre apenas após RECEIVED.
   if(status==='RECEIVED')return {reference:id,status:'PAID',amountCents:cents};
   if(['PENDING','CONFIRMED','OVERDUE','DUNNING_REQUESTED','AWAITING_RISK_ANALYSIS'].includes(status))
    return {reference:id,status:'PENDING',amountCents:cents};
   if(['REFUNDED','REFUND_REQUESTED','CHARGEBACK_REQUESTED','CHARGEBACK_DISPUTE','DELETED'].includes(status))
    return {reference:id,status:'FAILED',amountCents:cents};
   fail('Status Asaas não autorizado para baixa',409);
  }
 });
}
