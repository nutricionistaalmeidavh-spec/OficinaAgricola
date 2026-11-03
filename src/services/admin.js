import {transaction,nowIso} from '../db.js';
import {createUser,hashPassword} from '../auth.js';

const roles=new Set(['ADMIN','ATENDIMENTO','TECNICO','FINANCEIRO']);
export function getCompanySettings(db){
 return db.prepare('SELECT * FROM company_settings WHERE id=1').get();
}
const PROFILES=new Set(['MISTA','AUTOMOTIVA','AGRICOLA']);
export function updateCompanySettings(db,input){
 return transaction(db,()=>{
   const old=getCompanySettings(db);
   const profile=input.serviceProfile??old.service_profile;
   if(!PROFILES.has(profile))throw new Error('Perfil de oficina inválido');
   db.prepare(`UPDATE company_settings SET name=?,document=?,phone=?,email=?,address=?,service_profile=?,updated_at=? WHERE id=1`)
     .run(input.name??old.name,input.document??old.document,input.phone??old.phone,
       input.email??old.email,input.address??old.address,profile,nowIso());
   return getCompanySettings(db);
 });
}
export function listStaffUsers(db){
 return db.prepare('SELECT id,username,name,role,active,created_at FROM users ORDER BY name').all();
}
export function createStaffUser(db,input){
 return transaction(db,()=>{
   const id=createUser(db,input);
   return db.prepare('SELECT id,username,name,role,active FROM users WHERE id=?').get(id);
 });
}
export function updateStaffUser(db,id,input){
 return transaction(db,()=>{
   const old=db.prepare('SELECT * FROM users WHERE id=?').get(id);
   if(!old)throw new Error('Usuário não encontrado');
   const role=input.role??old.role;
   if(!roles.has(role))throw new Error('Perfil inválido');
   db.prepare(`UPDATE users SET name=?,role=?,active=?,password_hash=?,updated_at=? WHERE id=?`)
     .run(input.name??old.name,role,input.active===undefined?old.active:(input.active?1:0),
       input.password?hashPassword(input.password):old.password_hash,nowIso(),id);
   return db.prepare('SELECT id,username,name,role,active FROM users WHERE id=?').get(id);
 });
}
