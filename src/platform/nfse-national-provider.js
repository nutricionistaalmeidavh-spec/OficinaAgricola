// Emissor NFS-e Nacional sem intermediário: SEFIN + certificado A1 self-hosted.
// Não cria DPS fictícia nem marca autorizada sem XML oficial íntegro.
import {createNationalNfseClient} from './nfse-national-api.js';
import {createLocalNationalDpsStore} from './nfse-national-dps-store.js';
import {createLocalFiscalTaxStore} from './local-fiscal-tax-store.js';
import {join} from 'node:path';

export function createNationalNfseProvider({certificateStore,inputDir,client}={}){
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
  installCertificate:input=>certificateStore.install(input),
  listTaxProfiles:({issuer})=>taxStore.listProfiles({issuer}),
  saveTaxProfile:({issuer,profile})=>taxStore.saveProfile({issuer,profile}),
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
  }
 });
}
