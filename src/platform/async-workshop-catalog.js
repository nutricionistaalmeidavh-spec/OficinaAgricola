import {randomBytes} from 'node:crypto';
// One asynchronous catalog implementation, shared by SQLite, Postgres and D1.
// Keep IDs canonical in the database; no external service is required.
const clean=value=>String(value??'').trim();
const id=value=>{const n=Number(value);if(!Number.isSafeInteger(n)||n<1)throw Error('Identificador inválido');return n;};
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const limitValue=value=>Math.max(1,Math.min(300,Number(value)||200));
const bool=(value,previous=1)=>value===undefined?previous:(value?1:0);
function validateEmail(value){
 const s=clean(value);if(s&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))fail('E-mail inválido');return s;
}
function plate(value){
 const v=clean(value).toUpperCase().replace(/[\s-]/g,'');
 if(v&&!/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(v))fail('Placa inválida');
 return v||null;
}
function vin(value){
 const v=clean(value).toUpperCase().replace(/\s/g,'');
 if(v&&!/^[A-HJ-NPR-Z0-9]{17}$/.test(v))fail('Chassi/VIN inválido');
 return v||null;
}
function renavam(value){
 const v=clean(value).replace(/[.\s-]/g,'');
 if(v&&!/^\d{11}$/.test(v))fail('RENAVAM inválido');
 return v||null;
}
function year(value){
 if(value===null||value===''||value===undefined)return null;
 const n=Number(value);if(!Number.isInteger(n)||n<1900||n>2200)fail('Ano inválido');
 return n;
}
function nonNegative(value,label){
 if(value===null||value===undefined||value==='')return null;
 const n=Number(value);if(!Number.isFinite(n)||n<0)fail(label+' inválido');
 return n;
}
const FUEL=new Set(['GASOLINA','ETANOL','FLEX','DIESEL','GNV','ELETRICO','HIBRIDO','OUTRO']);
function fuel(value){
 const v=clean(value).toUpperCase();
 if(v&&!FUEL.has(v))fail('Combustível inválido');return v||null;
}
export function createAsyncWorkshopCatalog(port){
 if(!['sqlite','postgres','d1'].includes(port?.engine))fail('Adaptador SQL inválido');
 async function listCustomers({search='',includeInactive=false,limit=200,offset=0}={}){
   const q='%'+clean(search)+'%';
   return port.all(`SELECT * FROM customers WHERE (?=1 OR active=1)
     AND (name LIKE ? OR document LIKE ? OR phone LIKE ?)
     ORDER BY name,id LIMIT ? OFFSET ?`,[
     includeInactive?1:0,q,q,q,limitValue(limit),Math.max(0,Number(offset)||0)
   ]);
 }
 async function updateCustomer(customerId,input={}){
   const current=await port.first('SELECT * FROM customers WHERE id=?',[id(customerId)]);
   if(!current)fail('Cliente não encontrado',404);
   const pick=(key,next)=>input[key]===undefined?current[next]:clean(input[key]);
   const name=pick('name','name');if(!name)fail('Nome do cliente obrigatório');
   const at=new Date().toISOString();
   await port.run(`UPDATE customers SET
     name=?,document=?,phone=?,email=?,address=?,notes=?,active=?,updated_at=? WHERE id=?`,[
     name,pick('document','document'),pick('phone','phone'),
     input.email===undefined?current.email:validateEmail(input.email),
     pick('address','address'),pick('notes','notes'),bool(input.active,current.active),at,current.id
   ]);
   return port.first('SELECT * FROM customers WHERE id=?',[current.id]);
 }
 async function listMachines({customerId=null,search='',includeInactive=false,limit=200}={}){
   const args=[includeInactive?1:0];
   const clauses=['(?=1 OR m.active=1)'];
   if(customerId!=null){clauses.push('m.customer_id=?');args.push(id(customerId));}
   if(clean(search)){
     const q='%'+clean(search)+'%';
     clauses.push(`(m.type LIKE ? OR m.brand LIKE ? OR m.model LIKE ?
       OR m.license_plate LIKE ? OR m.vin LIKE ? OR c.name LIKE ?)`);
     args.push(q,q,q,q,q,q);
   }
   args.push(limitValue(limit));
   return port.all(`SELECT m.*,c.name customer_name
     FROM machines m JOIN customers c ON c.id=m.customer_id
     WHERE ${clauses.join(' AND ')} ORDER BY m.id DESC LIMIT ?`,args);
 }
 async function updateMachine(machineId,input={}){
   const current=await port.first('SELECT * FROM machines WHERE id=?',[id(machineId)]);
   if(!current)fail('Máquina não encontrada',404);
   const customerId=input.customerId===undefined?Number(current.customer_id):id(input.customerId);
   if(!await port.first('SELECT id FROM customers WHERE id=?',[customerId]))
     fail('Cliente não encontrado',404);
   const pick=(key,col)=>input[key]===undefined?current[col]:clean(input[key]);
   const type=pick('type','type');if(!type)fail('Tipo da máquina obrigatório');
   const engine=pick('engine','engine');if(engine.length>100)fail('Motorização excede 100 caracteres');
   const odometer=input.odometerKm===undefined?current.odometer_km:nonNegative(input.odometerKm,'Quilometragem');
   const hours=input.hourMeter===undefined?current.hour_meter:nonNegative(input.hourMeter,'Horímetro');
   const at=new Date().toISOString();
   await port.run(`UPDATE machines SET
     customer_id=?,type=?,brand=?,model=?,year=?,serial_number=?,internal_id=?,
     hour_meter=?,license_plate=?,vin=?,odometer_km=?,renavam=?,engine=?,fuel_type=?,
     notes=?,active=?,updated_at=? WHERE id=?`,[
     customerId,type,pick('brand','brand'),pick('model','model'),
     input.year===undefined?current.year:year(input.year),
     pick('serialNumber','serial_number'),pick('internalId','internal_id'),
     hours,input.plate===undefined?current.license_plate:plate(input.plate),
     input.vin===undefined?current.vin:vin(input.vin),odometer,
     input.renavam===undefined?current.renavam:renavam(input.renavam),
     engine,input.fuelType===undefined?current.fuel_type:fuel(input.fuelType),
     pick('notes','notes'),bool(input.active,current.active),at,current.id
   ]);
   return port.first('SELECT * FROM machines WHERE id=?',[current.id]);
 }
 async function createTechnician(input={}){
   const name=clean(input.name);if(!name)fail('Nome do técnico obrigatório');
   const userId=input.userId==null?null:id(input.userId);
   if(userId&&!await port.first('SELECT id FROM users WHERE id=?',[userId]))
     fail('Usuário vinculado não encontrado',404);
   const technicianId=randomBytes(6).readUIntBE(0,6);
   const at=new Date().toISOString();
   await port.run(`INSERT INTO technicians(
     id,name,phone,specialty,user_id,active,created_at,updated_at
   ) VALUES(?,?,?,?,?,?,?,?)`,[
     technicianId,name,clean(input.phone),clean(input.specialty),userId,
     input.active===false?0:1,at,at
   ]);
   return port.first('SELECT * FROM technicians WHERE id=?',[technicianId]);
 }
 async function updateTechnician(technicianId,input={}){
  const key=id(technicianId);
  const old=await port.first('SELECT * FROM technicians WHERE id=?',[key]);
  if(!old)fail('Técnico não encontrado',404);
  const userId=input.userId===undefined?old.user_id:
    input.userId==null?null:id(input.userId);
  if(userId&&!await port.first('SELECT id FROM users WHERE id=?',[userId]))
    fail('Usuário vinculado não encontrado',404);
  const name=input.name===undefined?old.name:clean(input.name);
  if(!name||name.length>160)fail('Nome do técnico inválido');
  await port.run(`UPDATE technicians SET
    name=?,phone=?,specialty=?,user_id=?,active=?,updated_at=? WHERE id=?`,[
    name,input.phone===undefined?old.phone:clean(input.phone),
    input.specialty===undefined?old.specialty:clean(input.specialty),
    userId,input.active===undefined?old.active:bool(input.active,old.active),
    new Date().toISOString(),key
  ]);
  return port.first('SELECT * FROM technicians WHERE id=?',[key]);
 }
 async function listTechnicians({includeInactive=false}={}){
   return port.all(`SELECT * FROM technicians WHERE (?=1 OR active=1)
     ORDER BY name,id`,[includeInactive?1:0]);
 }
 return Object.freeze({listCustomers,updateCustomer,listMachines,updateMachine,
   createTechnician,listTechnicians,updateTechnician});
}
