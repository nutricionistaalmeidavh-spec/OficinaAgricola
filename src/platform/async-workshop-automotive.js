import {randomBytes} from 'node:crypto';
import {decodeDtcResponse} from '../services/obd.js';
import {parseDiagnosticCapture} from '../services/diagnostics.js';

const newId=()=>randomBytes(6).readUIntBE(0,6);
const clean=v=>String(v??'').trim();
const norm=v=>clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
const key=v=>{const n=Number(v);if(!Number.isSafeInteger(n)||n<1)throw Error('Identificador inválido');return n;};
const fail=(s,status=400)=>{throw Object.assign(new Error(s),{status});};
const at=()=>new Date().toISOString();
const fuelTypes=new Set(['GASOLINA','ETANOL','FLEX','DIESEL','GNV','ELETRICO','HIBRIDO','OUTRO']);
const affected=r=>Number(r?.changes??r?.meta?.changes??0);
const stmt=(sql,params=[])=>({sql,params});
function day(value,label,required=false){
 if(value==null||value===''){if(required)fail(label+' obrigatória');return null;}
 const s=String(value);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||
   Number.isNaN(Date.parse(s+'T00:00:00.000Z'))||
   new Date(s+'T00:00:00.000Z').toISOString().slice(0,10)!==s)fail(label+' inválida');
 return s;
}
function addDays(value,count){
 const date=new Date(value+'T00:00:00.000Z');
 date.setUTCDate(date.getUTCDate()+count);
 return date.toISOString().slice(0,10);
}
function number(value,label,{allowZero=false,integer=false}={}){
 if(value==null||value==='')return null;
 const n=Number(value);
 if(!Number.isFinite(n)||(allowZero?n<0:n<=0)||(integer&&!Number.isInteger(n)))
   fail(label+' inválido');
 return n;
}
function year(value){if(value==null||value==='')return null;const n=Number(value);
 if(!Number.isInteger(n)||n<1900||n>2200)fail('Ano inválido');return n;}
