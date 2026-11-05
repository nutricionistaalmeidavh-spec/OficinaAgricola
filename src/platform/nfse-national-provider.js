// Emissor NFS-e Nacional sem intermediário: SEFIN + certificado A1 self-hosted.
// Não cria DPS fictícia nem marca autorizada sem XML oficial íntegro.
import {createNationalNfseClient} from './nfse-national-api.js';
import {renderNationalDanfse} from './nfse-national-danfse.js';
import {createLocalNationalDpsStore} from './nfse-national-dps-store.js';
import {createLocalFiscalTaxStore} from './local-fiscal-tax-store.js';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {existsSync} from 'node:fs';
import {prepareNationalDpsInput} from './nfse-national-automatic.js';
import {buildNationalCancelRequest} from './nfse-national-cancellation.js';
import {attachNationalRtc} from './nfse-national-rtc.js';

async function loadNationalSdk(){
 try{
  const packaged=process.resourcesPath?join(process.resourcesPath,'nfse-national',
    'node_modules','@useinvio','nfse-sdk','dist','index.js'):null;
  return packaged&&existsSync(packaged)
    ?await import(pathToFileURL(packaged).href)
    :await import('@useinvio/nfse-sdk');
 }catch{throw Error('Módulo OSS NFS-e Nacional não disponível no instalador')}
}
export function createNationalNfseProvider({certificateStore,inputDir,client,danfseLogoPng}={}){
 if(!certificateStore||typeof certificateStore.withTlsIdentity!=='function')
   throw Error('NFS-e Nacional exige cofre de certificado A1 local');
 const dps=createLocalNationalDpsStore({directory:inputDir});
 const taxStore=createLocalFiscalTaxStore({directory:join(inputDir,'..','tributario'),inputDir});
 const api=client||createNationalNfseClient({certificateStore});
 const issuerFor=document=>JSON.parse(document?.issuer_snapshot_json||'{}');
 return Object.freeze({
  name:'sefin-nacional-direta',
  nfseChannel:'NACIONAL',
  nfseMunicipalityIbge:null,
  certificateStatus:()=>certificateStore.status(),
  certificateIdentity:()=>certificateStore.identity?.()||null,
  installCertificate:input=>certificateStore.install(input),
  listTaxProfiles:({issuer})=>taxStore.listProfiles({issuer}),
  saveTaxProfile:({issuer,profile})=>taxStore.saveProfile({issuer,profile}),
  prepareAutomaticNationalDps:async({document,issuer,profileId,customer,issuance}={})=>{
   const existing=dps.read({document,issuer});
   if(existing)return {prepared:true,idDps:existing.idDps,existing:true};
   if(certificateStore.status().certificateType!=='A1')
     throw Error('A geração automática da DPS exige certificado A1 instalado nesta empresa');
   const profiles=taxStore.listProfiles({issuer});
   const profile=profiles.find(x=>x.id===profileId&&x.kind==='SERVICE');
   if(!profile)throw Error('Selecione perfil tributário de serviço cadastrado nesta empresa');
   const prepared=prepareNationalDpsInput({document,issuer,profile,customer,issuance});
   const sdk=await loadNationalSdk();
   const built=sdk.buildDpsFromJson(prepared.payload);
   if(built.id!==prepared.idDps)throw Error('DPS gerada tem identificação divergente');
   const xmlSigned=await certificateStore.withTlsIdentity({cnpj:issuer.cnpj},identity=>{
     const material=sdk.loadPfxFromBuffer(identity.pfx,identity.passphrase);
     const signed=sdk.signDps(built.xml,prepared.idDps,material);
     if(!sdk.verifyDps(signed,material.certPem))
       throw Error('Assinatura XMLDSig local inválida: DPS não armazenada');
     return signed;
   });
   return {...dps.save({document,issuer,signedDpsXml:xmlSigned}),automatic:true};
  },
  saveNationalDps:args=>dps.save(args),
  nationalDpsStatus:args=>dps.status(args),
  prepare:({document,issuer})=>{
   if(document?.kind!=='NFSE')throw Error('SEFIN Nacional não emite NF-e/NFC-e de mercadorias');
   if(!dps.read({document,issuer}))throw Error('DPS assinada não preparada. Anexe XML assinado no rascunho antes de emitir');
   if(certificateStore.status().certificateType!=='A1')
     throw Error('SEFIN Nacional direta exige A1; token A3 utiliza ACBr');
  },
  transmit:async({document})=>{
   const issuer=issuerFor(document);
   const saved=dps.read({document,issuer});
   if(!saved)throw Error('DPS nacional não preparada');
   return api.issue({issuer,idDps:saved.idDps,signedDpsXml:saved.signedXml});
  },
  consult:async({document})=>{
   const issuer=issuerFor(document);
   const saved=dps.read({document,issuer});
   if(!saved)return {status:'INDETERMINADO',message:'DPS assinada não encontrada no backup local'};
   return api.reconcile({issuer,idDps:saved.idDps});
  },
  prepareCancellation:({document,issuer,reason}={})=>{
   if(document?.kind!=='NFSE'||issuer?.cnpj!==issuerFor(document).cnpj||
      issuer.environment!==document.environment||!document.access_key)
     throw Error('NFS-e de cancelamento não pertence ao emissor e ambiente');
   if(certificateStore.status().certificateType!=='A1')
     throw Error('Cancelamento SEFIN Nacional exige certificado A1');
   return buildNationalCancelRequest({issuer,accessKey:document.access_key,reason});
  },
  cancel:async({document,reason}={})=>{
   const issuer=issuerFor(document);
   const request=buildNationalCancelRequest({issuer,accessKey:document.access_key,reason});
   if(certificateStore.status().certificateType!=='A1')throw Error('A1 local obrigatório');
   const sdk=await loadNationalSdk();
   const signed=await certificateStore.withTlsIdentity({cnpj:issuer.cnpj},identity=>{
    const material=sdk.loadPfxFromBuffer(identity.pfx,identity.passphrase);
    return sdk.signEnveloped(request.xml,request.id,'infPedReg',material);
   });
   const accepted=await api.registerEvent({issuer,accessKey:document.access_key,signedEventXml:signed});
   if(accepted.status!=='EVENTO_RECEBIDO_PENDENTE_CONFIRMACAO')
     return {status:'INDETERMINADO',message:'SEFIN não confirmou o recebimento do evento'};
   return api.queryCancellation({issuer,accessKey:document.access_key});
  },
  consultCancellation:async({document}={})=>{
   const issuer=issuerFor(document);
   return api.queryCancellation({issuer,accessKey:document.access_key});
  },
  printPdf:async({document}={})=>{
   if(document?.kind!=='NFSE'||!['AUTORIZADA','AUTORIZADA_HOMOLOGACAO'].includes(document.status))
     throw Error('DANFSe exige NFS-e autorizada e não cancelada');
   if(!/^\d{50}$/.test(String(document.access_key||'')))
     throw Error('DANFSe exige chave oficial de acesso íntegra');
   const issuer=issuerFor(document);
   if(document.environment&&document.environment!==issuer.environment)
     throw Error('Ambiente do emissor divergente do documento autorizado');
   if(typeof document.authorized_xml!=='string'||!document.authorized_xml)
     throw Error('XML autorizado obrigatório para gerar DANFSe local');
   return renderNationalDanfse({xml:document.authorized_xml,accessKey:document.access_key,
     environment:issuer.environment,issuerCnpj:issuer.cnpj,logoPng:danfseLogoPng});
  }
 });
}
