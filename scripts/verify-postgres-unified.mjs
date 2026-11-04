// PostgreSQL 16 integration: real browser-compatible /api -> native domain,
// separate tenant schemas, global auth, RBAC, no SQLite queries or credentials.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createCommonDataAdapter} from '../src/platform/common-data-adapter.js';
import {createPostgresTenantRegistry} from '../src/platform/async-postgres-registry.js';
import {createPostgresTenantRuntimeFactory,tenantSchemaName} from '../src/platform/postgres-tenant-runtime.js';
import {createPostgresUnifiedGateway} from '../src/platform/postgres-unified-gateway.js';

if(!process.env.POSTGRES_TEST_URL)
 throw Error('POSTGRES_TEST_URL obrigatório: testes de integração não podem usar fake SQLite');
const {Pool}=await import('pg');
const url=process.env.POSTGRES_TEST_URL;
const suffix=randomBytes(5).toString('hex'),prefix='p4'+suffix;
const registrySchema='oficina_registry_p4_'+suffix;
const admin=new Pool({connectionString:url,max:1});
await admin.query('CREATE SCHEMA "'+registrySchema+'"');
const registryPool=new Pool({
 connectionString:url,options:'-c search_path='+registrySchema,max:5
});
const serviceToken='p4-service-token-'+randomBytes(32).toString('base64url');
const registry=createPostgresTenantRegistry(createCommonDataAdapter({
 engine:'postgres',pool:registryPool
}));
const factory=createPostgresTenantRuntimeFactory({
 Pool,connectionString:url,registry,serviceToken,allowProvision:true,
 schemaPrefix:prefix
});
const gateway=createPostgresUnifiedGateway({
 registry,tenantHandlerForUnit:factory.handlerForUnit,
 serviceToken,allowAdminBootstrap:true
});
const request=(path,{method='GET',body,token,unit}={})=>new Request('http://127.0.0.1:3344'+path,{
 method,headers:{
   ...(token?{authorization:'Bearer '+token}:{}),
   ...(unit?{'x-oficina-unit':String(unit)}:{}),
   ...(body?{'content-type':'application/json'}:{})
 },...(body?{body:JSON.stringify(body)}:{})
});
const call=async(path,args)=>{
 const response=await gateway(request(path,args));
 let data;
 try{data=await response.json();}catch{data={};}
 return {status:response.status,data};
};
let newUnitId=null;
try{
 await test('PostgreSQL global registry boots without SQLite and protects empty state',async()=>{
   await assert.rejects(registry.initialize(),/bootstrap|vazio/i);
   await registry.initialize({allowBootstrap:true});
   const actor=await registry.bootstrapAdmin({
     username:'admin-p4',name:'Administrador P4',password:'TestPass2026!'
   });
   assert.equal(actor.role,'ADMIN');
 });
 await test('legacy UI HTTP contract creates customers, machine and OS on PostgreSQL',async()=>{
   const signed=await call('/api/auth/login',{method:'POST',body:{
     username:'admin-p4',password:'TestPass2026!'
   }});
   assert.equal(signed.status,200,JSON.stringify(signed.data));
   const token=signed.data.token;
   const customer=await call('/api/customers',{
     method:'POST',token,body:{name:'Cliente PostgreSQL A'}
   });
   assert.equal(customer.status,200,JSON.stringify(customer.data));
   const machine=await call('/api/machines',{method:'POST',token,body:{
     customerId:customer.data.id,type:'AUTOMOVEL',model:'Trator'
   }});
   assert.equal(machine.status,200,JSON.stringify(machine.data));
   const order=await call('/api/work-orders',{method:'POST',token,body:{
     customerId:customer.data.id,machineId:machine.data.id,
     problemReported:'Motor falhando',unitId:999,createdBy:999
   }});
   assert.equal(order.status,200,JSON.stringify(order.data));
   assert.equal(order.data.status,'ENTRADA');
   assert.equal(order.data.unit_id,1,'tenant internal unit id must be 1');
   const orders=await call('/api/work-orders',{token});
   assert.equal(orders.status,200,JSON.stringify(orders.data));
   assert.equal(orders.data.length,1);
   const customerResult=await call('/api/customers',{token});
   assert.equal(customerResult.status,200);
   assert.equal(customerResult.data.length,1);
   const rows=await registryPool.query('SELECT COUNT(*)::integer AS n FROM users');
   assert.equal(rows.rows[0].n,1,'native shadow users must never pollute the global registry');
 });
 await test('PostgreSQL schemas isolate two companies and membership is checked per request',async()=>{
   const signed=await call('/api/auth/login',{method:'POST',body:{
     username:'admin-p4',password:'TestPass2026!'
   }});
   const token=signed.data.token,adminId=signed.data.user.id;
   const company=await registry.createCompany(adminId,{slug:'filial-p4',name:'Empresa Separada'});
   newUnitId=company.unitId;
   assert.ok(newUnitId>1);
   const ambiguous=await call('/api/customers',{token});
   assert.equal(ambiguous.status,409);
   const second=await call('/api/customers',{token,unit:newUnitId});
   assert.equal(second.status,200,JSON.stringify(second.data));
   assert.deepEqual(second.data,[]);
   const first=await call('/api/customers',{token,unit:1});
   assert.equal(first.status,200);
   assert.equal(first.data.length,1);
   const actor=await registry.requireUnitMembership(adminId,newUnitId);
   assert.equal(actor.companyId,company.id);
   const other=await call('/api/customers',{token,unit:9999});
   assert.equal(other.status,403);
   const bindingA=await registry.getTenantStorageBinding(1,1);
   const bindingB=await registry.getTenantStorageBinding(company.id,newUnitId);
   assert.notEqual(bindingA.schemaName,bindingB.schemaName);
   assert.equal(bindingA.schemaName,tenantSchemaName({id:1,companyId:1},{prefix}));
   assert.equal(bindingB.schemaName,tenantSchemaName({id:newUnitId,companyId:company.id},{prefix}));
 });
 await test('bound PostgreSQL tenant fails closed if physical schema is missing',async()=>{
   const adminId=(await registry.login({username:'admin-p4',password:'TestPass2026!'})).user.id;
   const company=await registry.createCompany(adminId,{slug:'sem-schema',name:'Sem Schema'});
   const schema=tenantSchemaName({id:company.unitId,companyId:company.id},{prefix});
   await registry.claimTenantStorageBinding(company.id,company.unitId,schema);
   await assert.rejects(factory.handlerForUnit({id:company.unitId,companyId:company.id}),
     /restauração obrigatória|não existe/i);
 });
}finally{
 await factory.close();
 await registryPool.end();
 const schemas=await admin.query(
  'SELECT nspname FROM pg_namespace WHERE nspname LIKE $1 OR nspname=$2',
  ['of_'+prefix+'_%',registrySchema]);
 for(const item of schemas.rows){
   if(!/^of_[a-z0-9_]+_c[0-9]+_u[0-9]+$/.test(item.nspname)&&
     item.nspname!==registrySchema)continue;
   await admin.query('DROP SCHEMA "'+item.nspname+'" CASCADE');
 }
 await admin.end();
}