export function createAsyncWorkshopAutomotive(port){
 if(!['sqlite','postgres','d1'].includes(port?.engine))fail('Adaptador SQL inválido');
 async function atomic(queries){
   if(port.engine==='d1')return port.batch(queries);
   return port.transaction(async tx=>{
     const results=[];for(const q of queries)results.push(await tx.run(q.sql,q.params));return results;
   });
 }
 async function machine(machineId){
   const row=await port.first('SELECT * FROM machines WHERE id=?',[key(machineId)]);
   if(!row)fail('Veículo não encontrado',404);return row;
 }
 async function part(partId){
   const row=await port.first('SELECT * FROM parts WHERE id=?',[key(partId)]);
   if(!row)fail('Peça não encontrada',404);return row;
 }
 async function workOrderFor(machineId,orderId){
   if(orderId==null||orderId==='')return null;
   const row=await port.first('SELECT machine_id FROM work_orders WHERE id=?',[key(orderId)]);
   if(!row||Number(row.machine_id)!==Number(machineId))
     fail('OS não pertence a este veículo',409);
   return key(orderId);
 }
 async function savePartFitment(partId,input={}){
   await part(partId);
   const brand=norm(input.brand),model=norm(input.model),engine=norm(input.engine),
     from=year(input.yearFrom),to=year(input.yearTo),
     fuel=norm(input.fuelType)||null,notes=clean(input.notes);
   if(!brand||!model||brand.length>80||model.length>80||engine.length>100)
     fail('Marca e modelo obrigatórios para aplicação');
   if(from&&to&&from>to)fail('Ano inicial maior que ano final');
   if(fuel&&!fuelTypes.has(fuel))fail('Combustível inválido');
   if(notes.length>500)fail('Observação excede 500 caracteres');
   const fitmentId=newId();
   await port.run(`INSERT INTO part_fitments(
     id,part_id,brand_key,model_key,year_from,year_to,engine_key,fuel_type,notes,created_at
   ) VALUES(?,?,?,?,?,?,?,?,?,?)`,[
     fitmentId,key(partId),brand,model,from,to,engine,fuel,notes,at()
   ]);
   return port.first('SELECT * FROM part_fitments WHERE id=?',[fitmentId]);
 }
 async function listPartFitments(partId){
   await part(partId);
   return port.all(`SELECT * FROM part_fitments WHERE part_id=?
     ORDER BY brand_key,model_key,year_from,id`,[key(partId)]);
 }
 async function deletePartFitment(partId,fitmentId){
   await part(partId);
   const result=await port.run('DELETE FROM part_fitments WHERE part_id=? AND id=?',
     [key(partId),key(fitmentId)]);
   if(affected(result)!==1)fail('Aplicação não encontrada',404);
   return {ok:true};
 }
 async function listCompatibleParts(machineId){
   const m=await machine(machineId),brand=norm(m.brand),model=norm(m.model),
     engine=norm(m.engine),fuel=norm(m.fuel_type);
   if(!brand||!model)return [];
   const matches=await port.all(`SELECT f.id fitment_id,f.part_id,f.year_from,f.year_to,
     f.engine_key,f.fuel_type,p.sku,p.description,p.quantity
     FROM part_fitments f JOIN parts p ON p.id=f.part_id
     WHERE p.active=1 AND f.brand_key=? AND f.model_key=?
     ORDER BY p.description,f.id`,[brand,model]);
   const seen=new Set();
   return matches.filter(row=>{
     if(seen.has(row.part_id))return false;
     if((row.year_from!=null||row.year_to!=null)&&
       (m.year==null||(row.year_from!=null&&m.year<row.year_from)||
       (row.year_to!=null&&m.year>row.year_to)))return false;
     if(row.engine_key&&row.engine_key!==engine)return false;
     if(row.fuel_type&&row.fuel_type!==fuel)return false;
     seen.add(row.part_id);return true;
   }).map(row=>({id:row.part_id,sku:row.sku,description:row.description,
     quantity:row.quantity,fitment_id:row.fitment_id}));
 }
 async function createDiagnosticScan(machineId,input={}){
   await machine(machineId);
   const orderId=await workOrderFor(machineId,input.workOrderId);
   const notes=clean(input.notes);
   if(notes.length>1500)fail('Observação excede 1500 caracteres');
   let raw,protocol,codes,adapterId='ELM327_SERIAL',source='REAL',details={};
   if(input.adapterId==='J1939'||input.responses){
     const captured=parseDiagnosticCapture(input);
     raw=input.adapterId==='J1939'
       ?JSON.stringify(captured.j1939.frames.slice(0,20))
       :String(input.responses['03']||Object.values(input.responses)[0]||'');
     protocol=captured.protocol;codes=captured.storedCodes;
     adapterId=input.adapterId==='J1939'?'J1939':captured.adapterId;
     source=input.adapterId==='J1939'?'REAL':captured.source;
     details=input.adapterId==='J1939'?captured:{...captured,responses:input.responses};
   }else{
     raw=clean(input.rawResponse);protocol=clean(input.protocol).slice(0,80);
     if(!raw||raw.length>4000)fail('Resposta OBD-II inválida ou muito extensa');
     codes=decodeDtcResponse(raw,{can:/ISO\s*15765|\bCAN\b/i.test(protocol)});
   }
   if(raw.length>4000)fail('Resposta principal excede limite');
   const scanId=newId();
   await port.run(`INSERT INTO obd_scans(
     id,machine_id,work_order_id,protocol,raw_response,codes_json,created_at,
     adapter_id,source,details_json,notes
   ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,[
     scanId,key(machineId),orderId,protocol,raw,JSON.stringify(codes),at(),
     adapterId,source,JSON.stringify(details),notes
   ]);
   return port.first('SELECT * FROM obd_scans WHERE id=?',[scanId]);
 }
 async function listDiagnosticScans(machineId){
   await machine(machineId);
   return port.all('SELECT * FROM obd_scans WHERE machine_id=? ORDER BY id DESC LIMIT 100',[key(machineId)]);
 }
 async function createMaintenancePlan(machineId,input={}){
   const m=await machine(machineId),name=clean(input.name),notes=clean(input.notes);
   if(!name||name.length>120)fail('Nome do plano obrigatório (máx. 120)');
   if(notes.length>500)fail('Observação excede 500 caracteres');
   const days=number(input.intervalDays,'Intervalo em dias',{integer:true}),
     km=number(input.intervalKm,'Intervalo em km'),
     hours=number(input.intervalHours,'Intervalo em horas');
   if(days==null&&km==null&&hours==null)fail('Informe intervalo de manutenção');
   const start=day(input.startingDate,'Data inicial')||at().slice(0,10);
   const meter=input.startingKm===undefined?m.odometer_km:number(input.startingKm,'Quilometragem inicial',{allowZero:true});
   const runtime=input.startingHours===undefined?m.hour_meter:number(input.startingHours,'Horímetro inicial',{allowZero:true});
   if(km!=null&&meter==null)fail('Informe quilometragem inicial');
   if(hours!=null&&runtime==null)fail('Informe horímetro inicial');
   const planId=newId(),stamp=at();
   await port.run(`INSERT INTO maintenance_plans(
     id,machine_id,name,interval_days,interval_km,interval_hours,
     next_due_date,next_due_km,next_due_hours,notes,created_at,updated_at
   ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,[
     planId,m.id,name,days,km,hours,days?addDays(start,days):null,
     km?meter+km:null,hours?runtime+hours:null,notes,stamp,stamp
   ]);
   return port.first('SELECT * FROM maintenance_plans WHERE id=?',[planId]);
 }
 async function listMaintenancePlans(machineId){
   await machine(machineId);
   return port.all(`SELECT * FROM maintenance_plans
     WHERE machine_id=? AND active=1 ORDER BY id DESC`,[key(machineId)]);
 }
 async function listMaintenanceAlerts({today=at().slice(0,10),daysAhead=30,kmAhead=1000,
   hoursAhead=50,limit=null}={}){
   const reference=day(today,'Data de referência',true),
     days=number(daysAhead,'Antecedência em dias',{allowZero:true}),
     km=number(kmAhead,'Antecedência em km',{allowZero:true}),
     hours=number(hoursAhead,'Antecedência em horas',{allowZero:true});
   const cutoff=addDays(reference,days);
   const rows=await port.all(`SELECT p.*,m.brand,m.model,m.license_plate,m.odometer_km,
     m.hour_meter,c.name customer_name
     FROM maintenance_plans p JOIN machines m ON m.id=p.machine_id
     JOIN customers c ON c.id=m.customer_id
     WHERE p.active=1 AND m.active=1 ORDER BY p.id`);
   const findings=[];
   for(const p of rows){
     const overdue=(p.next_due_date&&p.next_due_date<reference)||
       (p.next_due_km!=null&&p.odometer_km!=null&&p.odometer_km>=p.next_due_km)||
       (p.next_due_hours!=null&&p.hour_meter!=null&&p.hour_meter>=p.next_due_hours);
     const soon=(p.next_due_date&&p.next_due_date<=cutoff)||
       (p.next_due_km!=null&&p.odometer_km!=null&&p.odometer_km+km>=p.next_due_km)||
       (p.next_due_hours!=null&&p.hour_meter!=null&&p.hour_meter+hours>=p.next_due_hours);
     if(overdue||soon)findings.push({...p,status:overdue?'ATRASADO':'PROXIMO'});
   }
   findings.sort((a,b)=>(a.status==='ATRASADO'?0:1)-(b.status==='ATRASADO'?0:1));
   return limit==null?findings:findings.slice(0,Math.max(1,Math.min(100,Number(limit)||8)));
 }
 async function listServiceRecords(machineId){
   await machine(machineId);
   return port.all(`SELECT v.*,w.os_number FROM vehicle_maintenance_records v
     LEFT JOIN work_orders w ON w.id=v.work_order_id
     WHERE v.machine_id=? ORDER BY v.created_at DESC,v.id DESC`,[key(machineId)]);
 }
 async function createServiceRecord(machineId,input={}){
   await machine(machineId);
   const kind=clean(input.kind);
   if(!['REVISAO','GARANTIA'].includes(kind))fail('Tipo de revisão/garantia inválido');
   const workOrderId=await workOrderFor(machineId,input.workOrderId);
   const performedAt=day(input.performedAt,'Data da revisão'),
     nextDueDate=day(input.nextDueDate,'Data da próxima revisão'),
     warrantyUntil=day(input.warrantyUntil,'Validade da garantia'),
     nextDueKm=number(input.nextDueKm,'Quilometragem da próxima revisão',{allowZero:true});
   if(kind==='REVISAO'&&!performedAt)fail('Informe a data da revisão');
   if(kind==='GARANTIA'&&!warrantyUntil)fail('Informe validade da garantia');
   const notes=clean(input.notes);if(notes.length>2000)fail('Observações excedem 2.000 caracteres');
   const recordId=newId();
   await port.run(`INSERT INTO vehicle_maintenance_records(
     id,machine_id,work_order_id,kind,performed_at,next_due_date,next_due_km,
     warranty_until,notes,created_at
   ) VALUES(?,?,?,?,?,?,?,?,?,?)`,[
     recordId,key(machineId),workOrderId,kind,performedAt,nextDueDate,
     nextDueKm,warrantyUntil,notes,at()
   ]);
   return port.first('SELECT * FROM vehicle_maintenance_records WHERE id=?',[recordId]);
 }
 async function completeMaintenancePlan(planId,input={}){
   const plan=await port.first(`SELECT * FROM maintenance_plans
     WHERE id=? AND active=1`,[key(planId)]);
   if(!plan)fail('Plano de manutenção não encontrado',404);
   const m=await machine(plan.machine_id);
   const orderId=await workOrderFor(m.id,input.workOrderId);
   const performed=day(input.performedAt,'Data de execução',true);
   if(plan.last_completed_at===performed)fail('Plano já concluído nesta data',409);
   const km=input.odometerKm===undefined?m.odometer_km:
     number(input.odometerKm,'Quilometragem',{allowZero:true});
   const hours=input.hourMeter===undefined?m.hour_meter:
     number(input.hourMeter,'Horímetro',{allowZero:true});
   if(m.odometer_km!=null&&km!=null&&km<m.odometer_km)fail('Quilometragem não pode retroceder');
   if(hours!=null&&Number(hours)<Number(m.hour_meter))fail('Horímetro não pode retroceder');
   if(plan.interval_km!=null&&km==null)fail('Quilometragem obrigatória');
   const nextDate=plan.interval_days?addDays(performed,Number(plan.interval_days)):null,
     nextKm=plan.interval_km?km+Number(plan.interval_km):null,
     nextHours=plan.interval_hours?hours+Number(plan.interval_hours):null;
   const stamp=at(),historyId=newId(),recordId=newId();
   const queries=[
     stmt(`UPDATE machines SET odometer_km=?,hour_meter=?,updated_at=? WHERE id=?`,
       [km,hours,stamp,m.id]),
     stmt(`UPDATE maintenance_plans SET next_due_date=?,next_due_km=?,
       next_due_hours=?,last_completed_at=?,updated_at=?
       WHERE id=? AND (last_completed_at IS NULL OR last_completed_at<>?)`,[
       nextDate,nextKm,nextHours,performed,stamp,plan.id,performed
     ]),
     stmt(`INSERT INTO maintenance_plan_history(
       id,plan_id,work_order_id,performed_at,odometer_km,hour_meter,created_at
     ) ${port.engine==='d1'?'SELECT ?,?,?,?,?,?,? WHERE changes()=1':
       'VALUES(?,?,?,?,?,?,?)'}`,[
       historyId,plan.id,orderId,performed,km,hours,stamp
     ]),
     stmt(`INSERT INTO vehicle_maintenance_records(
       id,machine_id,work_order_id,kind,performed_at,next_due_date,next_due_km,
       notes,created_at
     ) ${port.engine==='d1'?
       'SELECT ?,?,? ,\'REVISAO\',?,?,?,?,? WHERE changes()=1':
       'VALUES(?,?,?,\'REVISAO\',?,?,?,?,?)'}`,[
       recordId,m.id,orderId,performed,nextDate,nextKm,'Plano preventivo: '+plan.name,stamp
     ])
   ];
   if(port.engine==='d1'){
     const result=await port.batch(queries);
     if(affected(result[1])!==1)fail('Plano já concluído nesta data',409);
   }else await port.transaction(async tx=>{
     if(port.engine==='postgres')await tx.first('SELECT id FROM maintenance_plans WHERE id=? FOR UPDATE',[plan.id]);
     await tx.run(queries[0].sql,queries[0].params);
     if(affected(await tx.run(queries[1].sql,queries[1].params))!==1)
       fail('Plano já concluído nesta data',409);
     for(const q of queries.slice(2))await tx.run(q.sql,q.params);
   });
   return port.first('SELECT * FROM maintenance_plans WHERE id=?',[plan.id]);
 }
 return Object.freeze({savePartFitment,listPartFitments,deletePartFitment,
   listCompatibleParts,createDiagnosticScan,listDiagnosticScans,
   createMaintenancePlan,listMaintenancePlans,listMaintenanceAlerts,
   createServiceRecord,listServiceRecords,completeMaintenancePlan});
}
