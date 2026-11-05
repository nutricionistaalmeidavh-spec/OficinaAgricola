import {createHash} from 'node:crypto';

const fail=message=>{throw new Error(message);};
const cents=value=>{
 if(!/^(?:0|[1-9][0-9]*)\.[0-9]{2}$/.test(String(value??'')))
  fail('Valor Pix do provedor inválido');
 const [real,cent]=String(value).split('.');
 const amount=Number(real)*100+Number(cent);
 if(!Number.isSafeInteger(amount)||amount<1)fail('Valor Pix fora do limite');
 return amount;
};
const currency=number=>{
 if(!Number.isSafeInteger(number)||number<1)fail('Valor Pix inválido');
 return (number/100).toFixed(2);
};
/**
 * API Pix BACEN: transporte autenticado (OAuth2 e certificado mTLS)
 * injetado pelo integrador bancário, sem credenciais no domínio.
 * transport(method,path,body) retorna JSON validado pelo PSP.
 */
export function createBacenPixProvider({pixKey,transport,expirySeconds=3600}={}){
 if(typeof transport!=='function')fail('Transporte Pix OAuth2/mTLS não configurado');
 if(typeof pixKey!=='string'||!pixKey.trim()||pixKey.length>77)
  fail('Chave Pix bancária inválida');
 if(!Number.isInteger(expirySeconds)||expirySeconds<60||expirySeconds>86400)
  fail('Expiração Pix inválida');
 const key=pixKey.trim();
 return Object.freeze({
  async create({requestId,amountCents}){
   const txid=createHash('sha256').update(String(requestId)).digest('hex').slice(0,32).toUpperCase();
   const value=currency(Number(amountCents));
   const result=await transport('PUT','/cob/'+txid,{
    calendario:{expiracao:expirySeconds},valor:{original:value},chave:key
   });
   if(result?.txid!==txid||result?.chave!==key||cents(result?.valor?.original)!==amountCents)
    fail('Resposta de criação Pix divergente');
   let payload=result.pixCopiaECola;
   if(!payload&&result.loc?.id){
    const qr=await transport('GET','/loc/'+String(result.loc.id)+'/qrcode');
    payload=qr?.qrcode;
   }
   if(typeof payload!=='string'||!payload.trim())fail('Banco não retornou QR Pix dinâmico');
   return {reference:txid,pixPayload:payload};
  },
  async status(reference){
   if(!/^[A-Z0-9]{32}$/.test(String(reference)))fail('TxId bancário inválido');
   const result=await transport('GET','/cob/'+reference);
   if(result?.txid!==reference||result?.chave!==key)
    fail('Cobrança Pix não corresponde à oficina');
   if(result?.status==='ATIVA')
    return {reference,status:'PENDING',amountCents:cents(result?.valor?.original)};
   if(['REMOVIDA_PELO_USUARIO_RECEBEDOR','REMOVIDA_PELO_PSP'].includes(result?.status))
    return {reference,status:'FAILED',amountCents:cents(result?.valor?.original)};
   if(result?.status!=='CONCLUIDA'||!Array.isArray(result.pix)||!result.pix.length)
    fail('Liquidação Pix não verificada');
   const paid=result.pix.reduce((n,row)=>n+cents(row.valor),0);
   if(!Number.isSafeInteger(paid))fail('Pix excedeu limite monetário');
   if(paid!==cents(result?.valor?.original))fail('Pix liquidado com valor divergente');
   return {reference,status:'PAID',amountCents:paid};
  }
 });
}
/**
 * Adaptador para ponte TEF ou Smart POS self-hosted homologada.
 * Endpoint FIXO de loopback, nunca fornecido pelo navegador.
 * A ponte deve validar o token, vincular requestId à transação e
 * devolver somente aprovação autenticada pela adquirente.
 */
export function createLoopbackPaymentProvider({endpoint,token,fetchImpl=fetch}={}){
 let target;
 try{target=new URL(endpoint);}catch{fail('Endpoint de terminal inválido');}
 if(target.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(target.hostname)||
  target.username||target.password||target.search||target.hash||target.pathname!=='/')
  fail('Ponte de terminal deve estar restrita ao loopback HTTP');
 if(typeof token!=='string'||token.length<32)fail('Token privado da ponte TEF obrigatório');
 if(typeof fetchImpl!=='function')fail('Transporte de terminal inválido');
 const call=async(path,body)=>{
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);
  try{
   const response=await fetchImpl(new URL(path,target),{
    method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
    body:JSON.stringify(body),signal:controller.signal,redirect:'error'
   });
   if(!response.ok)fail('Ponte TEF indisponível ou recusou operação');
   const responseBody=await response.text();
   if(responseBody.length>32768)fail('Resposta TEF excessiva');
   return JSON.parse(responseBody);
  }finally{clearTimeout(timeout);}
 };
 return Object.freeze({
  async create({requestId,amountCents,workOrderId}){
   const result=await call('/v1/payment/create',{requestId,amountCents,workOrderId});
   if(typeof result?.reference!=='string'||!result.reference.trim())fail('Referência TEF inválida');
   return {reference:result.reference};
  },
  async status(reference,{requestId}={}){
   const result=await call('/v1/payment/status',{reference,requestId});
   if(result?.reference!==reference||!['PENDING','PAID','FAILED'].includes(result?.status)||
     !Number.isSafeInteger(result?.amountCents))
    fail('Comprovante TEF inconsistente');
   return {reference,status:result.status,amountCents:result.amountCents};
  }
 });
}
