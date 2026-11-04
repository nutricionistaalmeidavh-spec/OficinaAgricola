// Real PostgreSQL 16 integration gate; uses a disposable schema and no paid service.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {createCommonDataAdapter} from '../src/platform/common-data-adapter.js';
import {createPostgresTenantRegistry} from '../src/platform/async-postgres-registry.js';
import {createPostgresRegistryControlHandler} from '../src/platform/postgres-registry-control.js';

const url=process.env.POSTGRES_TEST_URL;
if(!url)throw Error('POSTGRES_TEST_URL é obrigatório neste gate; nunca simular integração PostgreSQL');
const {Pool}=await import('pg');
const schema='oficina_registry_'+randomBytes(6).toString('hex');
const admin=new Pool({connectionString:url,max:1});
await admin.query('CREATE SCHEMA "'+schema+'"');
const pool=new Pool({connectionString:url,max:5,options:'-c search_path='+schema});
const registry=createPostgresTenantRegistry(createCommonDataAdapter({engine:'postgres',pool}));
const adminCredentials={username:'adminprimario',name:'Admin Original',password:'StrongPass2026##'};
try{
 await test('registry PostgreSQL é fail-closed sem bootstrap explicitamente autorizado',async()=>{
   await assert.rejects(registry.initialize(),/bootstrap|vazio|inicializa|inicial/i);
   await registry.initialize({allowBootstrap:true});
   const first=await registry.bootstrapAdmin(adminCredentials);
   assert.equal(first.role,'ADMIN');
   const marker=await pool.query('SELECT pending FROM tenant_registry_bootstrap WHERE id=1');
   assert.equal(marker.rows[0].pending,0,'bootstrap token must be consumed permanently');
   await assert.rejects(registry.bootstrapAdmin(adminCredentials),/administrador|bootstrap|existe/i);
 });
 await test('sessões globais usam hash e respeitam logout e expiração',async()=>{
   const session=await registry.login({username:'ADMINPRIMARIO',password:adminCredentials.password});
   assert.ok(session.token.length>=32);
   const raw=await pool.query('SELECT token_hash FROM sessions WHERE user_id=$1',[session.user.id]);
   assert.equal(raw.rows[0].token_hash,createHash('sha256').update(session.token).digest('hex'));
   assert.equal((await registry.validateSession(session.token)).id,session.user.id);
   await registry.logout(session.token);
   await assert.rejects(registry.validateSession(session.token),/Sessão|sessão/i);
   await assert.rejects(registry.login({username:'adminprimario',password:'senhaerrada'}),/Credenciais/i);
 });
 await test('empresas, unidades e acesso por membership não vazam dados',async()=>{
   const signed=await registry.login({username:'adminprimario',password:adminCredentials.password});
   const actor=signed.user.id;
   assert.equal((await registry.requireUnitMembership(actor,1)).role,'ADMIN');
   const company=await registry.createCompany(actor,{slug:'empresa-a',name:'Empresa A'});
   const unit=await registry.createUnit(actor,{companyId:company.id,code:'FILIAL',name:'Filial Teste'});
   assert.equal(company.unitId>1,true);
   const tech=await registry.grantMembership(actor,{unitId:unit.id,username:'tecnico-a',name:'Tecnico A',password:'StrongPass2026##',role:'TECNICO'});
   assert.equal((await registry.requireUnitMembership(tech.id,unit.id)).role,'TECNICO');
   await assert.rejects(registry.requireUnitMembership(tech.id,company.unitId),/Permissão/i);
   await assert.rejects(registry.createCompany(tech.id,{slug:'intruso',name:'Intruso'}),/Permissão/i);
   await assert.rejects(registry.listUnitMembers(tech.id,unit.id),/Permissão/i);
   const units=await registry.listUserUnits(tech.id);
   assert.deepEqual(units.map(x=>x.id),[unit.id]);
   await assert.rejects(registry.requireCompanyReportingAdmin(tech.id,company.id),/Permissão/i);
   assert.equal(await registry.requireCompanyReportingAdmin(actor,company.id),true);
   assert.equal(await registry.requireCompanyReportingAdmin(actor,company.id),true);
   await assert.rejects(registry.changeMembership(actor,{unitId:unit.id,userId:actor,role:'TECNICO',active:false}),/Último|administrador/i);
   await registry.changeMembership(actor,{unitId:unit.id,userId:tech.id,role:'ADMIN',active:true});
   await registry.grantMembership(actor,{unitId:company.unitId,username:'tecnico-a',role:'ADMIN'});
   await registry.changeMembership(actor,{unitId:unit.id,userId:actor,role:'ADMIN',active:false});
   await assert.rejects(registry.requireUnitMembership(actor,unit.id),/Permissão/i);
   await assert.rejects(registry.requireCompanyReportingAdmin(actor,company.id),/todas|unidades|Permissão/i);
   const records=await registry.listAudit(tech.id,company.id);
   assert.ok(records.some(x=>x.action==='MEMBERSHIP_CHANGED'));
   await assert.rejects(registry.createUnit(tech.id,{companyId:1,code:'FRAUDE',name:'Outro Tenant'}),/Permissão/i);
 });
 await test('API HTTP de controle valida sessão e nunca desvia operação para SQLite',async()=>{
   const http=createPostgresRegistryControlHandler({registry});
   const login=await http(new Request('http://127.0.0.1/api/auth/login',{
     method:'POST',headers:{'content-type':'application/json'},
     body:JSON.stringify({username:'adminprimario',password:adminCredentials.password})}));
   assert.equal(login.status,200);
   const identity=await login.json();
   const authorization='Bearer '+identity.token;
   const context=await http(new Request('http://127.0.0.1/api/tenancy/context',{
     headers:{authorization}}));
   assert.equal(context.status,200);
   assert.equal((await context.json()).platformAdmin,true);
   assert.equal((await http(new Request('http://127.0.0.1/api/tenancy/context'))).status,401);
   const missing=await http(new Request('http://127.0.0.1/api/work-orders',{
     headers:{authorization}}));
   assert.equal(missing.status,501);
   await registry.logout(identity.token);
 });
 await test('registry não pode iniciar sobre um banco operacional por engano',async()=>{
   await pool.query('CREATE TABLE async_tenant_identity(id INTEGER PRIMARY KEY)');
   await assert.rejects(registry.initialize({allowBootstrap:true}),/banco operacional/i);
   await pool.query('DROP TABLE async_tenant_identity');
 });
 await test('conflitos de código são atômicos e não criam filiais duplicadas',async()=>{
   const session=await registry.login({username:'adminprimario',password:adminCredentials.password});
   const actor=session.user.id;
   const a=await registry.createUnit(actor,{companyId:1,code:'NOVAU',name:'Filial Um'});
   assert.ok(a.id>0);
   await assert.rejects(registry.createUnit(actor,{companyId:1,code:'NOVAU',name:'Filial Dois'}),/duplicate|unique|chave|únic/i);
   const rows=await pool.query("SELECT COUNT(*)::integer AS n FROM tenant_units WHERE company_id=1 AND code='NOVAU'");
   assert.equal(rows.rows[0].n,1);
 });
}finally{
 await pool.end();
 await admin.query('DROP SCHEMA "'+schema+'" CASCADE');
 await admin.end();
}
