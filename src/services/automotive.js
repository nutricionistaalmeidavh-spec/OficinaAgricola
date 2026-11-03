import {nowIso,transaction} from '../db.js';
import {decodeDtcResponse} from './obd.js';
import {parseDiagnosticCapture} from './diagnostics.js';
import {createServiceRecord} from './vehicle-maintenance.js';

const norm=v=>String(v??'').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
const text=v=>String(v??'').trim();
const FUEL=new Set(['GASOLINA','ETANOL','FLEX','DIESEL','GNV','ELETRICO','HIBRIDO','OUTRO']);

function machine(db,id){
  const m=db.prepare('SELECT * FROM machines WHERE id=?').get(id);
  if(!m)throw new Error('Veículo não encontrado');
  return m;
}
function part(db,id){
  const p=db.prepare('SELECT * FROM parts WHERE id=?').get(id);
  if(!p)throw new Error('Peça não encontrada');
  return p;
}
function year(value){
  if(value===undefined||value===null||value==='')return null;
  const n=Number(value);
  if(!Number.isInteger(n)||n<1900||n>2200)throw new Error('Ano inválido');
  return n;
}
function date(value,label,{optional=true}={}){
  if(value===undefined||value===null||value===''){
    if(optional)return null;
    throw new Error(label+' obrigatória');
  }
  const s=String(value);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||Number.isNaN(Date.parse(s+'T00:00:00.000Z'))||
     new Date(s+'T00:00:00.000Z').toISOString().slice(0,10)!==s)throw new Error(label+' inválida');
  return s;
}
function positive(v,label,integer=false){
  if(v===undefined||v===null||v==='')return null;
  const n=Number(v);
  if(!Number.isFinite(n)||n<=0||(integer&&!Number.isInteger(n)))throw new Error(label+' inválido');
  return n;
}
function distance(v,label){
  if(v===undefined||v===null||v==='')return null;
  const n=Number(v);
  if(!Number.isFinite(n)||n<0)throw new Error(label+' inválida');
  return n;
}
function checkOS(db,machineId,workOrderId){
  if(workOrderId===undefined||workOrderId===null||workOrderId==='')return null;
  const id=Number(workOrderId),row=db.prepare('SELECT machine_id FROM work_orders WHERE id=?').get(id);
  if(!row||Number(row.machine_id)!==Number(machineId))throw new Error('OS não pertence a este veículo');
  return id;
}
function addDays(day,interval){
  const d=new Date(day+'T00:00:00.000Z');
  d.setUTCDate(d.getUTCDate()+interval);
  return d.toISOString().slice(0,10);
}

