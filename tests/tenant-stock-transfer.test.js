import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, migrate } from '../src/db.js';
import { createUser } from '../src/auth.js';
import { createTenantCompany, createTenantUnit, migrateTenantRegistry } from '../src/platform/tenant-registry.js';
import { createPart, addInventoryMovement, getPart, reconcileStock } from '../src/services/inventory.js';
import { transferTenantStock, retryTenantStockTransfer, listTenantStockTransfers } from '../src/platform/tenant-stock-transfer.js';

function setup(){
  const legacy=openDatabase(':memory:'); migrate(legacy);
  const actor=createUser(legacy,{username:'root-transfer',name:'Operador',password:'StrongP@ss2026',role:'ADMIN'});
  const registry=openDatabase(':memory:'); migrateTenantRegistry(registry,legacy);
  const company=createTenantCompany(registry,actor,{slug:'transfer-company',name:'Empresa com filiais'});
  const unit=createTenantUnit(registry,actor,{companyId:company.id,code:'NORTE',name:'Filial Norte'});
  const foreign=createTenantCompany(registry,actor,{slug:'foreign-company',name:'Empresa externa'});
  const databases=new Map([[1,legacy]]);
  for(const id of [company.unitId,unit.id,foreign.unitId]){
    const db=openDatabase(':memory:');migrate(db);databases.set(id,db);
  }
  const unitRuntime=id=>({db:databases.get(id)});
  const source=databases.get(company.unitId),destination=databases.get(unit.id);
  const part=createPart(source,{sku:'FILTRO-A',description:'Filtro hidráulico',salePriceCents:5000});
  const targetPart=createPart(destination,{sku:'FILTRO-A',description:'Filtro hidráulico',salePriceCents:5000});
  addInventoryMovement(source,part.id,{type:'ENTRADA',quantity:6});
  return {registry,databases,actor,company,unit,foreign,source,destination,part,targetPart,unitRuntime,
    close(){for(const db of new Set(databases.values()))db.close();registry.close();}};
}
test('transfers stock exactly once and records canonical outgoing and incoming ledgers',()=>{
  const s=setup();try{
    const params={registryDb:s.registry,unitRuntime:s.unitRuntime,actorUserId:s.actor,
      sourceUnitId:s.company.unitId,targetUnitId:s.unit.id,sourcePartId:s.part.id,requestId:'stock-transfer-001',quantity:2};
    const first=transferTenantStock(params);
    assert.equal(first.status,'COMPLETED');
    assert.equal(first.created,true);
    assert.equal(getPart(s.source,s.part.id).quantity,4);
    assert.equal(getPart(s.destination,s.targetPart.id).quantity,2);
    assert.equal(reconcileStock(s.source,s.part.id).difference,0);
    assert.equal(reconcileStock(s.destination,s.targetPart.id).difference,0);
    const again=transferTenantStock(params);
    assert.equal(again.status,'COMPLETED');
    assert.equal(again.created,false);
    assert.equal(again.transferId,first.transferId);
    assert.equal(getPart(s.source,s.part.id).quantity,4);
    assert.equal(getPart(s.destination,s.targetPart.id).quantity,2);
    assert.equal(s.source.prepare("SELECT COUNT(*) n FROM inventory_movements WHERE source_type='TENANT_TRANSFER_OUT'").get().n,1);
    assert.equal(s.destination.prepare("SELECT COUNT(*) n FROM inventory_movements WHERE source_type='TENANT_TRANSFER_IN'").get().n,1);
    assert.equal(listTenantStockTransfers({...params,companyId:s.company.id}).length,1);
    assert.throws(()=>transferTenantStock({...params,quantity:3}),{status:409});
  }finally{s.close();}
});
test('rejects foreign company, missing catalog match and insufficient quantity without debiting',()=>{
  const s=setup();try{
    const base={registryDb:s.registry,unitRuntime:s.unitRuntime,actorUserId:s.actor,
      sourceUnitId:s.company.unitId,sourcePartId:s.part.id,quantity:2,requestId:'stock-transfer-002'};
    assert.throws(()=>transferTenantStock({...base,targetUnitId:s.foreign.unitId}),{status:403});
    assert.throws(()=>transferTenantStock({...base,targetUnitId:s.unit.id,targetPartId:999}),{status:409});
    assert.throws(()=>transferTenantStock({...base,targetUnitId:s.unit.id,quantity:99}),/Estoque insuficiente/);
    assert.equal(getPart(s.source,s.part.id).quantity,6);
    assert.equal(getPart(s.destination,s.targetPart.id).quantity,0);
  }finally{s.close();}
});
test('recovers from partial transfer without double debit or double credit',()=>{
  const s=setup();try{
    const params={registryDb:s.registry,unitRuntime:s.unitRuntime,actorUserId:s.actor,
      sourceUnitId:s.company.unitId,targetUnitId:s.unit.id,sourcePartId:s.part.id,quantity:2,requestId:'stock-retry-003'};
    let targetCalls=0;
    const failOnce=id=>{
      if(id===s.unit.id&&++targetCalls===2)throw Error('Temporary target outage');
      return s.unitRuntime(id);
    };
    const interrupted=transferTenantStock({...params,unitRuntime:failOnce});
    assert.equal(interrupted.status,'PENDING');
    assert.equal(getPart(s.source,s.part.id).quantity,4);
    assert.equal(getPart(s.destination,s.targetPart.id).quantity,0);
    const finished=retryTenantStockTransfer({...params,transferId:interrupted.transferId});
    assert.equal(finished.status,'COMPLETED');
    assert.equal(getPart(s.source,s.part.id).quantity,4);
    assert.equal(getPart(s.destination,s.targetPart.id).quantity,2);
    assert.equal(reconcileStock(s.source,s.part.id).difference,0);
    assert.equal(reconcileStock(s.destination,s.targetPart.id).difference,0);
    const audit=s.registry.prepare("SELECT COUNT(*) n FROM tenant_audit WHERE action='STOCK_TRANSFER_COMPLETED'").get().n;
    assert.equal(audit,1);
  }finally{s.close();}
});
