import { nowIso } from '../db.js';

const text = (v) => v == null ? '' : String(v).trim();
const boolInt = (v, fallback = 1) => v === undefined ? fallback : (v ? 1 : 0);

function requireName(value, label) {
  const v = text(value); if (!v) throw new Error(`${label} é obrigatório`); return v;
}
function validateEmail(value) {
  const v=text(value); if(v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new Error('E-mail inválido'); return v;
}

export function createCustomer(db, input) {
  const t=nowIso();
  const name=requireName(input.name,'Nome do cliente');
  const result=db.prepare(`INSERT INTO customers(name,document,phone,email,address,notes,active,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(name,text(input.document),text(input.phone),validateEmail(input.email),text(input.address),text(input.notes),boolInt(input.active),t,t);
  return getCustomer(db,Number(result.lastInsertRowid));
}
export function getCustomer(db,id){ const row=db.prepare('SELECT * FROM customers WHERE id=?').get(id); if(!row) throw new Error('Cliente não encontrado'); return row; }
export function listCustomers(db,{includeInactive=false,search=''}={}){
  const q=`%${text(search)}%`; return db.prepare(`SELECT * FROM customers WHERE (?=1 OR active=1) AND (name LIKE ? OR document LIKE ? OR phone LIKE ?) ORDER BY name`).all(includeInactive?1:0,q,q,q);
}
export function updateCustomer(db,id,input){
  const old=getCustomer(db,id); const t=nowIso();
  const next={
    name:input.name===undefined?old.name:requireName(input.name,'Nome do cliente'), document:input.document===undefined?old.document:text(input.document),
    phone:input.phone===undefined?old.phone:text(input.phone), email:input.email===undefined?old.email:validateEmail(input.email),
    address:input.address===undefined?old.address:text(input.address), notes:input.notes===undefined?old.notes:text(input.notes),
    active:boolInt(input.active,old.active)
  };
  db.prepare('UPDATE customers SET name=?,document=?,phone=?,email=?,address=?,notes=?,active=?,updated_at=? WHERE id=?')
    .run(next.name,next.document,next.phone,next.email,next.address,next.notes,next.active,t,id);
  return getCustomer(db,id);
}

function normalizePlate(value){
  const plate=text(value).toUpperCase().replace(/[\s-]/g,'');
  if(plate&&!/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(plate))throw new Error('Placa inválida (7 caracteres)');
  return plate||null;
}
function normalizeVin(value){
  const vin=text(value).toUpperCase().replace(/\s/g,'');
  if(vin&&!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin))throw new Error('VIN/chassi inválido (17 caracteres)');
  return vin||null;
}
function parseOdometer(value){
  if(value===undefined||value===null||value==='')return null;
  const n=Number(value);
  if(!Number.isFinite(n)||n<0)throw new Error('Quilometragem inválida');
  return n;
}
export function createMachine(db,input){
  const owner=db.prepare('SELECT id FROM customers WHERE id=?').get(input.customerId); if(!owner) throw new Error('Cliente não encontrado');
  const hour=Number(input.hourMeter??0); if(!Number.isFinite(hour)||hour<0) throw new Error('Horímetro inválido');
  const year=input.year==null||input.year===''?null:Number(input.year); if(year!==null && (!Number.isInteger(year)||year<1900||year>2200)) throw new Error('Ano inválido');
  const t=nowIso(); const result=db.prepare(`INSERT INTO machines(customer_id,type,brand,model,year,serial_number,internal_id,hour_meter,license_plate,vin,odometer_km,notes,active,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(input.customerId,requireName(input.type,'Tipo da máquina'),text(input.brand),text(input.model),year,text(input.serialNumber),text(input.internalId),hour,
      normalizePlate(input.plate),normalizeVin(input.vin),parseOdometer(input.odometerKm),
      text(input.notes),boolInt(input.active),t,t);
  return getMachine(db,Number(result.lastInsertRowid));
}
export function getMachine(db,id){ const row=db.prepare('SELECT * FROM machines WHERE id=?').get(id); if(!row) throw new Error('Máquina não encontrada'); return row; }
export function listMachines(db,{customerId,includeInactive=false,search=''}={}){
  const clauses=['(?=1 OR m.active=1)']; const params=[includeInactive?1:0];
  if(customerId){clauses.push('m.customer_id=?');params.push(customerId)}
  if(search){clauses.push('(m.type LIKE ? OR m.brand LIKE ? OR m.model LIKE ? OR m.serial_number LIKE ? OR m.license_plate LIKE ? OR m.vin LIKE ? OR c.name LIKE ?)'); const q=`%${text(search)}%`;params.push(q,q,q,q,q,q,q)}
  return db.prepare(`SELECT m.*, c.name customer_name FROM machines m JOIN customers c ON c.id=m.customer_id WHERE ${clauses.join(' AND ')} ORDER BY m.id DESC`).all(...params);
}
export function listCustomerMachines(db,customerId){ getCustomer(db,customerId); return listMachines(db,{customerId,includeInactive:true}); }
export function updateMachine(db,id,input){
  const old=getMachine(db,id); const customerId=input.customerId??old.customer_id; getCustomer(db,customerId);
  const hour=input.hourMeter===undefined?old.hour_meter:Number(input.hourMeter); if(!Number.isFinite(hour)||hour<0) throw new Error('Horímetro inválido');
  const t=nowIso();
  const year=input.year===undefined?old.year:(input.year==null||input.year===''?null:Number(input.year));
  if(year!==null&&(!Number.isInteger(year)||year<1900||year>2200))throw new Error('Ano inválido');
  db.prepare(`UPDATE machines SET customer_id=?,type=?,brand=?,model=?,year=?,serial_number=?,internal_id=?,hour_meter=?,license_plate=?,vin=?,odometer_km=?,notes=?,active=?,updated_at=? WHERE id=?`).run(
    customerId,input.type===undefined?old.type:requireName(input.type,'Tipo da máquina'),input.brand===undefined?old.brand:text(input.brand),input.model===undefined?old.model:text(input.model),
    year,input.serialNumber===undefined?old.serial_number:text(input.serialNumber),
    input.internalId===undefined?old.internal_id:text(input.internalId),hour,
    input.plate===undefined?old.license_plate:normalizePlate(input.plate),
    input.vin===undefined?old.vin:normalizeVin(input.vin),
    input.odometerKm===undefined?old.odometer_km:parseOdometer(input.odometerKm),
    input.notes===undefined?old.notes:text(input.notes),boolInt(input.active,old.active),t,id);
  return getMachine(db,id);
}

export function createTechnician(db,input){
  const t=nowIso(); if(input.userId && !db.prepare('SELECT id FROM users WHERE id=?').get(input.userId)) throw new Error('Usuário não encontrado');
  const r=db.prepare('INSERT INTO technicians(name,phone,specialty,user_id,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
    .run(requireName(input.name,'Nome do técnico'),text(input.phone),text(input.specialty),input.userId??null,boolInt(input.active),t,t);
  return getTechnician(db,Number(r.lastInsertRowid));
}
export function getTechnician(db,id){ const row=db.prepare('SELECT * FROM technicians WHERE id=?').get(id); if(!row) throw new Error('Técnico não encontrado'); return row; }
export function listTechnicians(db,{includeInactive=false}={}){return db.prepare('SELECT * FROM technicians WHERE (?=1 OR active=1) ORDER BY name').all(includeInactive?1:0)}
export function updateTechnician(db,id,input){
  const old=getTechnician(db,id); const userId=input.userId===undefined?old.user_id:input.userId;
  if(userId && !db.prepare('SELECT id FROM users WHERE id=?').get(userId)) throw new Error('Usuário não encontrado');
  db.prepare('UPDATE technicians SET name=?,phone=?,specialty=?,user_id=?,active=?,updated_at=? WHERE id=?').run(
    input.name===undefined?old.name:requireName(input.name,'Nome do técnico'),input.phone===undefined?old.phone:text(input.phone),input.specialty===undefined?old.specialty:text(input.specialty),userId,boolInt(input.active,old.active),nowIso(),id);
  return getTechnician(db,id);
}
