import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, migrate } from '../src/db.js';
import { createCustomer, createMachine, createTechnician } from '../src/services/catalog.js';
import { createWorkOrder } from '../src/services/work-orders.js';
import { createScheduleEvent, createChecklistTemplate, createWorkOrderChecklist, saveAttachment, listSchedule, seedDefaultChecklists } from '../src/services/operations.js';

function setup(){ const db=openDatabase(':memory:'); migrate(db); const c=createCustomer(db,{name:'Fazenda'}); const m=createMachine(db,{customerId:c.id,type:'Trator'}); const t=createTechnician(db,{name:'Carlos'}); const os=createWorkOrder(db,{customerId:c.id,machineId:m.id,problemReported:'Falha'}); return {db,c,m,t,os}; }

test('creates linked schedule event and lists upcoming agenda',()=>{
 const {db,c,m,t,os}=setup(); const e=createScheduleEvent(db,{type:'DIAGNOSTICO',title:'Diagnóstico OS',startsAt:'2030-01-10T10:00:00.000Z',customerId:c.id,machineId:m.id,workOrderId:os.id,technicianId:t.id});
 assert.equal(e.work_order_id,os.id); assert.equal(listSchedule(db,{from:'2030-01-01T00:00:00.000Z',to:'2030-02-01T00:00:00.000Z'}).length,1); db.close();
});

test('seeds entry and delivery checklist templates and snapshots labels on OS',()=>{
 const {db,os}=setup(); seedDefaultChecklists(db); const templates=db.prepare('SELECT * FROM checklist_templates ORDER BY id').all();
 assert.deepEqual(templates.map(x=>x.kind),['ENTRADA','ENTREGA']);
 const entry=templates[0]; const checklist=createWorkOrderChecklist(db,os.id,entry.id,[{position:1,response:'OK',note:'Sem avarias'}]);
 assert.equal(checklist.responses[0].label_snapshot.length>0,true); assert.equal(checklist.responses[0].response,'OK'); db.close();
});

test('supports custom checklist templates with valid response enum',()=>{
 const {db,os}=setup(); const t=createChecklistTemplate(db,{name:'Inspeção hidráulica',kind:'PERSONALIZADO',items:['Mangueiras','Conexões']});
 assert.throws(()=>createWorkOrderChecklist(db,os.id,t.id,[{position:1,response:'RUIM'}]),/Resposta inválida/);
 const c=createWorkOrderChecklist(db,os.id,t.id,[{position:1,response:'ATENCAO',note:'Trocar em breve'},{position:2,response:'OK'}]); assert.equal(c.responses.length,2); db.close();
});

test('stores safe local attachment path and blocks unsupported or oversized files',()=>{
 const {db,os}=setup(); const dir=mkdtempSync(join(tmpdir(),'oficina-'));
 const saved=saveAttachment(db,os.id,{category:'ENTRADA',caption:'Frente',originalName:'../../trator.jpg',mimeType:'image/jpeg',base64:Buffer.from([0xff,0xd8,0xff,0xd9]).toString('base64'),storageDir:dir});
 assert.equal(saved.relative_path.includes('..'),false); assert.equal(saved.relative_path.startsWith(`${os.id}/`),true); assert.equal(existsSync(join(dir,saved.relative_path)),true);
 assert.throws(()=>saveAttachment(db,os.id,{category:'OUTRO',originalName:'x.exe',mimeType:'application/x-msdownload',base64:'AA==',storageDir:dir}),/Tipo de arquivo/);
 assert.throws(()=>saveAttachment(db,os.id,{category:'OUTRO',originalName:'x.jpg',mimeType:'image/jpeg',base64:Buffer.alloc(10).toString('base64'),storageDir:dir,maxBytes:5}),/excede/);
 rmSync(dir,{recursive:true,force:true}); db.close();
});
