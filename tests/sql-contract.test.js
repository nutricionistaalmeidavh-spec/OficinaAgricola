import test from 'node:test';
import assert from 'node:assert/strict';
import {assertCommonDataContract,COMMON_DATA_CONTRACT_METHODS} from '../src/platform/common-data-adapter.js';

const fake=engine=>({
 engine,
 all:async()=>[],first:async()=>null,run:async()=>({changes:0}),
 batch:async()=>[],transaction:async fn=>fn(fakeTx)
});
const fakeTx={all:async()=>[],first:async()=>null,run:async()=>({changes:0})};
test('canonical SQL contract requires the same async methods on every backend',()=>{
 assert.deepEqual([...COMMON_DATA_CONTRACT_METHODS],
  ['all','first','run','batch','transaction']);
 const pg=fake('postgres');
 assert.equal(assertCommonDataContract(pg,{interactiveTransactions:true}),pg);
 assert.equal(assertCommonDataContract(fake('sqlite'),{interactiveTransactions:true}).engine,'sqlite');
 assert.equal(assertCommonDataContract(fake('d1')).engine,'d1');
});
test('missing methods and unknown SQL backends fail closed',()=>{
 assert.throws(()=>assertCommonDataContract({engine:'postgres',run:async()=>{}}),/Contrato|contrato|método/i);
 assert.throws(()=>assertCommonDataContract(fake('auto')),/Engine|engine|suportado/i);
});
test('interactive transaction requirements must reject Cloudflare D1 batch semantics',()=>{
 assert.throws(()=>assertCommonDataContract(fake('d1'),{interactiveTransactions:true}),/D1|interativa|transaç/i);
 assert.throws(()=>assertCommonDataContract(fake('postgres'),{interactiveTransactions:'true'}),/boolean|booleana/i);
});
