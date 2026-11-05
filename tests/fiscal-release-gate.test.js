import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {issuerEvidenceDigest,buildFiscalReleaseStatus,createFiscalEvidence} from '../src/platform/fiscal-release-gate.js';

const settings={enabled:1,environment:'HOMOLOGACAO',issuer_cnpj:'11222333000181',
  issuer_uf:'SP',municipality_ibge:'3550308',tax_regime:'SIMPLES',
  state_registration:'123',municipal_registration:'123',production_confirmed:0};
const cert='a'.repeat(64);
const key='35111122233300018155001000000011000000001000';
const xml='<nfeProc><NFe><infNFe Id="NFe'+key+'"><ide><tpAmb>2</tpAmb></ide>'+
  '<emit><CNPJ>11222333000181</CNPJ></emit></infNFe></NFe>'+
  '<protNFe><infProt><cStat>100</cStat><chNFe>'+key+'</chNFe>'+
  '<nProt>1234567890</nProt></infProt></protNFe></nfeProc>';
const result={status:'AUTORIZADA',environment:'HOMOLOGACAO',accessKey:key,
  protocol:'1234567890',number:'1',series:'1',xml};
const document={id:34,kind:'NFE',environment:'HOMOLOGACAO',issuer_snapshot_json:JSON.stringify({
  cnpj:settings.issuer_cnpj,uf:settings.issuer_uf,
  municipalityIbge:settings.municipality_ibge,taxRegime:settings.tax_regime,
  stateRegistration:settings.state_registration,municipalRegistration:settings.municipal_registration,
  environment:'HOMOLOGACAO'
})};
const certificate={configured:true,certificateType:'A1'};
function proof(){
 const e=createFiscalEvidence({document,result,providerName:'acbrlib-local',certificateIdentity:cert});
 assert.ok(e);
 return {...e,status:'AUTORIZADA_HOMOLOGACAO',environment:'HOMOLOGACAO',
  access_key:result.accessKey,protocol:result.protocol,authorized_xml:result.xml};
}
test('somente XML homologado do ACBr com protocolo gera prova vinculada à unidade',()=>{
 const e=proof();
 assert.equal(e.kind,'NFE');
 assert.match(e.xml_digest,/^[a-f0-9]{64}$/);
 assert.equal(e.issuer_digest,issuerEvidenceDigest(settings));
 for(const change of [
  {result:{...result,xml:'<nfeProc />'}},
  {result:{...result,environment:'PRODUCAO'}},
  {providerName:'mock-provider'},
  {certificateIdentity:'invalido'}
 ])assert.equal(createFiscalEvidence({document,result,providerName:'acbrlib-local',
  certificateIdentity:cert,...change}),null);
});
test('sem prova, produção não pode ser liberada por checkbox ou conexão',()=>{
 const status=buildFiscalReleaseStatus({settings:{...settings,environment:'PRODUCAO',
  production_confirmed:1},certificate,certificateIdentity:cert,providerName:'acbrlib-local',proofs:[]});
 assert.equal(status.productionReady,false);
 assert.equal(status.models.NFE.productionReady,false);
 assert.equal(status.authorizationVerified,false);
 assert.equal(status.taxProfileVerified,false);
});
test('evidência sobrevivente por unidade habilita somente seu próprio modelo',()=>{
 const verified=buildFiscalReleaseStatus({settings:{...settings,environment:'PRODUCAO',
  production_confirmed:1},certificate,certificateIdentity:cert,
  providerName:'acbrlib-local',proofs:[proof()]});
 assert.equal(verified.models.NFE.productionReady,true);
 assert.equal(verified.models.NFCE.productionReady,false);
 assert.equal(verified.models.NFSE.productionReady,false);
 assert.equal(verified.authorizationVerified,true);
 assert.equal(verified.taxProfileVerified,true);
 assert.equal(verified.productionReady,true);
});
test('alterações no certificado ou emitente invalidam liberação sem apagar histórico',()=>{
 const e=proof();
 for(const changed of [
  {settings:{...settings,environment:'PRODUCAO',production_confirmed:1,issuer_uf:'PR'}},
  {settings:{...settings,environment:'PRODUCAO',production_confirmed:1,tax_regime:'NORMAL'}},
  {certificateIdentity:'b'.repeat(64)},
  {providerName:'outro'},
  {proofs:[{...e,authorized_xml:'<alterado/>'}]},
  {proofs:[{...e,status:'CANCELADA'}]}
 ]){
  const status=buildFiscalReleaseStatus({settings:{...settings,environment:'PRODUCAO',
   production_confirmed:1},certificate,certificateIdentity:cert,providerName:'acbrlib-local',
   proofs:[e],...changed});
  assert.equal(status.models.NFE.productionReady,false);
 }
});
test('SC PAF e RS pagamentos eletrônicos não são inferidos de homologação NFC-e',()=>{
 for(const uf of ['SC','RS']){
  const st={...settings,issuer_uf:uf,municipality_ibge:uf==='SC'?'4205407':'4314902',
   environment:'PRODUCAO',production_confirmed:1};
  const evidence={...proof(),kind:'NFCE',issuer_digest:issuerEvidenceDigest(st)};
  const state=buildFiscalReleaseStatus({settings:st,certificate,certificateIdentity:cert,
    providerName:'acbrlib-local',proofs:[evidence]});
  assert.equal(state.models.NFCE.productionReady,false);
  assert.match(state.models.NFCE.reason,/PAF|pagamento/i);
 }
});
