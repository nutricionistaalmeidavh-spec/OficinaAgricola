import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createLocalNationalDpsStore} from '../src/platform/nfse-national-dps-store.js';
import {createNationalNfseProvider} from '../src/platform/nfse-national-provider.js';
import {buildNationalDpsId} from '../src/platform/nfse-national-api.js';
import {mapLegacyNativeRoute} from '../src/platform/native-api-route-map.js';
import {requiredNativeRoles} from '../src/platform/async-workshop-policy.js';

const issuer={cnpj:'11222333000181',uf:'MG',municipalityIbge:'3106200',taxRegime:'SIMPLES',environment:'HOMOLOGACAO'};
const snapshot=JSON.stringify({kind:'NFSE',originType:'OS',originId:5,
 nfseRoute:{channel:'NACIONAL',municipalityIbge:'3106200',taxRegime:'SIMPLES',
 competenceDate:'2026-11-05'},lines:[{kind:'MAO_DE_OBRA',
 sourceItemId:44,subtotalCents:8000,discountCents:0,totalCents:8000}]});
const doc={id:54,kind:'NFSE',status:'RASCUNHO',snapshot_json:snapshot,
 snapshot_hash:createHash('sha256').update(snapshot).digest('hex'),
 amount_cents:8000,environment:'HOMOLOGACAO',issuer_snapshot_json:JSON.stringify(issuer)};
const idDps=buildNationalDpsId({municipalityIbge:'3106200',cnpj:issuer.cnpj,series:'1',number:'25'});
const signedXml='<DPS xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infDPS Id="'+idDps+'"><cLocEmi>3106200</cLocEmi><dCompet>2026-11-05</dCompet><serie>1</serie><nDPS>25</nDPS><prest><CNPJ>11222333000181</CNPJ></prest><vServ>80.00</vServ></infDPS><Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignatureValue>AQIDBA==</SignatureValue></Signature></DPS>';
test('DPS preparada fica imutável e isolada pelo hash/cadastro fiscal da unidade',()=>{
 const root=mkdtempSync(join(tmpdir(),'sefin-national-'));
 try{
  const store=createLocalNationalDpsStore({directory:root});
  assert.equal(store.status({document:doc,issuer}).prepared,false);
  assert.deepEqual(store.save({document:doc,issuer,signedDpsXml:signedXml}),{prepared:true,idDps});
  assert.equal(store.status({document:doc,issuer}).idDps,idDps);
  assert.equal(store.read({document:doc,issuer}).signedXml,signedXml);
  assert.throws(()=>store.save({document:doc,issuer,
    signedDpsXml:signedXml.replace('AQIDBA==','AQQBA==')}),/preparada|sobrescrev/i);
  assert.throws(()=>store.read({document:doc,issuer:{...issuer,cnpj:'12345678000190'}}),/CNPJ|prestador|diverge/i);
  assert.throws(()=>store.save({document:{...doc,status:'INDETERMINADO'},issuer,signedDpsXml:signedXml}),/rascunho/i);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('DPS não pode trocar competência, município, valor, identificador ou origem comercial',()=>{
 const root=mkdtempSync(join(tmpdir(),'sefin-national-'));
 try{
  const store=createLocalNationalDpsStore({directory:root});
  assert.throws(()=>store.save({document:doc,issuer,
    signedDpsXml:signedXml.replace('<vServ>80.00','<vServ>90.00')}),/valor|divergente/i);
  assert.throws(()=>store.save({document:doc,issuer,
    signedDpsXml:signedXml.replace('<dCompet>2026-11-05','<dCompet>2026-11-04')}),/competência/i);
  assert.throws(()=>store.save({document:doc,issuer,
    signedDpsXml:signedXml.replace('<nDPS>25','<nDPS>26')}),/identificador/i);
  assert.throws(()=>store.save({document:{...doc,snapshot_hash:'f'.repeat(64)},issuer,signedDpsXml:signedXml}),/Snapshot/i);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('emissor direto não inicia transmissão sem DPS e nunca tenta simular A3',async()=>{
 const root=mkdtempSync(join(tmpdir(),'sefin-national-'));
 const cert={withTlsIdentity:async()=>{},status:()=>({certificateType:'A1'}),install:()=>{}};
 let issues=0;const api={issue:async()=>{issues++;return {status:'AUTORIZADA'};},reconcile:async()=>({status:'INDETERMINADO'})};
 try{
  const provider=createNationalNfseProvider({inputDir:root,certificateStore:cert,client:api});
  assert.equal(provider.nfseChannel,'NACIONAL');
  assert.throws(()=>provider.prepare({document:doc,issuer}),/DPS assinada/);
  provider.saveNationalDps({document:doc,issuer,signedDpsXml:signedXml});
  provider.prepare({document:doc,issuer});
  await provider.transmit({document:doc});
  assert.equal(issues,1);
  assert.throws(()=>provider.prepare({document:{...doc,kind:'NFE'},issuer}),/NF-e|NFCE/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('rotas de DPS têm ACL admin e apontam para serviço privado por documento',()=>{
 const get=mapLegacyNativeRoute('GET','/api/fiscal/54/nfse/dps');
 const post=mapLegacyNativeRoute('POST','/api/fiscal/54/nfse/dps');
 assert.equal(get?.path,'/v1/fiscal/54/nfse/dps');
 assert.equal(post?.path,get?.path);
 assert.ok(requiredNativeRoles('GET',get.path).includes('ADMIN'));
 assert.ok(requiredNativeRoles('POST',post.path).includes('ADMIN'));
 assert.equal(mapLegacyNativeRoute('POST','/api/fiscal/abc/nfse/dps'),null);
});