export function savePartFitment(db,partId,input){
  return transaction(db,()=>{
    part(db,partId);
    const brand=norm(input.brand),model=norm(input.model),engine=norm(input.engine);
    const start=year(input.yearFrom),end=year(input.yearTo);
    const fuel=norm(input.fuelType)||null;
    if(!brand||!model||brand.length>80||model.length>80||engine.length>100)
      throw new Error('Marca e modelo obrigatórios para aplicação');
    if(start&&end&&start>end)throw new Error('Ano inicial maior que ano final');
    if(fuel&&!FUEL.has(fuel))throw new Error('Combustível inválido');
    const notes=text(input.notes);if(notes.length>500)throw new Error('Observação excede 500 caracteres');
    const result=db.prepare('INSERT INTO part_fitments(part_id,brand_key,model_key,year_from,year_to,engine_key,fuel_type,notes,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(partId,brand,model,start,end,engine,fuel,notes,nowIso());
    return db.prepare('SELECT * FROM part_fitments WHERE id=?').get(Number(result.lastInsertRowid));
  });
}
export function listPartFitments(db,partId){
  part(db,partId);
  return db.prepare('SELECT * FROM part_fitments WHERE part_id=? ORDER BY brand_key,model_key,year_from').all(partId);
}
export function deletePartFitment(db,partId,id){
  part(db,partId);
  const result=db.prepare('DELETE FROM part_fitments WHERE part_id=? AND id=?').run(partId,id);
  if(!result.changes)throw new Error('Aplicação não encontrada');
  return {ok:true};
}
export function listCompatibleParts(db,machineId){
  const m=machine(db,machineId),brand=norm(m.brand),model=norm(m.model),engine=norm(m.engine),fuel=norm(m.fuel_type);
  if(!brand||!model)return [];
  const rows=db.prepare('SELECT f.id fitment_id,f.part_id,f.year_from,f.year_to,f.engine_key,f.fuel_type,p.id,p.sku,p.description,p.quantity FROM part_fitments f JOIN parts p ON p.id=f.part_id WHERE p.active=1 AND f.brand_key=? AND f.model_key=? ORDER BY p.description').all(brand,model);
  const seen=new Set();
  return rows.filter(row=>{
    if(seen.has(row.part_id))return false;
    if((row.year_from!=null||row.year_to!=null)&&(m.year==null||(row.year_from!=null&&m.year<row.year_from)||(row.year_to!=null&&m.year>row.year_to)))return false;
    if(row.engine_key&&row.engine_key!==engine)return false;
    if(row.fuel_type&&row.fuel_type!==fuel)return false;
    seen.add(row.part_id);return true;
  }).map(row=>({id:row.part_id,sku:row.sku,description:row.description,quantity:row.quantity,fitment_id:row.fitment_id}));
}
export function createDiagnosticScan(db,machineId,input){
  return transaction(db,()=>{
    machine(db,machineId);
    const workOrderId=checkOS(db,machineId,input.workOrderId);
    const notes=text(input.notes);
    if(notes.length>1500)throw new Error('Observação excede 1500 caracteres');
    let raw,protocol,codes,adapterId='ELM327_SERIAL',source='REAL',details={};
    if(input.responses){
      const captured=parseDiagnosticCapture(input);
      raw=String(input.responses['03']||Object.values(input.responses)[0]||'');
      protocol=captured.protocol;
      codes=captured.storedCodes;
      adapterId=captured.adapterId;source=captured.source;
      details={...captured,responses:input.responses};
      if(raw.length>4000)throw new Error('Resposta principal excede limite');
    }else{
      raw=text(input.rawResponse);
      if(!raw||raw.length>4000)throw new Error('Resposta OBD-II inválida ou muito extensa');
      protocol=text(input.protocol).slice(0,80);
      codes=decodeDtcResponse(raw,{can:/ISO\\s*15765|\\bCAN\\b/i.test(protocol)});
    }
    const result=db.prepare(`INSERT INTO obd_scans(machine_id,work_order_id,protocol,raw_response,
      codes_json,created_at,adapter_id,source,details_json,notes) VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .run(machineId,workOrderId,protocol,raw,JSON.stringify(codes),nowIso(),
        adapterId,source,JSON.stringify(details),notes);
    return db.prepare('SELECT * FROM obd_scans WHERE id=?').get(Number(result.lastInsertRowid));
  });
}
export function listDiagnosticScans(db,machineId){
  machine(db,machineId);
  return db.prepare('SELECT * FROM obd_scans WHERE machine_id=? ORDER BY id DESC LIMIT 100').all(machineId);
}
export function createMaintenancePlan(db,machineId,input){
  return transaction(db,()=>{
    const m=machine(db,machineId),name=text(input.name),notes=text(input.notes);
    if(!name||name.length>120)throw new Error('Nome do plano obrigatório (máx. 120)');
    if(notes.length>500)throw new Error('Observação excede 500 caracteres');
    const days=positive(input.intervalDays,'Intervalo em dias',true);
    const km=positive(input.intervalKm,'Intervalo em km');
    const hours=positive(input.intervalHours,'Intervalo em horas');
    if(days===null&&km===null&&hours===null)throw new Error('Informe um intervalo de manutenção');
    const startDate=date(input.startingDate,'Data inicial')||new Date().toISOString().slice(0,10);
    const startKm=input.startingKm===undefined?m.odometer_km:distance(input.startingKm,'Quilometragem inicial');
    const startHours=input.startingHours===undefined?m.hour_meter:distance(input.startingHours,'Horímetro inicial');
    if(km!==null&&startKm===null)throw new Error('Informe a quilometragem inicial');
    if(hours!==null&&startHours===null)throw new Error('Informe o horímetro inicial');
    const now=nowIso();
    const result=db.prepare('INSERT INTO maintenance_plans(machine_id,name,interval_days,interval_km,interval_hours,next_due_date,next_due_km,next_due_hours,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(machineId,name,days,km,hours,days?addDays(startDate,days):null,km?startKm+km:null,hours?startHours+hours:null,notes,now,now);
    return db.prepare('SELECT * FROM maintenance_plans WHERE id=?').get(Number(result.lastInsertRowid));
  });
}
export function listMaintenancePlans(db,machineId){
  machine(db,machineId);
  return db.prepare('SELECT * FROM maintenance_plans WHERE machine_id=? AND active=1 ORDER BY id DESC').all(machineId);
}
export function listMaintenanceAlerts(db,{today=new Date().toISOString().slice(0,10),daysAhead=30,kmAhead=1000,hoursAhead=50}={}){
  const day=date(today,'Data de referência',{optional:false});
  const days=distance(daysAhead,'Antecedência em dias'),km=distance(kmAhead,'Antecedência em km'),hours=distance(hoursAhead,'Antecedência em horas');
  const cutoff=addDays(day,days);
  return db.prepare('SELECT p.*,m.brand,m.model,m.license_plate,m.odometer_km,m.hour_meter,c.name customer_name FROM maintenance_plans p JOIN machines m ON m.id=p.machine_id JOIN customers c ON c.id=m.customer_id WHERE p.active=1 AND m.active=1 ORDER BY p.id').all()
    .map(p=>{
      const overdue=(p.next_due_date&&p.next_due_date<day)||
        (p.next_due_km!=null&&p.odometer_km!=null&&p.odometer_km>=p.next_due_km)||
        (p.next_due_hours!=null&&p.hour_meter!=null&&p.hour_meter>=p.next_due_hours);
      const soon=(p.next_due_date&&p.next_due_date<=cutoff)||
        (p.next_due_km!=null&&p.odometer_km!=null&&p.odometer_km+km>=p.next_due_km)||
        (p.next_due_hours!=null&&p.hour_meter!=null&&p.hour_meter+hours>=p.next_due_hours);
      return {...p,status:overdue?'ATRASADO':soon?'PROXIMO':'EM_DIA'};
    }).filter(p=>p.status!=='EM_DIA').sort((a,b)=>(a.status==='ATRASADO'?0:1)-(b.status==='ATRASADO'?0:1));
}
export function completeMaintenancePlan(db,id,input){
  return transaction(db,()=>{
    const plan=db.prepare('SELECT * FROM maintenance_plans WHERE id=? AND active=1').get(id);
    if(!plan)throw new Error('Plano de manutenção não encontrado');
    const m=machine(db,plan.machine_id);
    const workOrderId=checkOS(db,m.id,input.workOrderId);
    const performedAt=date(input.performedAt,'Data de execução',{optional:false});
    const km=input.odometerKm===undefined?m.odometer_km:distance(input.odometerKm,'Quilometragem');
    const hours=input.hourMeter===undefined?m.hour_meter:distance(input.hourMeter,'Horímetro');
    if(m.odometer_km!=null&&km!=null&&km<m.odometer_km)throw new Error('Quilometragem não pode retroceder');
    if(hours<m.hour_meter)throw new Error('Horímetro não pode retroceder');
    if(plan.interval_km!=null&&km==null)throw new Error('Quilometragem obrigatória');
    const now=nowIso();
    db.prepare('UPDATE machines SET odometer_km=?,hour_meter=?,updated_at=? WHERE id=?')
      .run(km,hours,now,m.id);
    db.prepare('UPDATE maintenance_plans SET next_due_date=?,next_due_km=?,next_due_hours=?,last_completed_at=?,updated_at=? WHERE id=?')
      .run(plan.interval_days?addDays(performedAt,plan.interval_days):null,
        plan.interval_km?km+plan.interval_km:null,
        plan.interval_hours?hours+plan.interval_hours:null,performedAt,now,id);
    db.prepare('INSERT INTO maintenance_plan_history(plan_id,work_order_id,performed_at,odometer_km,hour_meter,created_at) VALUES(?,?,?,?,?,?)')
      .run(id,workOrderId,performedAt,km,hours,now);
    createServiceRecord(db,m.id,{kind:'REVISAO',workOrderId,performedAt,
      nextDueDate:plan.interval_days?addDays(performedAt,plan.interval_days):null,
      nextDueKm:plan.interval_km?km+plan.interval_km:null,
      notes:'Plano preventivo: '+plan.name});
    return db.prepare('SELECT * FROM maintenance_plans WHERE id=?').get(id);
  });
}
