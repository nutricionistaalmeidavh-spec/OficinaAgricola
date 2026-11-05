import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {assertMunicipalNfseProductionReady} from '../src/platform/fiscal-municipal-profile.js';

const issuer={cnpj:'11222333000181',municipalityIbge:'3106200',environment:'PRODUCAO'};
const profile={
 schemaVersion:1,municipalities:{
  '3106200':{
   issuerCnpj:'11222333000181',provider:'ACBR_NFSE',serviceCodes:['14.01'],
   reviewedAt:'2026-11-05',homologationEvidence:'PROTOCOLO-HOMOLOGACAO-REAL-001',
   authorizedBy:'responsavel-fiscal'
  }
 }
};
test('produção de NFS-e requer município, provedor e código de serviço vinculados ao emitente',()=>{
 const dir=mkdtempSync(join(tmpdir(),'nfse-profile-'));
 try{
  const path=join(dir,'municipal.json');writeFileSync(path,JSON.stringify(profile));
  assert.equal(assertMunicipalNfseProductionReady({path,issuer,serviceCode:'14.01',now:'2026-11-05'}).provider,'ACBR_NFSE');
  assert.throws(()=>assertMunicipalNfseProductionReady({path,issuer,serviceCode:'07.01',now:'2026-11-05'}),/serviço|município/i);
  assert.throws(()=>assertMunicipalNfseProductionReady({path,issuer:{...issuer,cnpj:'99888777000166'},serviceCode:'14.01',now:'2026-11-05'}),/CNPJ/i);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('sem evidência específica, catálogo municipal desatualizado ou ausente bloqueia produção',()=>{
 const dir=mkdtempSync(join(tmpdir(),'nfse-profile-'));
 try{
  const path=join(dir,'municipal.json');writeFileSync(path,JSON.stringify(profile));
  assert.throws(()=>assertMunicipalNfseProductionReady({path:'',issuer,serviceCode:'14.01',now:'2026-11-05'}),/municipal|configura/i);
  assert.throws(()=>assertMunicipalNfseProductionReady({path,issuer,serviceCode:'14.01',now:'2027-01-20'}),/desatualiz/i);
  const incomplete=structuredClone(profile);delete incomplete.municipalities['3106200'].homologationEvidence;
  writeFileSync(path,JSON.stringify(incomplete));
  assert.throws(()=>assertMunicipalNfseProductionReady({path,issuer,serviceCode:'14.01',now:'2026-11-05'}),/homologa|evidência/i);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
