import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase, migrate } from '../src/db.js';
import { migrateAssistencia } from '../src/assistencia-schema.js';
import { createPart, addInventoryMovement } from '../src/services/inventory.js';
import { createService, openCashSession, closeCashSession, createSale, cancelSale, cashSummary } from '../src/services/sales.js';
import { createBackup, verifyBackup } from '../src/platform/backup.js';

function setup() {
  const db=openDatabase(':memory:');
  migrate(db);migrateAssistencia(db);
  return db;
}

test('P0: duplicate sale lines cannot overdraw the same part stock',()=>{
  const db=setup();
  try {
    const part=createPart(db,{sku:'P0-DUP',description:'Filtro',salePriceCents:2500});
    addInventoryMovement(db,part.id,{type:'ENTRADA',quantity:10});
    openCashSession(db,{openingCents:0});
    assert.throws(()=>createSale(db,{items:[{partId:part.id,quantity:7},{partId:part.id,quantity:7}],paymentMethod:'DINHEIRO'}),/estoque insuficiente/i);
    assert.equal(db.prepare('SELECT quantity FROM parts WHERE id=?').get(part.id).quantity,10);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM sales').get().n,0);
  } finally {db.close();}
});

test('P0: sale without an open cash session is forbidden and never decrements stock',()=>{
  const db=setup();
  try{
    const part=createPart(db,{sku:'P0-CASH',description:'Filtro',salePriceCents:8000});
    addInventoryMovement(db,part.id,{type:'ENTRADA',quantity:3});
    assert.throws(()=>createSale(db,{items:[{partId:part.id,quantity:1}],paymentMethod:'DINHEIRO'}),/caixa/i);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM sales').get().n,0);
    assert.equal(db.prepare('SELECT quantity FROM parts WHERE id=?').get(part.id).quantity,3);
  }finally{db.close();}
});

test('P0: cancellation after original cash session closes records refund in currently open session',()=>{
  const db=setup();
  try {
    const service=createService(db,{code:'P0-SVC',name:'Reparo',priceCents:700});
    openCashSession(db,{openingCents:0});
    const sale=createSale(db,{items:[{serviceId:service.id,quantity:1}],paymentMethod:'DINHEIRO'});
    closeCashSession(db,{closingCents:700});
    const old=db.prepare('SELECT * FROM cash_sessions WHERE id=?').get(sale.cash_session_id);
    const current=openCashSession(db,{openingCents:2000});
    cancelSale(db,sale.id,{reason:'Devolução',userId:null});
    assert.equal(cashSummary(db).expectedCashCents,1300);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM cash_movements WHERE cash_session_id=? AND type=?').get(current.id,'ESTORNO').n,1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM cash_movements WHERE cash_session_id=?').get(old.id).n,1);
    assert.equal(db.prepare('SELECT closing_cents FROM cash_sessions WHERE id=?').get(old.id).closing_cents,700);
  } finally {db.close();}
});

test('P0: retry of same sale request id is idempotent for stock and cash',()=>{
  const db=setup();
  try {
    const part=createPart(db,{sku:'P0-RETRY',description:'Bomba',salePriceCents:2300});
    addInventoryMovement(db,part.id,{type:'ENTRADA',quantity:5});
    openCashSession(db,{openingCents:0});
    const saleInput={requestId:'sale-p0-uuid-1234',paymentMethod:'DINHEIRO',items:[{partId:part.id,quantity:1}]};
    const a=createSale(db,saleInput),b=createSale(db,saleInput);
    assert.equal(a.id,b.id);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM sales').get().n,1);
    assert.equal(db.prepare('SELECT quantity FROM parts WHERE id=?').get(part.id).quantity,4);
    assert.equal(cashSummary(db).expectedCashCents,2300);
  }finally{db.close();}
});

test('P0: live SQLite WAL backup contains recently committed records',()=>{
  const root=mkdtempSync(join(tmpdir(),'p0-oficina-wal-'));
  const databasePath=join(root,'oficina.sqlite'),uploadsPath=join(root,'uploads'),backupRoot=join(root,'backups');
  mkdirSync(uploadsPath);
  const db=new DatabaseSync(databasePath);
  try{
    db.exec('PRAGMA journal_mode=WAL; CREATE TABLE records (id INTEGER PRIMARY KEY, name TEXT);');
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    db.prepare('INSERT INTO records(name) VALUES(?)').run('escrito-somente-no-wal');
    const backup=createBackup({databasePath,uploadsPath,backupRoot});
    verifyBackup(backup.backupDir);
    const copy=new DatabaseSync(join(backup.backupDir,'database.sqlite'));
    try{assert.equal(copy.prepare('SELECT name FROM records').get().name,'escrito-somente-no-wal');}
    finally{copy.close();}
  } finally{db.close();rmSync(root,{recursive:true,force:true});}
});

test('P0: exactly one executable application exists at repository root',()=>{
  assert.ok(existsSync('src/server-assistencia.js'));
  assert.ok(existsSync('src/assistencia-schema.js'));
  assert.equal(existsSync('apps/assistencia-tecnica/src/start.js'),false);
});
