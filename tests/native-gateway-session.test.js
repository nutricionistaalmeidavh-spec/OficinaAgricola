import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,migrate} from '../src/db.js';
import {migrateAssistencia} from '../src/assistencia-schema.js';
import {createCommonDataAdapter} from '../src/platform/common-data-adapter.js';
import {createAsyncWorkshopAuth} from '../src/platform/async-workshop-auth.js';

test('native unit provisions a short-lived scoped gateway session without copying passwords',async()=>{
 const db=openDatabase(':memory:');
 try{
  migrate(db);migrateAssistencia(db);
  const auth=createAsyncWorkshopAuth(createCommonDataAdapter({engine:'sqlite',db}));
  const token='s'.repeat(43);
  const input={globalUserId:42,name:'Funcionário da matriz',role:'TECNICO',
    sessionToken:token,expiresAt:new Date(Date.now()+3600000).toISOString()};
  await auth.provisionGatewaySession(input);
  assert.equal((await auth.validateSession(token)).role,'TECNICO');
  const row=db.prepare("SELECT id,password_hash,username FROM users WHERE username='gateway_42'").get();
  assert.ok(row.id>2**48,'internal gateway users have a disjoint ID range');
  assert.ok(!row.password_hash.includes('Funcionário'));
  await assert.rejects(auth.login({username:'gateway_42',password:'qualquer'}),/Credenciais/);
  await auth.provisionGatewaySession({...input,role:'FINANCEIRO'});
  assert.equal((await auth.validateSession(token)).role,'FINANCEIRO',
   'role demotion is reflected before the next operation');
  const session=db.prepare('SELECT expires_at FROM sessions WHERE token_hash=?')
   .get((await import('node:crypto')).createHash('sha256').update(token).digest('hex'));
  assert.ok(Date.parse(session.expires_at)<=Date.now()+65000,'native session is bounded to one minute');
 }finally{db.close();}
});
test('gateway session rejects untrusted users, role and expiration',async()=>{
 const db=openDatabase(':memory:');
 try{
  migrate(db);migrateAssistencia(db);
  const auth=createAsyncWorkshopAuth(createCommonDataAdapter({engine:'sqlite',db}));
  const good={globalUserId:2,name:'Teste',role:'ADMIN',sessionToken:'x'.repeat(43),
   expiresAt:new Date(Date.now()+3600000).toISOString()};
  await assert.rejects(auth.provisionGatewaySession({...good,role:'ROOT'}),/Função|papel|role|Permissão/);
  await assert.rejects(auth.provisionGatewaySession({...good,globalUserId:-1}),/identidade|Usuário/i);
  await assert.rejects(auth.provisionGatewaySession({...good,expiresAt:'2020-01-01T00:00:00Z'}),/expirad|Sessão/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users WHERE username LIKE 'gateway_%'").get().n,0);
 }finally{db.close();}
});
