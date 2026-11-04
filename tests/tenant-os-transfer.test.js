import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,migrate} from '../src/db.js';
import {createUser} from '../src/auth.js';
import {createCustomer,createMachine} from '../src/services/catalog.js';
import {createWorkOrder,transitionWorkOrder} from '../src/services/work-orders.js';
import {migrateTenantRegistry,createTenantCompany,createTenantUnit} from '../src/platform/tenant-registry.js';
import {transferTenantWorkOrder,retryTenantWorkOrderTransfer,getTenantTransferDossier} from '../src/platform/tenant-os-transfer.js';
import {saveQuote,approveQuote} from '../src/services/quotes.js';
import {createPart,addInventoryMovement,consumePart} from '../src/services/inventory.js';
import {addReceipt} from '../src/services/finance.js';
import {createFiscalDraft} from '../src/services/fiscal.js';
import {saveAttachment} from '../src/services/operations.js';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

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
  assert.equal(s.source.prepare('SELECT status FROM work_orders WHERE id=?').get(s.os.id).status,'TRANSFERIDA');
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

test('complex OS handoff preserves original fiscal, stock, payments, quote and attachment ledgers without duplicated target entries',()=>{
 const s=setup(),dir=mkdtempSync(join(tmpdir(),'oficina-transfer-complex-'));
 try{
  transitionWorkOrder(s.source,s.os.id,'DIAGNOSTICO');
  const part=createPart(s.source,{sku:'BRAKE-001',description:'Pastilha',salePriceCents:4300});
  addInventoryMovement(s.source,part.id,{type:'ENTRADA',quantity:3});
  saveQuote(s.source,s.os.id,{items:[{kind:'PECA',description:'Pastilha',quantity:1,unitPriceCents:4300}]});
  approveQuote(s.source,s.os.id);
  consumePart(s.source,s.os.id,part.id,{quantity:1});
  const receipt=addReceipt(s.source,s.os.id,{amountCents:2000,method:'PIX',requestId:'os-complex-receipt'});
  const fiscal=createFiscalDraft(s.source,{originType:'OS',originId:s.os.id,kind:'NFE',requestId:'os-complex-fiscal'});
  const attachment=saveAttachment(s.source,s.os.id,{category:'DIAGNOSTICO',mimeType:'image/png',
    originalName:'evidencia.png',base64:Buffer.from('foto').toString('base64'),storageDir:dir});
  const params={registryDb:s.registry,unitRuntime:s.unitRuntime,actorUserId:s.actor,
    sourceUnitId:s.company.unitId,targetUnitId:s.targetUnit.id,workOrderId:s.os.id,
    legalBasis:'CONTRATO',recordReference:'OS-COMPLEXA-TRANSFERIDA-2026',requestId:'os-full-transfer'};
  const originalStock=s.source.prepare('SELECT quantity FROM parts WHERE id=?').get(part.id).quantity;
  const outcome=transferTenantWorkOrder(params);
  assert.equal(outcome.status,'COMPLETED');
  assert.equal(s.source.prepare('SELECT status FROM work_orders WHERE id=?').get(s.os.id).status,'TRANSFERIDA');
  assert.equal(s.source.prepare('SELECT quantity FROM parts WHERE id=?').get(part.id).quantity,originalStock);
  assert.equal(s.source.prepare('SELECT COUNT(*) n FROM receipts').get().n,1);
  assert.equal(s.source.prepare('SELECT COUNT(*) n FROM payment_events').get().n,1);
  assert.equal(s.source.prepare('SELECT COUNT(*) n FROM fiscal_documents').get().n,1);
  assert.equal(s.source.prepare('SELECT COUNT(*) n FROM attachments').get().n,1);
  assert.equal(s.target.prepare('SELECT COUNT(*) n FROM payment_events').get().n,0);
  assert.equal(s.target.prepare('SELECT COUNT(*) n FROM receipts').get().n,0);
  assert.equal(s.target.prepare('SELECT COUNT(*) n FROM fiscal_documents').get().n,0);
  assert.equal(s.target.prepare('SELECT COUNT(*) n FROM inventory_movements').get().n,0);
  assert.equal(s.target.prepare('SELECT COUNT(*) n FROM attachments').get().n,0);
  const dossier=getTenantTransferDossier({...params,transferId:outcome.transferId});
  assert.equal(dossier.sourceOrder.status,'TRANSFERIDA');
  assert.equal(dossier.quote.total_cents,4300);
  assert.equal(dossier.receipts[0].id,receipt.id);
  assert.equal(dossier.fiscalDocuments[0].id,fiscal.id);
  assert.equal(dossier.attachments[0].id,attachment.id);
  assert.equal(dossier.stockConsumptions.length,1);
  assert.equal(dossier.originUnitId,s.company.unitId);
  assert.equal(dossier.targetUnitId,s.targetUnit.id);
  assert.equal(dossier.authoritativeLedgers,'ORIGIN');
  const again=transferTenantWorkOrder(params);
  assert.equal(again.created,false);
  assert.equal(again.targetWorkOrderId,outcome.targetWorkOrderId);
  assert.equal(s.target.prepare('SELECT COUNT(*) n FROM work_orders').get().n,1);
 }finally{rmSync(dir,{recursive:true,force:true});s.close();}
});
