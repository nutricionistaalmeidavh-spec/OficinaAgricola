import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {openDatabase,migrate} from '../src/db.js';
import {migrateAssistencia} from '../src/assistencia-schema.js';
import {createCommonDataAdapter} from '../src/platform/common-data-adapter.js';
import {createAsyncWorkshopAuth} from '../src/platform/async-workshop-auth.js';

test('common authentication uses existing password hash, scoped session, and role authorization',async()=>{
 const db=openDatabase(':memory:');
 try{
  migrate(db);migrateAssistencia(db);
  const auth=createAsyncWorkshopAuth(createCommonDataAdapter({engine:'sqlite',db}));
  const admin=await auth.bootstrapAdmin({username:'gestor',password:'VeryStrongPass#2026',name:'Gestor'});
  assert.equal(admin.role,'ADMIN');
  await assert.rejects(auth.bootstrapAdmin({username:'outro',password:'AnotherStrongPass#2026',name:'Admin'}),/já|existe|desabilitado/i);
  const login=await auth.login({username:'gestor',password:'VeryStrongPass#2026'});
  assert.equal(login.user.id,admin.id);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions WHERE token_hash=?')
   .get(createHash('sha256').update(login.token).digest('hex')).n,1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions WHERE token_hash=?')
   .get(login.token).n,0,'plaintext tokens are never persisted');
  const clerk=await auth.createUser({username:'balcao',name:'Atendente',role:'ATENDIMENTO',
   password:'ClerkPassword#2026'},login.token);
  assert.equal(clerk.role,'ATENDIMENTO');
  const clerkLogin=await auth.login({username:'balcao',password:'ClerkPassword#2026'});
  assert.equal((await auth.validateSession(clerkLogin.token)).role,'ATENDIMENTO');
  await assert.rejects(auth.createUser({username:'intruso',name:'Usuário',role:'ADMIN',
   password:'Password#2026'},clerkLogin.token),/Permissão/);
  await assert.rejects(auth.login({username:'gestor',password:'wrongPassword'}),/Credenciais/);
  assert.equal((await auth.validateSession(login.token)).role,'ADMIN');
  await auth.logout(clerkLogin.token);
  await assert.rejects(auth.validateSession(clerkLogin.token),/Sessão inválida/);
 }finally{db.close();}
});
test('common auth rejects inactive or expired sessions, and cross-database sessions',async()=>{
 const db1=openDatabase(':memory:'),db2=openDatabase(':memory:');
 try{
  for(const db of [db1,db2]){migrate(db);migrateAssistencia(db);}
  const first=createAsyncWorkshopAuth(createCommonDataAdapter({engine:'sqlite',db:db1}));
  const other=createAsyncWorkshopAuth(createCommonDataAdapter({engine:'sqlite',db:db2}));
  await first.bootstrapAdmin({username:'gestor',name:'Admin',password:'StrongPass#2026'});
  const login=await first.login({username:'gestor',password:'StrongPass#2026'});
  await assert.rejects(other.validateSession(login.token),/Sessão inválida/);
  db1.prepare('UPDATE sessions SET expires_at=?').run('2020-01-01T00:00:00.000Z');
  await assert.rejects(first.validateSession(login.token),/Sessão inválida/);
 }finally{db1.close();db2.close();}
});
