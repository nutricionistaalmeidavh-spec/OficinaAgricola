import {randomBytes} from 'node:crypto';

const newId=()=>randomBytes(6).readUIntBE(0,6);
const clean=v=>String(v??'').trim();
const key=v=>{const n=Number(v);if(!Number.isSafeInteger(n)||n<1)throw Error('Identificador inválido');return n;};
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const at=()=>new Date().toISOString();
const date=value=>{
 const v=clean(value);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(v)||
   Number.isNaN(Date.parse(v+'T00:00:00.000Z'))||
   new Date(v+'T00:00:00.000Z').toISOString().slice(0,10)!==v)fail('Data inválida');
 return v;
};
const PLATE=/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/;
const channels=new Set(['MANUAL','TELEFONE','EMAIL','WHATSAPP']);
const statuses=new Set(['PENDENTE','CONCLUIDA','TODAS']);
const affected=result=>Number(result?.changes??result?.meta?.changes??0);
export function createAsyncWorkshopCrm(port){
 if(!['sqlite','postgres','d1'].includes(port?.engine))fail('Adaptador SQL inválido');
 async function requireRow(table,value,label){
   // Table names are developer-defined only, never passed from an API.
   if(!new Set(['customers','machines','work_orders','crm_tasks','fleets','parts']).has(table))
     fail('Tabela CRM inválida',500);
   const row=await port.first('SELECT * FROM '+table+' WHERE id=?',[key(value)]);
   if(!row)fail(label+' não encontrado',404);
   return row;
 }
 async function lookupVehicleByPlate(value){
   const plate=clean(value).toUpperCase().replace(/[\s-]/g,'');
   if(!PLATE.test(plate))fail('Placa inválida');
   const row=await port.first(`SELECT id,customer_id,type,brand,model,year,license_plate,
     vin,engine,fuel_type,odometer_km FROM machines WHERE license_plate=?`,[plate]);
   return row?{...row,source:'LOCAL'}:null;
 }
 async function createCrmTask(input={}){
   const customer=await requireRow('customers',input.customerId,'Cliente'),
     machine=input.machineId==null?null:await requireRow('machines',input.machineId,'Veículo'),
     order=input.workOrderId==null?null:await requireRow('work_orders',input.workOrderId,'OS');
   if(machine&&Number(machine.customer_id)!==Number(customer.id))
     fail('Veículo não pertence ao cliente selecionado',409);
   if(order&&(Number(order.customer_id)!==Number(customer.id)||
     (machine&&Number(order.machine_id)!==Number(machine.id))))
     fail('OS não pertence ao cliente/veículo',409);
   const title=clean(input.title),notes=clean(input.notes),
     channel=clean(input.channel||'MANUAL').toUpperCase(),
     dueAt=date(input.dueAt||at().slice(0,10));
   if(!title||title.length>160||notes.length>2000)fail('Título ou observações inválidos');
   if(!channels.has(channel))fail('Canal inválido');
   const taskId=newId();
   await port.run(`INSERT INTO crm_tasks(
     id,customer_id,machine_id,work_order_id,title,due_at,channel,notes,created_at
   ) VALUES(?,?,?,?,?,?,?,?,?)`,[
     taskId,customer.id,machine?.id??null,order?.id??null,
     title,dueAt,channel,notes,at()
   ]);
   return requireRow('crm_tasks',taskId,'Tarefa CRM');
 }
 async function listCrmTasks({status='PENDENTE',limit=200}={}){
   if(!statuses.has(status))fail('Situação CRM inválida');
   const size=Math.max(1,Math.min(500,Number(limit)||200));
   return port.all(`SELECT t.*,c.name customer_name,c.phone customer_phone,
     c.email customer_email,m.license_plate,m.model machine_model
     FROM crm_tasks t JOIN customers c ON c.id=t.customer_id
     LEFT JOIN machines m ON m.id=t.machine_id
     WHERE (?='TODAS' OR t.status=?)
     ORDER BY t.due_at,t.id DESC LIMIT ?`,[status,status,size]);
 }
 async function completeCrmTask(taskId,{outcome}={}){
   const result=clean(outcome);
   if(!result||result.length>1000)fail('Informe o resultado do contato (até 1000 caracteres)');
   const row=await requireRow('crm_tasks',taskId,'Tarefa CRM');
   if(row.status==='CONCLUIDA')return row;
   await port.run(`UPDATE crm_tasks SET status='CONCLUIDA',
     outcome=?,completed_at=? WHERE id=? AND status='PENDENTE'`,[
     result,at(),row.id
   ]);
   return requireRow('crm_tasks',taskId,'Tarefa CRM');
 }
 async function createMaintenanceCrmTasks({daysAhead=7}={}){
   const days=Number(daysAhead);
   if(!Number.isInteger(days)||days<0||days>90)fail('Janela de manutenção inválida');
   const cutoff=new Date(Date.now()+days*86400000).toISOString().slice(0,10);
   const rows=await port.all(`SELECT p.*,m.customer_id,m.model,m.license_plate,
     m.odometer_km,m.hour_meter
     FROM maintenance_plans p JOIN machines m ON m.id=p.machine_id
     WHERE p.active=1 AND (
       (p.next_due_date IS NOT NULL AND p.next_due_date<=?) OR
       (p.next_due_km IS NOT NULL AND m.odometer_km>=p.next_due_km) OR
       (p.next_due_hours IS NOT NULL AND m.hour_meter>=p.next_due_hours)
     )`,[cutoff]);
   let created=0;
   for(const item of rows){
     const due=item.next_due_date&&item.next_due_date<=cutoff
       ?item.next_due_date:at().slice(0,10);
     const dedupe='MAINT:'+item.id+':'+
       [item.next_due_date,item.next_due_km,item.next_due_hours].join(':');
     const result=await port.run(`INSERT INTO crm_tasks(
       id,customer_id,machine_id,title,due_at,channel,notes,dedupe_key,created_at
     ) VALUES(?,?,?,?,?,'MANUAL',?,?,?)
     ON CONFLICT(dedupe_key) DO NOTHING`,[
       newId(),item.customer_id,item.machine_id,'Revisão: '+item.name,
       due,'Conferir manutenção antes de contatar o cliente.',dedupe,at()
     ]);
     created+=affected(result);
   }
   return {created,duePlans:rows.length};
 }
 async function createFleet({customerId,name}={}){
   const customer=await requireRow('customers',customerId,'Cliente'),title=clean(name);
   if(!title||title.length>120)fail('Nome da frota inválido');
   const fleetId=newId();
   await port.run('INSERT INTO fleets(id,customer_id,name,created_at) VALUES(?,?,?,?)',
     [fleetId,customer.id,title,at()]);
   return requireRow('fleets',fleetId,'Frota');
 }
 async function addFleetVehicle(fleetId,machineId){
   const fleet=await requireRow('fleets',fleetId,'Frota'),
     machine=await requireRow('machines',machineId,'Veículo');
   if(Number(fleet.customer_id)!==Number(machine.customer_id))
     fail('Veículo não pertence ao cliente da frota',409);
   await port.run(`INSERT INTO fleet_vehicles(fleet_id,machine_id,created_at)
     VALUES(?,?,?) ON CONFLICT(fleet_id,machine_id) DO NOTHING`,
     [fleet.id,machine.id,at()]);
   return {ok:true};
 }
 async function listFleets(){
   return port.all(`SELECT f.*,c.name customer_name,COUNT(v.machine_id) vehicle_count
     FROM fleets f JOIN customers c ON c.id=f.customer_id
     LEFT JOIN fleet_vehicles v ON v.fleet_id=f.id
     GROUP BY f.id,c.name ORDER BY f.id DESC`);
 }
 async function createTechnicalReference(input={}){
   const part=await requireRow('parts',input.partId,'Peça');
   const manufacturer=clean(input.manufacturer),oem=clean(input.oemCode),
     code=clean(input.referenceCode),notes=clean(input.notes);
   if((!oem&&!code)||manufacturer.length>120||oem.length>120||
     code.length>120||notes.length>500)fail('Referência técnica inválida');
   const refId=newId();
   await port.run(`INSERT INTO technical_references(
     id,part_id,manufacturer,oem_code,reference_code,notes,created_at
   ) VALUES(?,?,?,?,?,?,?)`,[refId,part.id,manufacturer,oem,code,notes,at()]);
   return port.first('SELECT * FROM technical_references WHERE id=?',[refId]);
 }
 async function listTechnicalReferences({partId=null}={}){
   const args=[];
   let filter='';
   if(partId!=null){
     await requireRow('parts',partId,'Peça');
     filter=' WHERE t.part_id=?';args.push(key(partId));
   }
   return port.all(`SELECT t.*,p.description part_description,p.sku
     FROM technical_references t JOIN parts p ON p.id=t.part_id
     ${filter} ORDER BY t.id DESC LIMIT 300`,args);
 }
 return Object.freeze({lookupVehicleByPlate,createCrmTask,listCrmTasks,
   completeCrmTask,createMaintenanceCrmTasks,
   createFleet,addFleetVehicle,listFleets,
   createTechnicalReference,listTechnicalReferences});
}
