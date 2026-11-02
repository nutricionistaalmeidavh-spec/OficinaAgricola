import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, migrate } from '../src/db.js';
import { createCustomer, updateCustomer, createMachine, createTechnician, listCustomerMachines } from '../src/services/catalog.js';

function setup(){ const db=openDatabase(':memory:'); migrate(db); return db; }

test('creates customer and machine linked to owner', () => {
  const db=setup();
  const customer=createCustomer(db,{name:'Fazenda Boa Vista',document:'12.345.678/0001-00',phone:'16999990000'});
  const machine=createMachine(db,{customerId:customer.id,type:'Trator',brand:'John Deere',model:'6175M',hourMeter:1260});
  assert.equal(machine.customer_id, customer.id);
  assert.equal(machine.hour_meter, 1260);
  assert.equal(listCustomerMachines(db, customer.id).length,1);
  db.close();
});

test('rejects machine owned by missing customer and negative hour meter', () => {
  const db=setup();
  assert.throws(()=>createMachine(db,{customerId:999,type:'Trator'}),/Cliente não encontrado/);
  const c=createCustomer(db,{name:'Cliente'});
  assert.throws(()=>createMachine(db,{customerId:c.id,type:'Trator',hourMeter:-1}),/Horímetro/);
  db.close();
});

test('deactivates customer instead of deleting history', () => {
  const db=setup();
  const c=createCustomer(db,{name:'Cliente Histórico'});
  createMachine(db,{customerId:c.id,type:'Colheitadeira'});
  const updated=updateCustomer(db,c.id,{active:false});
  assert.equal(updated.active,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM customers WHERE id=?').get(c.id).n,1);
  db.close();
});

test('creates active technician with optional specialty', () => {
  const db=setup();
  const t=createTechnician(db,{name:'Carlos',phone:'16999999999',specialty:'Hidráulica'});
  assert.equal(t.name,'Carlos'); assert.equal(t.active,1);
  db.close();
});
