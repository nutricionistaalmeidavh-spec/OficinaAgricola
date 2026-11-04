import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,migrate} from '../src/db.js';
import {createUser} from '../src/auth.js';
import {createCustomer,createMachine} from '../src/services/catalog.js';
import {createWorkOrder,transitionWorkOrder} from '../src/services/work-orders.js';
import {migrateTenantRegistry,createTenantCompany,createTenantUnit} from '../src/platform/tenant-registry.js';
import {transferTenantWorkOrder,retryTenantWorkOrderTransfer} from '../src/platform/tenant-os-transfer.js';

function setup(){
 const legacy=openDatabase(':memory:');migrate(legacy);
 const actor=createUser(legacy,{username:'masteros',name:'Administrador',password:'StrongP@ss2026',role:'ADMIN'});
 const registry=openDatabase(':memory:');migrateTenantRegistry(registry,legacy);
 const company=createTenantCompany(registry,actor,{slug:'os-same-company',name:'Oficina com filiais'});
 const targetUnit=createTenantUnit(registry,actor,{companyId:company.id,code:'FILIAL',name:'Filial'});
 const foreign=createTenantCompany(registry,actor,{slug:'os-other-company',name:'Outra oficina'});
 const dbs=new Map([[1,legacy]]);
 for(const unitId of [company.unitId,targetUnit.id,foreign.unitId]){
  const db=openDatabase(':memory:');migrate(db);dbs.set(unitId,db);
 }
 const source=dbs.get(company.unitId),target=dbs.get(targetUnit.id);
 const customer=createCustomer(source,{name:'Cliente',phone:'16999999999',notes:'Anotações privadas'});
 const machine=createMachine(source,{customerId:customer.id,type:'AUTOMOVEL',brand:'Fiat',model:'Uno'});
 const os=createWorkOrder(source,{customerId:customer.id,machineId:machine.id,problemReported:'Revisão',diagnosis:'Checar freios'});
 return {actor,registry,dbs,company,targetUnit,foreign,source,target,os,
  unitRuntime:id=>({db:dbs.get(id)}),close(){for(const db of new Set(dbs.values()))db.close();registry.close();}};
}
test('early OS transfer preserves active work in target and closes original without copying financial ledgers',()=>{
 const s=setup();try{
  const params={registryDb:s.registry,unitRuntime:s.unitRuntime,actorUserId:s.actor,
    sourceUnitId:s.company.unitId,targetUnitId:s.targetUnit.id,workOrderId:s.os.id,
    legalBasis:'CONTRATO',recordReference:'OS-2026-TRANSFER-001',requestId:'os-transfer-001'};
  const first=transferTenantWorkOrder(params);
  assert.equal(first.status,'COMPLETED');
  assert.equal(s.source.prepare('SELECT status FROM work_orders WHERE id=?').get(s.os.id).status,'CANCELADA');
  const target=s.target.prepare('SELECT * FROM work_orders WHERE id=?').get(first.targetWorkOrderId);
  assert.equal(target.status,'ENTRADA');
  assert.equal(target.problem_reported,'Revisão');
  assert.equal(s.target.prepare('SELECT notes FROM customers WHERE id=?').get(target.customer_id).notes,'');
  assert.equal(s.source.prepare('SELECT COUNT(*) n FROM receipts').get().n,0);
  const replay=transferTenantWorkOrder(params);
  assert.equal(replay.targetWorkOrderId,first.targetWorkOrderId);
  assert.equal(replay.created,false);
  assert.equal(s.target.prepare('SELECT COUNT(*) n FROM work_orders').get().n,1);
  assert.equal(retryTenantWorkOrderTransfer({...params,transferId:first.transferId}).status,'COMPLETED');
 }finally{s.close();}
});
test('OS transfer blocks cross-company, missing justification and orders with financial or attachments',()=>{
 const s=setup();try{
  const base={registryDb:s.registry,unitRuntime:s.unitRuntime,actorUserId:s.actor,
    sourceUnitId:s.company.unitId,targetUnitId:s.targetUnit.id,workOrderId:s.os.id,
    requestId:'os-transfer-002',legalBasis:'CONTRATO',recordReference:'OS-TRANSFER-2026'};
  assert.throws(()=>transferTenantWorkOrder({...base,targetUnitId:s.foreign.unitId}),{status:403});
  assert.throws(()=>transferTenantWorkOrder({...base,recordReference:''}),/referência/i);
  s.source.prepare(`INSERT INTO expenses(description,amount_cents,work_order_id,created_at,updated_at)
    VALUES('Peça',2000,?,'2026-01-01','2026-01-01')`).run(s.os.id);
  assert.throws(()=>transferTenantWorkOrder(base),/vínculos|financeiros|anexos/i);
  assert.equal(s.target.prepare('SELECT COUNT(*) n FROM work_orders').get().n,0);
  assert.equal(s.source.prepare('SELECT status FROM work_orders WHERE id=?').get(s.os.id).status,'ENTRADA');
 }finally{s.close();}
});
test('OS transfer can preserve DIAGNOSTICO status and its creation audit trail',()=>{
 const s=setup();try{
  transitionWorkOrder(s.source,s.os.id,'DIAGNOSTICO');
  const transfer=transferTenantWorkOrder({registryDb:s.registry,unitRuntime:s.unitRuntime,actorUserId:s.actor,
    sourceUnitId:s.company.unitId,targetUnitId:s.targetUnit.id,workOrderId:s.os.id,
    legalBasis:'CONTRATO',recordReference:'OS-TRANSFER-2026',requestId:'os-transfer-003'});
  assert.equal(s.target.prepare('SELECT status FROM work_orders WHERE id=?').get(transfer.targetWorkOrderId).status,'DIAGNOSTICO');
  assert.equal(s.registry.prepare("SELECT COUNT(*) n FROM tenant_audit WHERE action='ORDER_TRANSFER_COMPLETED'").get().n,1);
 }finally{s.close();}
});
