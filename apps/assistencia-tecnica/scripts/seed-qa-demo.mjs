import { openDatabase, migrate } from '../src/db.js';
import { migrateAssistencia } from '../src/assistencia-schema.js';
import { seed } from '../src/seed.js';
import { createCustomer, createMachine, createTechnician } from '../src/services/catalog.js';
import { createWorkOrder, transitionWorkOrder } from '../src/services/work-orders.js';
import { saveQuote, submitQuote, approveQuote } from '../src/services/quotes.js';
import { createService } from '../src/services/sales.js';

const db=openDatabase();
migrate(db);
migrateAssistencia(db);
seed(db,{adminUser:'admin',adminPassword:'Admin@1234',nodeEnv:'development'});

if(!db.prepare("SELECT id FROM customers WHERE name='João Silva'").get()){
  db.prepare("UPDATE company_settings SET name='Assistência Técnica · Demonstração', phone='(16) 3333-2026', address='Ribeirão Preto - SP', updated_at=datetime('now') WHERE id=1").run();
  const admin=db.prepare("SELECT id FROM users WHERE username='admin'").get();
  const tech1=createTechnician(db,{name:'Carlos Mendes',phone:'(16) 99990-1001',specialty:'Informática e notebooks'});
  const tech2=createTechnician(db,{name:'Rafael Souza',phone:'(16) 99990-1002',specialty:'Eletrônica e celulares'});
  const c1=createCustomer(db,{name:'João Silva',document:'123.456.789-00',phone:'(16) 98888-1001',address:'Ribeirão Preto - SP'});
  const c2=createCustomer(db,{name:'Maria Oliveira',document:'234.567.890-00',phone:'(16) 98888-1002',address:'Ribeirão Preto - SP'});
  const c3=createCustomer(db,{name:'Empresa Alfa',document:'34.567.890/0001-30',phone:'(16) 98888-1003',address:'Sertãozinho - SP'});
  const m1=createMachine(db,{customerId:c1.id,type:'Notebook',brand:'Dell',model:'Inspiron 15',year:2023,serialNumber:'DELL-DEMO-01',hourMeter:0});
  const m2=createMachine(db,{customerId:c2.id,type:'Smartphone',brand:'Samsung',model:'Galaxy S23',year:2024,serialNumber:'IMEI-DEMO-02',hourMeter:0});
  const m3=createMachine(db,{customerId:c3.id,type:'Televisor',brand:'LG',model:'55 UHD',year:2022,serialNumber:'LG55-DEMO-03',hourMeter:0});
  createService(db,{code:'DIAG',name:'Diagnóstico técnico',priceCents:8000,estimatedMinutes:60});
  createService(db,{code:'FORM',name:'Formatação e configuração',priceCents:15000,estimatedMinutes:120});
  const create=(customer,machine,problem,tech,priority='NORMAL')=>createWorkOrder(db,{customerId:customer.id,machineId:machine.id,problemReported:problem,technicianId:tech.id,priority,createdBy:admin.id});
  create(c1,m1,'Notebook não liga após queda de energia',tech1,'ALTA');
  const diagnosis=create(c2,m2,'Aparelho não carrega pela USB-C',tech2,'URGENTE');
  transitionWorkOrder(db,diagnosis.id,'DIAGNOSTICO',{reason:'Equipamento recebido para diagnóstico',changedBy:admin.id});
  const awaiting=create(c3,m3,'TV liga, mas não apresenta imagem',tech2,'ALTA');
  transitionWorkOrder(db,awaiting.id,'DIAGNOSTICO',{changedBy:admin.id});
  saveQuote(db,awaiting.id,{items:[{kind:'MAO_DE_OBRA',description:'Diagnóstico e reparo eletrônico',quantity:1,unitPriceCents:22000},{kind:'PECA',description:'Kit de LEDs do backlight',quantity:1,unitPriceCents:18000}],discountCents:0,notes:'Dados de demonstração QA'});
  submitQuote(db,awaiting.id);
  const working=create(c1,m1,'Troca de SSD e reinstalação do sistema',tech1);
  transitionWorkOrder(db,working.id,'DIAGNOSTICO',{changedBy:admin.id});
  saveQuote(db,working.id,{items:[{kind:'MAO_DE_OBRA',description:'Instalação e configuração',quantity:1,unitPriceCents:15000},{kind:'PECA',description:'SSD 480 GB',quantity:1,unitPriceCents:24000}],discountCents:0});
  submitQuote(db,working.id); approveQuote(db,working.id); transitionWorkOrder(db,working.id,'EM_SERVICO',{changedBy:admin.id});
  const ready=create(c2,m2,'Substituição do conector de carga',tech2);
  transitionWorkOrder(db,ready.id,'DIAGNOSTICO',{changedBy:admin.id});
  saveQuote(db,ready.id,{items:[{kind:'MAO_DE_OBRA',description:'Troca do conector e testes',quantity:1,unitPriceCents:18000}],discountCents:0});
  submitQuote(db,ready.id); approveQuote(db,ready.id); transitionWorkOrder(db,ready.id,'EM_SERVICO',{changedBy:admin.id}); transitionWorkOrder(db,ready.id,'PRONTA',{changedBy:admin.id});
}

db.close();
console.log('QA demo da Assistência Técnica pronto');
