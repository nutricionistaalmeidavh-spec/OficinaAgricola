// Ativação comercial opcional do instalador distribuído. O core MIT nunca exige
// Cloudflare, chave de licença ou serviço pago para iniciar.
import {randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';

const PRODUCT='OFICINA';
const REFRESH_MS=15*60*1000;
const DEFAULT_ENDPOINT='https://pdv-artisys.sistema-artisys.workers.dev';
const emailOk=value=>typeof value==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim().toLowerCase());
const dateOk=value=>value===null||(typeof value==='string'&&!Number.isNaN(Date.parse(value)));
const result=(state,{offline=false,at=Date.now()}={})=>({
 required:true,active:Boolean(state.active&&state.licenseId&&
   (!state.expiresAt||Date.parse(state.expiresAt)>at)),
 offline,expiresAt:state.expiresAt||null
});

export function createOficinaCommercialLicense({
 required=false,root,endpoint=DEFAULT_ENDPOINT,fetchImpl=fetch,now=Date.now
}={}){
 if(!required)return Object.freeze({
  required:false,
  status:async()=>({required:false,active:true,offline:false}),
  activate:async()=>{throw Object.assign(Error('Licenciamento comercial não habilitado'),{status:404});}
 });
 if(!root||typeof root!=='string')throw Error('Diretório local de licença não definido');
 const origin=new URL(endpoint);
 if(origin.protocol!=='https:'||origin.pathname!=='/'||origin.search||origin.hash||
    origin.username||origin.password)throw Error('Central de licenças deve ser HTTPS com origem explícita');
 const path=join(root,'oficina-commercial-license.json');
 let statePromise;
 const save=async data=>{
  await mkdir(root,{recursive:true,mode:0o700});
  const temp=path+'.'+randomUUID()+'.tmp';
  await writeFile(temp,JSON.stringify(data),{mode:0o600,flag:'wx'});
  await rename(temp,path);
  return data;
 };
 async function load(){
  try{
   const data=JSON.parse(await readFile(path,'utf8'));
   if(!/^oficina-[a-f0-9-]{36}$/.test(data.installationId)||
      (data.licenseId!=null&&typeof data.licenseId!=='string')||
      !dateOk(data.expiresAt??null))throw Error('Arquivo de licença corrompido');
   return data;
  }catch(error){
   if(error.code!=='ENOENT')throw error;
   return save({installationId:'oficina-'+randomUUID(),licenseId:null,active:false,
     accountEmail:null,expiresAt:null,checkedAt:0});
  }
 }
 const get=()=>statePromise??=(load());
 async function remote(pathname,{method='GET',body}={}){
  const response=await fetchImpl(origin.origin+pathname,{
   method,redirect:'error',signal:AbortSignal.timeout(6000),
   ...(body?{headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})
  });
  if(!response.ok){
   let message='Central de licenças indisponível ('+response.status+')';
   try{const data=await response.json();if(typeof data?.error==='string'&&data.error.length<200)message=data.error;}catch{}
   throw Object.assign(Error(message),{status:response.status>=400&&response.status<500?response.status:503});
  }
  return response.json();
 }
 async function status(){
  const state=await get();
  if(!state.licenseId)return result(state,{at:now()});
  if(Number.isFinite(state.checkedAt)&&now()-state.checkedAt<REFRESH_MS)
   return {...result(state,{at:now()}),offline:false};
  const query=new URLSearchParams({installationId:state.installationId,product:PRODUCT});
  let data;
  try{data=await remote('/v1/license/status?'+query);}
  catch(error){
   // Queda de rede/5xx: respeitar último estado local ativo. Respostas 4xx
   // explícitas de credencial ou instalação inválida não autorizam uso offline.
   if(!error.status||error.status>=500||error.status===429)
    return {...result(state,{at:now()}),offline:true};
   const revoked={...state,active:false,checkedAt:now()};
   try{statePromise=Promise.resolve(await save(revoked));}
   catch{statePromise=Promise.resolve(revoked);}
   return result(revoked,{at:now()});
  }
  if(data.product!==PRODUCT||typeof data.active!=='boolean'||!dateOk(data.expiresAt??null)){
   // Não interpretar resposta incompatível com PDV como simples falta de rede.
   const invalid={...state,active:false,checkedAt:now()};
   try{statePromise=Promise.resolve(await save(invalid));}
   catch{statePromise=Promise.resolve(invalid);}
   return result(invalid,{at:now()});
  }
  const next={...state,active:data.active,expiresAt:data.expiresAt||null,checkedAt:now()};
  try{statePromise=Promise.resolve(await save(next));}
  catch{
   statePromise=Promise.resolve({...next,active:false});
   return result({...next,active:false},{at:now()});
  }
  return result(next,{at:now()});
 }
 async function activate({email,code}={}){
  const accountEmail=String(email||'').trim().toLowerCase();
  if(!emailOk(accountEmail))throw Object.assign(Error('E-mail inválido'),{status:400});
  if(!/^\d{6}$/.test(String(code||'')))throw Object.assign(Error('Código de 6 dígitos obrigatório'),{status:400});
  const state=await get();
  const data=await remote('/v1/activation/verify',{method:'POST',body:{
   product:PRODUCT,email:accountEmail,code:String(code),installationId:state.installationId
  }});
  if(data.product!==PRODUCT||typeof data.licenseId!=='string'||!data.licenseId||
     String(data.accountEmail||'').toLowerCase()!==accountEmail||
     !dateOk(data.expiresAt??null))throw Error('Central retornou licença incompatível com Oficina');
  const next={installationId:state.installationId,licenseId:data.licenseId,
    accountEmail,active:true,expiresAt:data.expiresAt||null,checkedAt:now()};
  statePromise=Promise.resolve(await save(next));
  return result(next,{at:now()});
 }
 return Object.freeze({required:true,status,activate});
}
