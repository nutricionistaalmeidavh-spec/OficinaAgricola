// Perfis e revisões fiscais locais, isolados pelo diretório de cada empresa/unidade.
// Segredos A1/A3 não são armazenados aqui. Cada emissão congela sua revisão.
import {randomBytes} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,readFileSync,writeFileSync,renameSync,rmSync} from 'node:fs';
import {join,isAbsolute} from 'node:path';
import {validateTaxProfile,assembleAssistedTaxReview} from './fiscal-tax-review.js';
import {compileReviewedFiscalIni} from './fiscal-ini-preparer.js';

const fail=message=>{throw new Error(message)};
function regular(file){
 if(!existsSync(file))return false;
 const stat=lstatSync(file);
 if(!stat.isFile()||stat.isSymbolicLink())fail('Arquivo tributário local inseguro');
 return true;
}
function writeAtomic(file,data){
 const tmp=file+'.tmp-'+randomBytes(8).toString('hex');
 try{
   writeFileSync(tmp,JSON.stringify(data),{flag:'wx',mode:0o600});
   renameSync(tmp,file);
 }finally{if(existsSync(tmp))rmSync(tmp,{force:true});}
}
export function createLocalFiscalTaxStore({directory,inputDir}={}){
 if(!isAbsolute(directory||'')||!isAbsolute(inputDir||''))
   fail('Diretório fiscal privado obrigatório');
 mkdirSync(directory,{recursive:true,mode:0o700});
 if(lstatSync(directory).isSymbolicLink())fail('Diretório tributário inseguro');
 const profilesFile=join(directory,'profiles.json');
 const owner=issuer=>{
   const cnpj=String(issuer?.cnpj??'');
   if(!/^\d{14}$/.test(cnpj))fail('CNPJ do emitente obrigatório');
   return cnpj;
 };
 function load(issuer){
   const cnpj=owner(issuer);
   if(!regular(profilesFile))return {version:1,issuerCnpj:cnpj,profiles:[]};
   const stat=lstatSync(profilesFile);
   if(stat.size>512*1024)fail('Perfis tributários excedem limite');
   let parsed;
   try{parsed=JSON.parse(readFileSync(profilesFile,'utf8'));}catch{fail('Perfis tributários corrompidos');}
   if(parsed?.version!==1||!Array.isArray(parsed.profiles)||
      !/^\d{14}$/.test(parsed.issuerCnpj||''))
     fail('Arquivo de perfis tributários inválido');
   if(parsed.issuerCnpj!==cnpj)
     fail('Perfis tributários pertencem a outro CNPJ. Migração fiscal necessária');
   return parsed;
 }
 function listProfiles({issuer}={}){
   return load(issuer).profiles.map(p=>({...p}));
 }
 function saveProfile({issuer,profile}={}){
   const data=load(issuer);
   if(data.profiles.length>=200&&
      !data.profiles.some(p=>p.id===profile?.id))
     fail('Limite de perfis tributários atingido');
   const normalized=validateTaxProfile(profile,{issuer});
   if(!normalized.id)normalized.id='tax-'+randomBytes(8).toString('hex');
   const index=data.profiles.findIndex(p=>p.id===normalized.id);
   if(index===-1)data.profiles.push(normalized);
   else data.profiles[index]=normalized;
   writeAtomic(profilesFile,data);
   return normalized;
 }
 function paths(document){
   const hash=String(document?.snapshot_hash??'');
   if(!['NFE','NFCE'].includes(document?.kind)||
      !Number.isSafeInteger(Number(document.id))||Number(document.id)<1||
      !/^[a-f0-9]{64}$/.test(hash))fail('Documento fiscal inválido');
   const stem=document.kind+'-'+document.id+'-'+hash;
   return {review:join(inputDir,stem+'.review.json'),
     ini:join(inputDir,stem+'.ini'),manifest:join(inputDir,stem+'.json')};
 }
 function getDocumentReview({document,issuer}={}){
   const filenames=paths(document);
   if(!regular(filenames.review))return {reviewed:false};
   const raw=readFileSync(filenames.review,'utf8');
   if(Buffer.byteLength(raw)>1024*1024)fail('Revisão fiscal excede 1 MB');
   let review;
   try{review=JSON.parse(raw);}catch{fail('Revisão fiscal corrompida');}
   compileReviewedFiscalIni({document,issuer,review});
   return {reviewed:true,review,locked:regular(filenames.ini)||regular(filenames.manifest)};
 }
 function saveDocumentReview({document,issuer,company,customer,issuance,items}={}){
   if(document?.status!=='RASCUNHO')fail('Revisão bloqueada: documento já processado');
   const filenames=paths(document);
   if(regular(filenames.ini)||regular(filenames.manifest))
     fail('INI de emissão já preparado. Não sobrescrever revisão fiscal');
   const review=assembleAssistedTaxReview({document,issuer,company,customer,
     issuance,items,profiles:listProfiles({issuer})});
   const result=compileReviewedFiscalIni({document,issuer,review});
   if(Buffer.byteLength(result.ini)>1024*1024)fail('INI gerado excede limite');
   // O servidor nunca aceita seções INI arbitrárias do navegador.
   writeAtomic(filenames.review,review);
   return {reviewed:true,documentId:Number(document.id),snapshotHash:document.snapshot_hash};
 }
 return Object.freeze({listProfiles,saveProfile,getDocumentReview,saveDocumentReview});
}
