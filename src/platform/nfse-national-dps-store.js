// DPS assinada revisada por documento, confinada à pasta privada da unidade.
// Nunca aceita XML de outras empresas, alterações do snapshot ou fontes remotas.
import {createHash,randomBytes} from 'node:crypto';
import {existsSync,lstatSync,readFileSync,writeFileSync,renameSync,rmSync,mkdirSync} from 'node:fs';
import {isAbsolute,join} from 'node:path';
import {buildNationalDpsId} from './nfse-national-api.js';

const MAX_XML=512*1024;
const fail=m=>{throw new Error(m)};
const text=(v,name,re)=>{
 const s=String(v??'').trim();
 if(!re.test(s))fail(name+' inválido');return s;
};
const tag=(xml,name)=>{
 const match=xml.match(new RegExp('<(?:\\w+:)?'+name+'>([^<]*)<\\/(?:\\w+:)?'+name+'>'));
 return match?.[1]?.trim()||'';
};
function regular(file){
 if(!existsSync(file))return false;
 const stat=lstatSync(file);
 if(!stat.isFile()||stat.isSymbolicLink())fail('Arquivo DPS inseguro');
 if(stat.size>MAX_XML*2)fail('DPS acima do limite');
 return true;
}
export function createLocalNationalDpsStore({directory}={}){
 if(!isAbsolute(directory||''))fail('Pasta nacional da unidade deve ser absoluta');
 mkdirSync(directory,{recursive:true,mode:0o700});
 if(lstatSync(directory).isSymbolicLink())fail('Pasta nacional insegura');
 const path=doc=>{
  if(doc?.kind!=='NFSE'||!Number.isSafeInteger(Number(doc.id))||Number(doc.id)<1||
     !/^[a-f0-9]{64}$/.test(String(doc.snapshot_hash||'')))
    fail('Rascunho NFS-e inválido');
  return join(directory,'NFSE-'+doc.id+'-'+doc.snapshot_hash+'.signed-dps.json');
 };
 function check(document,issuer){
  if(document?.kind!=='NFSE')fail('Importação de DPS somente para NFS-e');
  const raw=String(document.snapshot_json||'');
  if(createHash('sha256').update(raw).digest('hex')!==document.snapshot_hash)
    fail('Snapshot canônico NFS-e alterado');
  let snapshot;try{snapshot=JSON.parse(raw)}catch{fail('Snapshot NFS-e inválido')}
  if(snapshot?.nfseRoute?.channel!=='NACIONAL'||
     snapshot.nfseRoute.municipalityIbge!==issuer?.municipalityIbge)
    fail('DPS exige canal nacional e município correto');
  if(document.environment!==issuer.environment)fail('Ambiente NFS-e divergente');
  return snapshot;
 }
 function validateSigned({document,issuer,signedDpsXml}){
  const snapshot=check(document,issuer);
  const xml=String(signedDpsXml||'');
  if(Buffer.byteLength(xml,'utf8')>MAX_XML||xml.length<120||
     /<!DOCTYPE|<!ENTITY/i.test(xml)||!/<(?:\w+:)?DPS(?:\s|>)/.test(xml)||
     !/<(?:\w+:)?Signature(?:\s|>)/.test(xml)||
     !/<(?:\w+:)?SignatureValue>[^<]+<\/(?:\w+:)?SignatureValue>/.test(xml))
    fail('DPS deve ser XML assinado no leiaute nacional');
  if(tag(xml,'CNPJ')!==issuer.cnpj)fail('CNPJ do prestador não corresponde à DPS');
  if(tag(xml,'dCompet')!==snapshot.nfseRoute.competenceDate)
    fail('Competência da DPS difere do documento');
  if(tag(xml,'cLocEmi')!==issuer.municipalityIbge)
    fail('Município emissor da DPS difere do cadastro');
  const expected=buildNationalDpsId({municipalityIbge:issuer.municipalityIbge,
    cnpj:issuer.cnpj,series:tag(xml,'serie'),number:tag(xml,'nDPS')});
  const actual=xml.match(/<(?:\w+:)?infDPS\b[^>]*\bId="(DPS\d{42})"/)?.[1];
  if(actual!==expected)fail('Identificador DPS não corresponde à série/número/CNPJ/município');
  const money=tag(xml,'vServ');
  if(!/^(?:0|[1-9]\d{0,9})\.\d{2}$/.test(money))
    fail('Valor dos serviços DPS inválido');
  const gross=snapshot.lines?.reduce((s,l)=>s+Number(l.subtotalCents),0);
  const discount=snapshot.lines?.reduce((s,l)=>s+Number(l.discountCents),0);
  if(discount!==0||!Number.isSafeInteger(gross)||gross!==document.amount_cents||
     Number(money.replace('.',''))!==gross)
    fail('DPS nacional com desconto ou valor divergente exige revisão fiscal específica');
  return {idDps:actual,xml};
 }
 function read({document,issuer}={}){
  check(document,issuer);
  const file=path(document);
  if(!regular(file))return null;
  let value;try{value=JSON.parse(readFileSync(file,'utf8'))}catch{fail('DPS local inválida')}
  if(value?.version!==1||value.snapshotHash!==document.snapshot_hash||
    value.documentId!==Number(document.id)||value.issuerCnpj!==issuer.cnpj||
    value.environment!==issuer.environment||typeof value.signedXml!=='string')
    fail('DPS local diverge do documento e emitente');
  const validated=validateSigned({document,issuer,signedDpsXml:value.signedXml});
  if(value.idDps!==validated.idDps)fail('Identificador DPS não íntegro');
  return {idDps:validated.idDps,signedXml:value.signedXml};
 }
 function save({document,issuer,signedDpsXml}={}){
  if(document?.status!=='RASCUNHO')fail('Somente rascunho permite preparar DPS');
  const checked=validateSigned({document,issuer,signedDpsXml});
  const file=path(document),old=read({document,issuer});
  if(old){if(old.signedXml===checked.xml)return {prepared:true,idDps:old.idDps};
    fail('DPS já preparada: não sobrescrever. Corrija o rascunho antes de reemitir');}
  const info={version:1,documentId:Number(document.id),
    snapshotHash:document.snapshot_hash,issuerCnpj:issuer.cnpj,
    environment:issuer.environment,idDps:checked.idDps,signedXml:checked.xml};
  const tmp=file+'.tmp-'+randomBytes(8).toString('hex');
  try{writeFileSync(tmp,JSON.stringify(info),{mode:0o600,flag:'wx'});
    // Evitar sobrescrever outra sessão.
    if(regular(file))fail('DPS já preparada por outra sessão');
    renameSync(tmp,file);
  }finally{if(existsSync(tmp))rmSync(tmp,{force:true});}
  return {prepared:true,idDps:checked.idDps};
 }
 function status({document,issuer}={}){
  const v=read({document,issuer});
  return v?{prepared:true,idDps:v.idDps}:{prepared:false};
 }
 return Object.freeze({save,read,status});
}
