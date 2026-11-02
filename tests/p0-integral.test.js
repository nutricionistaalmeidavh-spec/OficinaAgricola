import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase,migrate} from '../src/db.js';
import {migrateAssistencia} from '../src/assistencia-schema.js';
import {createCustomer,createMachine,createTechnician} from '../src/services/catalog.js';
import {createWorkOrder, getWorkOrder} from '../src/services/work-orders.js';
import {addInventoryMovement,createPart,consumePart,reconcileStock} from '../src/services/inventory.js';
import {addCashMovement,openCashSession} from '../src/services/sales.js';
import {createExpense} from '../src/services/finance.js';
import {createScheduleEvent,updateScheduleEvent,createChecklistTemplate,createWorkOrderChecklist,saveAttachment} from '../src/services/operations.js';
import {enqueueHttpEvent,dispatchOutbox,unpublishedOutbox} from '../src/platform/outbox.js';
import {auditInvariants} from '../src/services/reconciliation.js';

function context(){
 const db=openDatabase(':memory:');migrate(db);migrateAssistencia(db);
 const c=createCustomer(db,{name:'Cliente P0'});
 const other=createCustomer(db,{name:'Outro cliente'});
 const machine=createMachine(db,{customerId:c.id,type:'Carro',plate:'ABC1D23',vin:'9BWZZZ377VT004251',odometerKm:18000});
 const alien=createMachine(db,{customerId:other.id,type:'Carro'});
 const technician=createTechnician(db,{name:'Técnico'});
 const os=createWorkOrder(db,{customerId:c.id,machineId:machine.id,problemReported:'Diagnóstico'});
 const part=createPart(db,{sku:'P0-PECA',description:'Filtro',salePriceCents:2000});
 return{db,c,other,machine,alien,technician,os,part};
}
test('P0: requisições repetidas com mesmo requestId são idempotentes em estoque, OS, caixa e despesa',()=>{
 const x=context();const {db,os,part}=x;
 try{
  const entry={type:'ENTRADA',quantity:10,requestId:'in-stock-1'};
  const a=addInventoryMovement(db,part.id,entry);
  assert.equal(addInventoryMovement(db,part.id,entry).id,a.id);
  assert.throws(()=>addInventoryMovement(db,part.id,{...entry,quantity:11}),/identificador|dados diferentes/i);
  assert.equal(reconcileStock(db,part.id).difference,0);
  db.prepare("UPDATE work_orders SET status='APROVADA' WHERE id=?").run(os.id);
  const c=consumePart(db,os.id,part.id,{quantity:2,requestId:'consume-1'});
  assert.equal(consumePart(db,os.id,part.id,{quantity:2,requestId:'consume-1'}).id,c.id);
  assert.equal(db.prepare('SELECT quantity FROM parts WHERE id=?').get(part.id).quantity,8);
  const cash=openCashSession(db,{openingCents:0});
  const movement=addCashMovement(db,{type:'SUPRIMENTO',amountCents:5000,requestId:'cash-1'});
  assert.equal(addCashMovement(db,{type:'SUPRIMENTO',amountCents:5000,requestId:'cash-1'}).id,movement.id);
  const expense=createExpense(db,{description:'Parafusos',amountCents:600,requestId:'expense-1'});
  assert.equal(createExpense(db,{description:'Parafusos',amountCents:600,requestId:'expense-1'}).id,expense.id);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM inventory_movements').get().n,2);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM cash_movements').get().n,1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM expenses').get().n,1);
 }finally{db.close()}
});

test('P0: outbox persiste no mesmo banco, tem chave única por ocorrência, recupera falha e faz replay seguro',async()=>{
 const {db,os}=context();
 try{
  const result=getWorkOrder(db,os.id);
  enqueueHttpEvent(db,'POST','/api/work-orders',result);
  enqueueHttpEvent(db,'POST','/api/work-orders',result);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM domain_outbox').get().n,1);
  let fail=true;const delivered=[];
  const runtime={async deliver(event){if(fail)throw new Error('offline');delivered.push(event);}};
  assert.equal(await dispatchOutbox(db,runtime),0);
  assert.equal(unpublishedOutbox(db).length,1);
  fail=false;
  assert.equal(await dispatchOutbox(db,runtime),1);
  assert.equal(await dispatchOutbox(db,runtime),0);
  assert.equal(delivered.length,1);
  assert.equal(unpublishedOutbox(db).length,0);
 }finally{db.close()}
});

