import test from 'node:test';
import assert from 'node:assert/strict';
import {selectManagedFiscalEngine} from '../src/platform/nfse-national-provider-selection.js';

test('em instalações locais o A1 habilita SEFIN direta somente para NFS-e',()=>{
 assert.equal(selectManagedFiscalEngine({kind:'NFSE',certificateType:'A1'}),'nacional');
 assert.equal(selectManagedFiscalEngine({kind:'NFSE',certificateType:'A3'}),'acbr');
 assert.equal(selectManagedFiscalEngine({kind:'NFSE',certificateType:null}),'acbr');
 for(const kind of ['NFE','NFCE'])assert.equal(
  selectManagedFiscalEngine({kind,certificateType:'A1'}),'acbr');
});
test('não permite rota de documento fiscal desconhecido',()=>{
 assert.throws(()=>selectManagedFiscalEngine({kind:'UNKNOWN',certificateType:'A1'}),/modelo/i);
});

test('documentos antigos preservam emissor original mesmo após mudança de certificado',()=>{
 assert.equal(selectManagedFiscalEngine({kind:'NFSE',certificateType:'A1',providerName:'acbrlib-local'}),'acbr');
 assert.equal(selectManagedFiscalEngine({kind:'NFSE',certificateType:'A3',providerName:'sefin-nacional-direta'}),'nacional');
});
