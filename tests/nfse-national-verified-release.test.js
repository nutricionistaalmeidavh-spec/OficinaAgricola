import test from 'node:test';
import assert from 'node:assert/strict';
import {createFiscalEvidence,buildFiscalReleaseStatus} from '../src/platform/fiscal-release-gate.js';
const key='31062002211222333000181000000000012326111234567890';
const issuer={cnpj:'11222333000181',uf:'MG',municipalityIbge:'3106200',taxRegime:'SIMPLES',environment:'HOMOLOGACAO'};
const doc={id:1,kind:'NFSE',environment:'HOMOLOGACAO',issuer_snapshot_json:JSON.stringify(issuer)};
const xml='<NFSe><infNFSe Id="NFS'+key+'"><nNFSe>123</nNFSe><DPS><infDPS Id="DPS3106200211222333000181000010000000000000025"><tpAmb>2</tpAmb><prest><CNPJ>11222333000181</CNPJ></prest><serie>1</serie><nDPS>25</nDPS></infDPS></DPS></infNFSe></NFSe>';
test('retorno SEFIN homologado gera evidência por empresa',()=>{
 const proof=createFiscalEvidence({document:doc,
  result:{status:'AUTORIZADA',environment:'HOMOLOGACAO',accessKey:key,protocol:key,number:'123',series:'1',xml},
  providerName:'sefin-nacional-direta',certificateIdentity:'a'.repeat(64)});
 assert.equal(proof?.kind,'NFSE');
 assert.equal(proof?.provider_name,'sefin-nacional-direta');
});

test('o mesmo A1 e cadastro, após prova real, habilita somente NFS-e',()=>{
 const issuerSettings={enabled:1,issuer_cnpj:issuer.cnpj,issuer_uf:issuer.uf,
 municipality_ibge:issuer.municipalityIbge,tax_regime:issuer.taxRegime,
 environment:'PRODUCAO',production_confirmed:1};
 const proof=createFiscalEvidence({document:doc,result:{status:'AUTORIZADA',
 environment:'HOMOLOGACAO',accessKey:key,protocol:key,number:'123',series:'1',xml},
 providerName:'sefin-nacional-direta',certificateIdentity:'a'.repeat(64)});
 assert.ok(proof);
 const valid={...proof,status:'AUTORIZADA_HOMOLOGACAO',environment:'HOMOLOGACAO',
 access_key:key,protocol:key,authorized_xml:xml};
 const check=extra=>buildFiscalReleaseStatus({settings:issuerSettings,
 certificate:{configured:true,certificateType:'A1'},certificateIdentity:'a'.repeat(64),
 providerName:'sefin-nacional-direta',providerReady:true,proofs:[valid],...extra});
 assert.equal(check().models.NFSE.productionReady,true);
 assert.equal(check().models.NFE.productionReady,false);
 assert.equal(check().models.NFCE.productionReady,false);
 assert.equal(check({proofs:[]}).models.NFSE.productionReady,false);
 assert.equal(check({certificate:{configured:true,certificateType:'A3'}}).models.NFSE.productionReady,false);
 assert.equal(check({certificateIdentity:'b'.repeat(64)}).models.NFSE.productionReady,false);
 assert.equal(check({proofs:[{...valid,authorized_xml:'<outro/>'}]}).models.NFSE.productionReady,false);
 assert.equal(check({settings:{...issuerSettings,production_confirmed:0}}).models.NFSE.productionReady,false);
});
