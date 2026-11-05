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
export function updateStaffUser(db,id,input={}){
 return transaction(db,()=>{
   const old=db.prepare('SELECT * FROM users WHERE id=?').get(id);
   if(!old)throw new Error('Usuário não encontrado');
   const role=input.role??old.role;
   if(!roles.has(role))throw new Error('Perfil inválido');
   if(input.active!==undefined&&typeof input.active!=='boolean')throw new Error('Estado do usuário inválido');
   const active=input.active===undefined?Number(old.active)===1:input.active;
   const name=input.name===undefined?old.name:String(input.name).trim();
   if(name.length<2||name.length>100)throw new Error('Nome deve ter entre 2 e 100 caracteres');
   if(old.role==='ADMIN'&&Number(old.active)===1&&(!active||role!=='ADMIN')){
     const count=db.prepare("SELECT COUNT(*) n FROM users WHERE role='ADMIN' AND active=1").get().n;
     if(count<2)throw new Error('O último administrador ativo não pode ser desativado ou rebaixado');
   }
   const reset=Object.prototype.hasOwnProperty.call(input,'password');
   if(reset&&(typeof input.password!=='string'||input.password.length<8||input.password.length>256))
     throw new Error('A nova senha deve ter entre 8 e 256 caracteres');
   const encoded=reset?hashPassword(input.password):old.password_hash;
   db.prepare('UPDATE users SET name=?,role=?,active=?,password_hash=?,updated_at=? WHERE id=?')
     .run(name,role,active?1:0,encoded,nowIso(),id);
   if(reset||!active)db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
   return db.prepare('SELECT id,username,name,role,active FROM users WHERE id=?').get(id);
 });
}