test('P0: reconciliação identifica divergência real em estoque, pagamentos e caixa',()=>{
 const {db,part}=context();
 try{
   addInventoryMovement(db,part.id,{type:'ENTRADA',quantity:4});
   openCashSession(db,{openingCents:0});
   assert.equal(auditInvariants(db).errors.length,0);
   db.prepare('UPDATE parts SET quantity=quantity+3 WHERE id=?').run(part.id);
   assert.ok(auditInvariants(db).errors.some(e=>e.scope==='STOCK'));
   db.prepare('UPDATE parts SET quantity=quantity-3 WHERE id=?').run(part.id);
   assert.equal(auditInvariants(db).errors.length,0);
 }finally{db.close()}
});

test('P0: OS captura identidade automotiva em snapshot imutável',()=>{
 const{db,os,machine}=context();
 try{
  const before=JSON.parse(getWorkOrder(db,os.id).snapshot_machine);
  assert.equal(before.licensePlate,'ABC1D23');
  assert.equal(before.vin,'9BWZZZ377VT004251');
  assert.equal(before.odometerKm,18000);
  db.prepare('UPDATE machines SET odometer_km=? WHERE id=?').run(19000,machine.id);
  assert.equal(JSON.parse(getWorkOrder(db,os.id).snapshot_machine).odometerKm,18000);
 }finally{db.close()}
});

test('P0: agenda rejeita vínculo entre cliente/veículo/OS de proprietários diferentes e fim anterior ao início',()=>{
 const {db,c,other,machine,alien,os}=context();
 try{
  const start='2026-11-03T12:00:00Z';
  assert.throws(()=>createScheduleEvent(db,{type:'VISITA',title:'Falho',startsAt:start,customerId:c.id,machineId:alien.id}),/pertence|cliente/i);
  assert.throws(()=>createScheduleEvent(db,{type:'VISITA',title:'Falho',startsAt:start,customerId:other.id,workOrderId:os.id}),/pertence|cliente/i);
  assert.throws(()=>createScheduleEvent(db,{type:'VISITA',title:'Falho',startsAt:start,endsAt:'2026-11-03T11:00:00Z'}),/final|anterior/i);
  const e=createScheduleEvent(db,{type:'VISITA',title:'OK',startsAt:start,customerId:c.id,machineId:machine.id,workOrderId:os.id});
  assert.throws(()=>updateScheduleEvent(db,e.id,{machineId:alien.id}),/pertence|vínculo|equipamento/i);
 }finally{db.close()}
});

test('P0: checklist parcial não fica concluído e checklist completo fica',()=>{
 const{db,os}=context();
 try{
  const t=createChecklistTemplate(db,{name:'Inspeção',kind:'PERSONALIZADO',items:['Pneus','Freios']});
  const half=createWorkOrderChecklist(db,os.id,t.id,[{position:1,response:'OK'}]);
  assert.equal(half.completed_at,null);
  const all=createWorkOrderChecklist(db,os.id,t.id,[{position:1,response:'OK'},{position:2,response:'OK'}]);
  assert.ok(all.completed_at);
 }finally{db.close()}
});

test('P0: falha SQLite no cadastro de anexo não deixa arquivo órfão',()=>{
 const{db,os}=context();const dir=mkdtempSync(join(tmpdir(),'oficina-atomic-'));
 try{
  db.exec("CREATE TRIGGER reject_attachment BEFORE INSERT ON attachments BEGIN SELECT RAISE(ABORT,'forced-failure'); END;");
  assert.throws(()=>saveAttachment(db,os.id,{category:'ENTRADA',mimeType:'image/jpeg',base64:Buffer.from('foto').toString('base64'),originalName:'foto.jpg',storageDir:dir,requestId:'attach-1'}),/forced-failure/);
  assert.equal(readdirSync(dir,{recursive:true}).filter(f=>String(f).endsWith('.jpg')).length,0);
 }finally{db.close();rmSync(dir,{recursive:true,force:true})}
});
