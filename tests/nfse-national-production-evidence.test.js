import test from 'node:test';
import assert from 'node:assert/strict';
import {buildFiscalReleaseStatus} from '../src/platform/fiscal-release-gate.js';
test('não pode bloquear permanentemente NFS-e após evidência oficial verificada',()=>{
 const state=buildFiscalReleaseStatus({
  settings:{enabled:1,environment:'PRODUCAO',production_confirmed:1},
  certificate:{configured:true,certificateType:'A1'},
  certificateIdentity:'a'.repeat(64),
  providerName:'sefin-nacional-direta',providerReady:true,
  proofs:[]});
 assert.equal(state.models.NFSE.productionReady,false);
 assert.match(state.models.NFSE.reason,/homolog|prova|fiscal/i);
});
