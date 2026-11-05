import test from 'node:test';
import assert from 'node:assert/strict';
import {createFiscalEvidence} from '../src/platform/fiscal-release-gate.js';
const key='31062002211222333000181000000000012326111234567890';
const issuer={cnpj:'11222333000181',uf:'MG',municipalityIbge:'3106200',taxRegime:'SIMPLES'};
const doc={id:1,kind:'NFSE',environment:'HOMOLOGACAO',issuer_snapshot_json:JSON.stringify(issuer)};
const xml='<NFSe><infNFSe Id="NFS'+key+'"><nNFSe>123</nNFSe><DPS><infDPS Id="DPS3106200211222333000181000010000000000000025"><tpAmb>2</tpAmb><prest><CNPJ>11222333000181</CNPJ></prest><serie>1</serie><nDPS>25</nDPS></infDPS></DPS></infNFSe></NFSe>';
test('retorno SEFIN homologado gera evidência por empresa',()=>{
 const proof=createFiscalEvidence({document:doc,
  result:{status:'AUTORIZADA',environment:'HOMOLOGACAO',accessKey:key,protocol:key,number:'123',series:'1',xml},
  providerName:'sefin-nacional-direta',certificateIdentity:'a'.repeat(64)});
 assert.equal(proof?.kind,'NFSE');
 assert.equal(proof?.provider_name,'sefin-nacional-direta');
});
