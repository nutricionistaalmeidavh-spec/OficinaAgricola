import test from 'node:test';
import assert from 'node:assert/strict';
import {FISCAL_UFS,assertFiscalIssuerUf,assertReviewedFiscalUf} from '../src/platform/fiscal-uf.js';
const ibges={SP:'3550308',PR:'4106902',MG:'3106200',RJ:'3304557',SC:'4205407',RS:'4314902'};
test('as seis UFs têm cUF, município compatível e fonte oficial',()=>{
  assert.deepEqual(Object.keys(FISCAL_UFS).sort(),Object.keys(ibges).sort());
  for(const [uf,municipalityIbge] of Object.entries(ibges)){
    const profile=assertFiscalIssuerUf({uf,municipalityIbge});
    assert.match(profile.code,/^\\d{2}$/);
    assert.ok(profile.official.startsWith('https://'));
    assert.throws(()=>assertFiscalIssuerUf({uf,municipalityIbge:'9999999'}),/IBGE/);
  }
  assert.throws(()=>assertFiscalIssuerUf({uf:'BA',municipalityIbge:'2927408'}),/SP, PR, MG, RJ, SC e RS/);
});
test('modelo, ambiente e parâmetros NFC-e são vinculados ao emitente',()=>{
  for(const [uf,municipalityIbge] of Object.entries(ibges)){
    const issuer={uf,municipalityIbge,environment:'HOMOLOGACAO'};
    const base={cUF:FISCAL_UFS[uf].code,cMunFG:municipalityIbge,mod:'65',tpAmb:'2',idDest:'1',indFinal:'1',indPres:'1',tpEmis:'1'};
    assertReviewedFiscalUf({kind:'NFCE',issuer,sections:{Identificacao:base,Pagamento001:{tPag:'01',vPag:'1.00'}}});
    assert.throws(()=>assertReviewedFiscalUf({kind:'NFE',issuer,sections:{Identificacao:base}}),/Modelo/);
    assert.throws(()=>assertReviewedFiscalUf({kind:'NFCE',issuer,sections:{Identificacao:{...base,tpEmis:'9'},Pagamento001:{}}}),/Contingência/);
    assert.throws(()=>assertReviewedFiscalUf({kind:'NFCE',issuer,sections:{Identificacao:base}}),/pagamento/);
  }
});
