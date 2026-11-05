import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openDatabase,migrate} from '../src/db.js';
import {createUser,login,validateSession} from '../src/auth.js';
import {updateStaffUser,listStaffUsers} from '../src/services/admin.js';
import {migrateTenantRegistry,registerInitialAdmin,grantUnitMembership,listUnitMembers,changeUnitMembership,createTenantCompany} from '../src/platform/tenant-registry.js';
const p=['Test','Only','Access','2026'].join('-');
const user=(username,name,role)=>({username,name,role,password:p});
test('local staff edits invalidate prior sessions and protect last administrator',()=>{
 const db=openDatabase(':memory:');try{migrate(db);
 const a=createUser(db,user('owner','Owner','ADMIN'));
 const b=createUser(db,user('staff','Staff','TECNICO'));
 const signed=login(db,'staff',p);
 const updated=updateStaffUser(db,b,{name:'Staff Updated',role:'FINANCEIRO',password:p+'-New'});
 assert.equal(updated.role,'FINANCEIRO');assert.equal(updated.name,'Staff Updated');
 assert.throws(()=>validateSession(db,signed.token),/sessão/i);
 updateStaffUser(db,b,{active:false});assert.equal(listStaffUsers(db).find(u=>u.id===b).active,0);
 assert.throws(()=>updateStaffUser(db,a,{active:false}),/último administrador/i);
 assert.throws(()=>updateStaffUser(db,a,{role:'TECNICO'}),/último administrador/i);
 }finally{db.close()}
});
test('tenant membership protects shared identities and supports unit status',()=>{
 const db=openDatabase(':memory:');try{migrateTenantRegistry(db);
 const a=createUser(db,user('owner','Owner','ADMIN'));registerInitialAdmin(db,a);
 const m=createUser(db,user('manager','Manager','ADMIN'));
 const s=createUser(db,user('staff','Staff','TECNICO'));
 grantUnitMembership(db,a,{unitId:1,username:'manager',role:'ADMIN'});
 grantUnitMembership(db,a,{unitId:1,username:'staff',role:'TECNICO'});
 assert.equal(listUnitMembers(db,a,1).find(u=>u.id===s).identityEditable,true);
 const auth=login(db,'staff',p);
 changeUnitMembership(db,a,{unitId:1,userId:s,role:'FINANCEIRO',active:true,name:'Staff Updated',password:p+'-New'});
 assert.throws(()=>validateSession(db,auth.token),/sessão/i);
 const unit=createTenantCompany(db,a,{slug:'second-tenant',name:'Second Tenant'});
 grantUnitMembership(db,a,{unitId:unit.unitId,username:'staff',role:'TECNICO'});
 assert.equal(listUnitMembers(db,m,1).find(u=>u.id===s).identityEditable,false);
 assert.throws(()=>changeUnitMembership(db,m,{unitId:1,userId:s,role:'FINANCEIRO',password:p+'-Other'}),/outras unidades|compartilhada/i);
 assert.throws(()=>changeUnitMembership(db,m,{unitId:1,userId:a,role:'ADMIN',name:'Wrong Owner'}),/plataforma/i);
 changeUnitMembership(db,m,{unitId:1,userId:s,role:'FINANCEIRO',active:false});
 assert.equal(listUnitMembers(db,m,1).find(u=>u.id===s).membershipActive,0);
 }finally{db.close()}
});
test('settings exposes secure staff management actions',()=>{
 const s=readFileSync('public/app-admin.js','utf8');
 assert.match(s,/data-user-action/);assert.match(s,/Redefinir senha/);
 assert.match(s,/Desativar|Reativar/);assert.match(s,/method:'PATCH'/);
});
