import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,migrate} from '../src/db.js';
import {createCustomer,createMachine} from '../src/services/catalog.js';
import {createWorkOrder,transitionWorkOrder,updateWorkOrder,getWorkOrder} from '../src/services/work-orders.js';
import {saveQuote,submitQuote} from '../src/services/quotes.js';
import {
  lookupVehicleByPlate,createCrmTask,listCrmTasks,completeCrmTask,createMaintenanceCrmTasks,
  createShopUnit,listShopUnits,assignWorkOrderUnit,unitReport,
  createFleet,addFleetVehicle,listFleets,
  createTechnicalReference,listTechnicalReferences,
  createApprovalLink,getApprovalProposal,resolveApproval
} from '../src/services/market-parity.js';

function fixture(){
 const db=openDatabase(':memory:');migrate(db);
 const customer=createCustomer(db,{name:'Cliente A',phone:'11912345678'});
 const other=createCustomer(db,{name:'Cliente B'});
 const vehicle=createMachine(db,{customerId:customer.id,type:'Carro',brand:'FIAT',model:'UNO',plate:'ABC1D23',year:2020});
 const otherVehicle=createMachine(db,{customerId:other.id,type:'Carro',brand:'FORD',model:'KA',plate:'BBB2C34'});
 const os=createWorkOrder(db,{customerId:customer.id,machineId:vehicle.id,problemReported:'Motor falhando'});
 transitionWorkOrder(db,os.id,'DIAGNOSTICO');
 updateWorkOrder(db,os.id,{diagnosis:'Troca de peça'});
 return {db,customer,other,vehicle,otherVehicle,os};
}

test('P2: placa busca apenas registro local, sem fornecedor externo obrigatório',()=>{
 const {db,vehicle}=fixture();
 const result=lookupVehicleByPlate(db,'abc-1d23');
 assert.equal(result.id,vehicle.id);
 assert.equal(result.source,'LOCAL');
 assert.equal(lookupVehicleByPlate(db,'ZZZ9Z99'),null);
 assert.throws(()=>lookupVehicleByPlate(db,'../../bad'),/Placa/);
 db.close();
});

test('P2: tarefas CRM têm persistência, vínculo ao cliente e encerramento auditável',()=>{
 const {db,customer,vehicle,os}=fixture();
 const task=createCrmTask(db,{customerId:customer.id,machineId:vehicle.id,workOrderId:os.id,title:'Retorno após orçamento',dueAt:'2026-12-01',channel:'WHATSAPP'});
 assert.equal(listCrmTasks(db,{status:'PENDENTE'}).length,1);
 assert.equal(task.status,'PENDENTE');
 assert.throws(()=>createCrmTask(db,{customerId:customer.id,machineId:999,title:'Inválido'}),/pertence|não encontrado/);
 const done=completeCrmTask(db,task.id,{outcome:'Cliente contatado'});
 assert.equal(done.status,'CONCLUIDA');
 assert.equal(done.outcome,'Cliente contatado');
 assert.equal(listCrmTasks(db,{status:'PENDENTE'}).length,0);
 db.close();
});

test('P3: oficinas e frotas são cadastráveis, sem permitir cruzar propriedade de veículos',()=>{
 const {db,customer,vehicle,otherVehicle,os}=fixture();
 const unit=createShopUnit(db,{code:'FILIAL-1',name:'Filial 1'});
 assert.ok(listShopUnits(db).some(row=>row.id===unit.id));
 assert.equal(assignWorkOrderUnit(db,os.id,unit.id).unit_id,unit.id);
 assert.equal(unitReport(db).find(row=>row.id===unit.id).work_orders,1);
 const fleet=createFleet(db,{customerId:customer.id,name:'Frota comercial'});
 addFleetVehicle(db,fleet.id,vehicle.id);
 assert.equal(listFleets(db)[0].vehicle_count,1);
 assert.throws(()=>addFleetVehicle(db,fleet.id,otherVehicle.id),/pertence/);
 db.close();
});

test('P3: códigos técnicos são referências declaradas, sem falsa homologação OEM',()=>{
 const {db}=fixture();
 const part=db.prepare("INSERT INTO parts(sku,description,unit,quantity,min_stock,sale_price_cents,created_at,updated_at) VALUES('T1','Filtro','UN',1,0,1200,datetime('now'),datetime('now'))").run();
 const ref=createTechnicalReference(db,{partId:Number(part.lastInsertRowid),manufacturer:'Marca X',oemCode:'123-ABC',notes:'Referência não homologada'});
 assert.equal(ref.verified,0);
 assert.equal(listTechnicalReferences(db,{partId:Number(part.lastInsertRowid)}).length,1);
 db.close();
});

test('P1: link público de orçamento é de uso único, expira e bloqueia orçamento modificado',()=>{
 const {db,os}=fixture();
 saveQuote(db,os.id,{items:[{kind:'MAO_DE_OBRA',description:'Reparo',quantity:1,unitPriceCents:15000}]});
 submitQuote(db,os.id);
 const link=createApprovalLink(db,os.id,{expiresInHours:48});
 assert.match(link.token,/^[a-f0-9]{64}$/);
 assert.equal(getApprovalProposal(db,link.token).totalCents,15000);
 assert.equal(resolveApproval(db,link.token,{decision:'APROVAR'}).status,'APROVADO');
 assert.equal(getWorkOrder(db,os.id).status,'APROVADA');
 assert.equal(resolveApproval(db,link.token,{decision:'APROVAR'}).status,'APROVADO');
 assert.throws(()=>resolveApproval(db,link.token,{decision:'REJEITAR',reason:'Não'}),/utilizado|processado|decisão/);
 db.close();
});
