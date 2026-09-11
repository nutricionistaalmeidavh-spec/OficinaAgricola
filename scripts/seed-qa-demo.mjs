import { openDatabase } from '../src/db.js';
import { seed } from '../src/seed.js';
import { createCustomer, createMachine, createTechnician } from '../src/services/catalog.js';
import { createWorkOrder, transitionWorkOrder } from '../src/services/work-orders.js';
import { saveQuote, submitQuote, approveQuote } from '../src/services/quotes.js';

const db=openDatabase();
seed(db,{adminUser:'admin',adminPassword:'Admin@1234',nodeEnv:'development'});

if(!db.prepare("SELECT id FROM customers WHERE name='Fazenda Santa Clara'").get()){
  db.prepare("UPDATE company_settings SET name='Oficina Agro · Demonstração', phone='(16) 3333-2026', address='Ribeirão Preto - SP', updated_at=datetime('now') WHERE id=1").run();
  const admin=db.prepare("SELECT id FROM users WHERE username='admin'").get();
  const tech1=createTechnician(db,{name:'Carlos Mendes',phone:'(16) 99990-1001',specialty:'Hidráulica'});
  const tech2=createTechnician(db,{name:'Rafael Souza',phone:'(16) 99990-1002',specialty:'Motores e transmissão'});
  const c1=createCustomer(db,{name:'Fazenda Santa Clara',document:'12.345.678/0001-10',phone:'(16) 98888-1001',address:'Sertãozinho - SP'});
  const c2=createCustomer(db,{name:'Agro Horizonte',document:'23.456.789/0001-20',phone:'(16) 98888-1002',address:'Cravinhos - SP'});
  const c3=createCustomer(db,{name:'Sítio Boa Esperança',document:'34.567.890/0001-30',phone:'(16) 98888-1003',address:'Batatais - SP'});
  const m1=createMachine(db,{customerId:c1.id,type:'Trator',brand:'John Deere',model:'6110J',year:2022,serialNumber:'JD6110-DEMO',hourMeter:1840});
  const m2=createMachine(db,{customerId:c2.id,type:'Trator',brand:'Case IH',model:'Puma 200',year:2021,serialNumber:'CASE200-DEMO',hourMeter:2310});
  const m3=createMachine(db,{customerId:c3.id,type:'Colheitadeira',brand:'New Holland',model:'CR 7.90',year:2023,serialNumber:'NH790-DEMO',hourMeter:960});
  const create=(customer,machine,problem,tech,priority='NORMAL')=>createWorkOrder(db,{customerId:customer.id,machineId:machine.id,problemReported:problem,technicianId:tech.id,priority,createdBy:admin.id});
  create(c1,m1,'Vazamento hidráulico no comando frontal',tech1,'ALTA');
  const diagnosis=create(c2,m2,'Perda de potência em operação',tech2,'URGENTE');
  transitionWorkOrder(db,diagnosis.id,'DIAGNOSTICO',{reason:'Máquina recebida para diagnóstico',changedBy:admin.id});
  const awaiting=create(c3,m3,'Ruído no sistema de alimentação',tech2,'ALTA');
  transitionWorkOrder(db,awaiting.id,'DIAGNOSTICO',{changedBy:admin.id});
  saveQuote(db,awaiting.id,{items:[{kind:'MAO_DE_OBRA',description:'Diagnóstico e regulagem do sistema',quantity:3,unitPriceCents:18500},{kind:'PECA',description:'Kit de filtros',quantity:1,unitPriceCents:89000}],discountCents:5000,notes:'Dados de demonstração QA'});
  submitQuote(db,awaiting.id);
  const working=create(c1,m1,'Revisão preventiva de 2.000 horas',tech1);
  transitionWorkOrder(db,working.id,'DIAGNOSTICO',{changedBy:admin.id});
  saveQuote(db,working.id,{items:[{kind:'MAO_DE_OBRA',description:'Revisão preventiva completa',quantity:6,unitPriceCents:17500},{kind:'PECA',description:'Kit revisão 2.000 h',quantity:1,unitPriceCents:145000}],discountCents:0});
  submitQuote(db,working.id); approveQuote(db,working.id); transitionWorkOrder(db,working.id,'EM_SERVICO',{changedBy:admin.id});
  const ready=create(c2,m2,'Troca de mangueira e teste de pressão',tech1);
  transitionWorkOrder(db,ready.id,'DIAGNOSTICO',{changedBy:admin.id});
  saveQuote(db,ready.id,{items:[{kind:'MAO_DE_OBRA',description:'Troca e teste de pressão',quantity:2,unitPriceCents:18000}],discountCents:0});
  submitQuote(db,ready.id); approveQuote(db,ready.id); transitionWorkOrder(db,ready.id,'EM_SERVICO',{changedBy:admin.id}); transitionWorkOrder(db,ready.id,'PRONTA',{changedBy:admin.id});
}

db.close();
console.log('QA demo data ready');
