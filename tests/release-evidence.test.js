import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateReleaseEvidence} from '../scripts/release-evidence.mjs';

const ok={status:'PASS',observedAt:'2026-11-03T18:00:00Z',evidenceRef:'QA-20261103-123'};
const base={version:'1.0.0',commit:'a'.repeat(40),
  automated:{ci:ok,qa:ok,windows:ok,backup:ok},
  manual:{
    fiscal:{nfe:{...ok,environment:'HOMOLOGACAO',authority:'SEFAZ',protocolRef:'protocolo-check-01'},
      nfse:{...ok,environment:'HOMOLOGACAO',authority:'MUNICIPIO',protocolRef:'protocolo-check-02'}},
    diagnostics:{...ok,mode:'REAL',adapter:'ELM327-USB',vehicleRef:'vehicle-anon-01'},
    printing:{...ok,mode:'REAL',printer:'USB-THERMAL-80',spoolRef:'spool-123-456'},
    disaster:{...ok,mode:'REAL',restoreRef:'restore-test-001'}
  }};

test('P1 - simulação não libera diagnóstico físico',()=>{
 const input=structuredClone(base);input.manual.diagnostics.mode='SIMULATED';
 assert.ok(evaluateReleaseEvidence(input,'diagnostics').errors.length>0);
});
test('P1 - protocolo fiscal não pode vir de ambiente de produção neste gate de homologação',()=>{
 const input=structuredClone(base);input.manual.fiscal.nfe.environment='PRODUCAO';
 assert.ok(evaluateReleaseEvidence(input,'fiscal').errors.length>0);
});
test('P1 - impressora física exige identificação da fila e resultado observável',()=>{
 const input=structuredClone(base);delete input.manual.printing.spoolRef;
 assert.ok(evaluateReleaseEvidence(input,'printing').errors.length>0);
});
test('P3 - prova completa aceita apenas conjunto explícito de testes',()=>{
 assert.deepEqual(evaluateReleaseEvidence(base,'full').errors,[]);
});
