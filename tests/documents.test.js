import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, migrate } from '../src/db.js';
import { createCustomer, createMachine } from '../src/services/catalog.js';
import { createWorkOrder } from '../src/services/work-orders.js';
import { renderPdfDocument } from '../src/documents.js';

test('generates a real PDF buffer for a work order without external services',()=>{
  const db=openDatabase(':memory:'); migrate(db);
  db.prepare('UPDATE company_settings SET name=?,document=?,phone=?,address=? WHERE id=1').run('Oficina Teste','12.345.678/0001-90','(16) 99999-9999','Ribeirão Preto - SP');
  const customer=createCustomer(db,{name:'Fazenda Santa Luzia',document:'123.456.789-00',phone:'(16) 98888-7777'});
  const machine=createMachine(db,{customerId:customer.id,type:'Trator',brand:'John Deere',model:'6110J',serialNumber:'SN-123'});
  const os=createWorkOrder(db,{customerId:customer.id,machineId:machine.id,problemReported:'Vazamento hidráulico',diagnosis:'Trocar vedação'});

  const pdf=renderPdfDocument(db,os.id,'work-order');
  assert.ok(Buffer.isBuffer(pdf));
  assert.equal(pdf.subarray(0,8).toString('ascii'),'%PDF-1.4');
  assert.ok(pdf.length>700);
  assert.match(pdf.toString('latin1'),/Oficina Teste/);
  assert.match(pdf.toString('latin1'),/6110J/);
  db.close();
});
