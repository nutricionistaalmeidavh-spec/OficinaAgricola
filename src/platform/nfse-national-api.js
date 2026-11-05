// Canal oficial e gratuito da SEFIN Nacional NFS-e (não confundir com API do ADN).
// Nunca enviar DPS sem assinatura, nunca repetir POST automaticamente.
import {request as httpsRequest} from 'node:https';
import {gzipSync,gunzipSync} from 'node:zlib';

const URLS=Object.freeze({
 HOMOLOGACAO:'https://sefin.producaorestrita.nfse.gov.br/SefinNacional',
 PRODUCAO:'https://sefin.nfse.gov.br/SefinNacional'
});
const MAX_XML=1024*1024,MAX_JSON=3*1024*1024;
const fail=message=>{throw new Error(message)};
const numbers=(v,length,label)=>{
 const str=String(v??'');
 if(!new RegExp('^\\d{'+length+'}$').test(str))fail(label+' inválido');
 return str;
};
const dpsId=value=>{
 const id=String(value??'');
 if(!/^DPS\d{42}$/.test(id))fail('Identificador DPS nacional inválido');
 return id;
};
const accessKey=value=>numbers(value,50,'Chave NFS-e');
export function buildNationalDpsId({municipalityIbge,cnpj,series,number}={}){
 const city=numbers(municipalityIbge,7,'Município IBGE');
 const federal=numbers(cnpj,14,'CNPJ');
 const serie=String(series??'');
 const num=String(number??'');
 if(!/^[1-9]\d{0,4}$/.test(serie)||!/^[1-9]\d{0,14}$/.test(num))
   fail('Série/número da DPS inválidos');
 return 'DPS'+city+'2'+federal+serie.padStart(5,'0')+num.padStart(15,'0');
}
export function nationalNfseEndpoint(environment){
 if(!Object.hasOwn(URLS,environment))fail('Ambiente da NFS-e Nacional inválido');
 return URLS[environment];
}
function signedDocument(xml,kind){
 if(typeof xml!=='string'||Buffer.byteLength(xml,'utf8')>MAX_XML||xml.length<80||
   /<!DOCTYPE|<!ENTITY/i.test(xml))fail('XML fiscal não suportado ou inseguro');
 if(!new RegExp('<(?:[A-Za-z0-9_]+:)?'+kind+'(?:\\s|>)').test(xml)||
   !/<(?:[A-Za-z0-9_]+:)?Signature(?:\s|>)/.test(xml))fail('XML fiscal precisa estar assinado');
 return xml;
}
function signedDps(xml,id,issuer){
 signedDocument(xml,'DPS');
 if(!xml.includes('Id="'+id+'"'))fail('DPS assinada não coincide com o identificador');
 if(!new RegExp('<(?:[A-Za-z0-9_]+:)?prest>\\s*<(?:[A-Za-z0-9_]+:)?CNPJ>'+issuer.cnpj+'<').test(xml))
   fail('CNPJ do prestador não corresponde à DPS');
}
function decodeXml(b64){
 if(typeof b64!=='string'||b64.length<16||b64.length>MAX_JSON||
   !/^[a-zA-Z0-9+/]+={0,2}$/.test(b64))fail('XML oficial compactado inválido');
 const zipped=Buffer.from(b64,'base64');
 if(zipped.toString('base64')!==b64)fail('Resposta GZip inválida');
 const xml=gunzipSync(zipped,{maxOutputLength:MAX_XML}).toString('utf8');
 if(/<!DOCTYPE|<!ENTITY/i.test(xml)||!/<(?:\w+:)?NFSe(?:\s|>)/.test(xml))
   fail('Resposta oficial não é XML NFS-e');
 return xml;
}
function confirmReceipt(body,{issuer,idDps,expectedKey}={}){
 const env=issuer.environment==='PRODUCAO'?1:2;
 if(!body||body.tipoAmbiente!==env)return {status:'INDETERMINADO',message:'Ambiente da resposta fiscal divergente'};
 const key=String(body.chaveAcesso??'');
 if(!/^\d{50}$/.test(key)||(expectedKey&&key!==expectedKey))
   return {status:'INDETERMINADO',message:'Chave de acesso inválida ou divergente'};
 if(idDps&&body.idDps&&body.idDps!==idDps)
   return {status:'INDETERMINADO',message:'DPS da resposta divergente'};
 let xml;
 try{xml=decodeXml(body.nfseXmlGZipB64)}catch{
   return {status:'INDETERMINADO',message:'XML oficial ausente ou inválido'};
 }
 const info=xml.match(/<(?:\w+:)?infNFSe\b[^>]*\bId="(NFS\d{50})"/);
 const num=xml.match(/<(?:\w+:)?nNFSe>([1-9]\d{0,12})<\/(?:\w+:)?nNFSe>/);
 const dps=xml.match(/<(?:\w+:)?infDPS\b[^>]*\bId="(DPS\d{42})"/);
 const serie=xml.match(/<(?:\w+:)?serie>([1-9]\d{0,4})<\/(?:\w+:)?serie>/);
 const prest=xml.match(/<(?:\w+:)?prest>\s*<(?:\w+:)?CNPJ>(\d{14})<\/(?:\w+:)?CNPJ>/);
 if(info?.[1]!=='NFS'+key||!num||!serie||!dps||!prest||
   (idDps&&dps[1]!==idDps)||prest[1]!==issuer.cnpj)
   return {status:'INDETERMINADO',message:'NFS-e retornada não corresponde à DPS/CNPJ/chave esperados'};
 return {status:'AUTORIZADA',environment:issuer.environment,
   accessKey:key,protocol:dps[1],number:num[1],series:String(Number(serie[1])),xml};
}
function rejection(body){
 const first=Array.isArray(body?.erros)?body.erros[0]||{}:{};
 const code=String(first.Codigo||first.codigo||'NFS_E_REJEITADA').slice(0,60);
 const message=String(first.Descricao||first.descricao||'DPS rejeitada pela SEFIN Nacional').slice(0,500);
 return {status:'REJEITADA',code,message};
}
async function nativeTransport({method,url,body,identity}){
 const target=new URL(url);
 if(target.protocol!=='https:'||!Object.values(URLS).some(base=>url.startsWith(base+'/')))
   fail('Destino nacional não autorizado');
 return new Promise((resolve,reject)=>{
  const params={method,hostname:target.hostname,port:443,path:target.pathname,
    timeout:30000,rejectUnauthorized:true,minVersion:'TLSv1.2',
    pfx:identity.pfx,passphrase:identity.passphrase,
    headers:{Accept:'application/json',...(body?{'Content-Type':'application/json; charset=utf-8',
     'Content-Length':Buffer.byteLength(body,'utf8')}:{})}};
  const req=httpsRequest(params,res=>{
   const chunks=[];let size=0;
   res.on('data',chunk=>{
    size+=chunk.length;
    if(size>MAX_JSON){req.destroy(Error('Resposta nacional excede 3 MB'));return;}
    chunks.push(chunk);
   });
   res.on('end',()=>{
    const raw=Buffer.concat(chunks).toString('utf8');let data;
    try{data=raw?JSON.parse(raw):{}}catch{return reject(Error('SEFIN devolveu resposta não JSON'))}
    resolve({status:res.statusCode,body:data,headers:res.headers});
   });
  });
  req.on('timeout',()=>req.destroy(Error('SEFIN Nacional demorou; consultar DPS antes de reenviar')));
  req.on('error',reject);
  req.end(body||undefined);
 });
}
export function createNationalNfseClient({certificateStore,transport=nativeTransport}={}){
 if(typeof certificateStore?.withTlsIdentity!=='function'||typeof transport!=='function')
   fail('API Nacional exige cofre A1 local e transporte autenticado');
 async function call(issuer,method,path,body){
  const base=nationalNfseEndpoint(issuer?.environment);
  numbers(issuer?.cnpj,14,'CNPJ prestador');
  if(typeof path!=='string'||!/^\/[a-z0-9/]+$/i.test(path))
    fail('Caminho SEFIN inválido');
  return certificateStore.withTlsIdentity({cnpj:issuer.cnpj},identity=>
    transport({url:base+path,method,body:body?JSON.stringify(body):null,identity}));
 }
 async function issue({issuer,idDps,signedDpsXml}={}){
  const id=dpsId(idDps);
  signedDps(signedDpsXml,id,issuer);
  const reply=await call(issuer,'POST','/nfse',{dpsXmlGZipB64:gzipSync(signedDpsXml).toString('base64')});
  if(reply.status===400)return rejection(reply.body);
  if(reply.status!==201)return {status:'INDETERMINADO',message:'Resposta de emissão não conclusiva: '+reply.status};
  return confirmReceipt(reply.body,{issuer,idDps:id});
 }
 async function queryNfse({issuer,accessKey:targetKey,idDps}={}){
  const key=accessKey(targetKey);
  const r=await call(issuer,'GET','/nfse/'+key);
  if(r.status!==200)return {status:'INDETERMINADO',message:'Consulta de NFS-e sem documento confirmado'};
  return confirmReceipt(r.body,{issuer,idDps,expectedKey:key});
 }
 async function reconcile({issuer,idDps}={}){
  const id=dpsId(idDps);
  const r=await call(issuer,'GET','/dps/'+id);
  if(r.status!==200||!r.body?.chaveAcesso)
    return {status:'INDETERMINADO',message:'Identificador DPS ainda sem chave fiscal confirmada'};
  return queryNfse({issuer,accessKey:r.body.chaveAcesso,idDps:id});
 }
 async function registerEvent({issuer,accessKey:targetKey,signedEventXml}={}){
  const key=accessKey(targetKey);
  signedDocument(signedEventXml,'pedRegEvento');
  const r=await call(issuer,'POST','/nfse/'+key+'/eventos',{
   pedidoRegistroEventoXmlGZipB64:gzipSync(signedEventXml).toString('base64')});
  // A resposta HTTP isolada não comprova o cancelamento fiscal.
  return {status:'EVENTO_RECEBIDO_PENDENTE_CONFIRMACAO',httpStatus:r.status};
 }
 return Object.freeze({issue,queryNfse,reconcile,registerEvent});
}
