import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {openDatabase,migrate} from '../src/db.js';

test('P1: consulta indexada de OS por status e ID usa plano otimizado',()=>{
 const db=openDatabase(':memory:');
 try{
  migrate(db);
  const plan=db.prepare("EXPLAIN QUERY PLAN SELECT id FROM work_orders WHERE status='ENTRADA' ORDER BY id DESC LIMIT 50")
   .all().map(x=>x.detail).join(' ');
  assert.match(plan,/USING.*INDEX/i);
 }finally{db.close();}
});

test('P3: benchmark offline com 1.000 registros registra p50, p95, plano e integridade',()=>{
 const run=spawnSync(process.execPath,['scripts/benchmark-db.mjs','--size=1000'],{
  encoding:'utf8',timeout:120000,env:{...process.env,NODE_NO_WARNINGS:'1'}
 });
 assert.equal(run.status,0,run.stderr||run.stdout);
 const result=JSON.parse(run.stdout);
 assert.equal(result.size,1000);
 assert.equal(result.quickCheck,'ok');
 assert.ok(result.approxDbBytes>0);
 assert.ok(result.workOrdersPlan.length>0);
 for(const metric of Object.values(result.metrics)){
  assert.ok(Number.isFinite(metric.p50Ms));
  assert.ok(Number.isFinite(metric.p95Ms));
  assert.ok(metric.p95Ms>=metric.p50Ms);
 }
});
