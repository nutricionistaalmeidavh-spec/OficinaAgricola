// PostgreSQL 16 integration: real browser-compatible /api -> native domain,
// separate tenant schemas, global auth, RBAC, no SQLite queries or credentials.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
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
const attachmentRoot=await mkdtemp(join(tmpdir(),'oficina-p4-storage-'));
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
 schemaPrefix:prefix,localStorageRoot:attachmentRoot
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
     problemReported:'Motor falhando',unitId:999,createdBy:999,requestId:'p4-os-001'
   }});
   assert.equal(order.status,200,JSON.stringify(order.data));
   assert.equal(order.data.status,'ENTRADA');
   assert.equal(order.data.unit_id,1,'tenant internal unit id must be 1');
   const retry=await call('/api/work-orders',{method:'POST',token,body:{
     customerId:customer.data.id,machineId:machine.data.id,
     problemReported:'Motor falhando',unitId:999,createdBy:999,requestId:'p4-os-001'
   }});
   assert.equal(retry.status,200,JSON.stringify(retry.data));
   assert.equal(retry.data.id,order.data.id,'repeated queued HTTP writes must not duplicate an OS');
   const query=new URLSearchParams({
     method:'POST',path:'/api/work-orders',requestId:'p4-os-001'
   });
   const confirmed=await call('/api/commands/status?'+query.toString(),{token});
   assert.equal(confirmed.status,200,JSON.stringify(confirmed.data));
   assert.equal(confirmed.data.status,'CONFIRMED');
   assert.equal(confirmed.data.result.id,order.data.id);
   const orders=await call('/api/work-orders',{token});
   assert.equal(orders.status,200,JSON.stringify(orders.data));
   assert.equal(orders.data.length,1);
   const customerResult=await call('/api/customers',{token});
   assert.equal(customerResult.status,200);
   assert.equal(customerResult.data.length,1);
   const rows=await registryPool.query('SELECT COUNT(*)::integer AS n FROM users');
   assert.equal(rows.rows[0].n,1,'native shadow users must never pollute the global registry');
 });

 await test('PostgreSQL public approval and local attachments preserve browser HTTP behavior',async()=>{
   const signed=await call('/api/auth/login',{method:'POST',body:{
     username:'admin-p4',password:'TestPass2026!'
   }});
   const token=signed.data.token;
   const orders=await call('/api/work-orders',{token});
   const os=orders.data[0];
   assert.ok(os.id);
   const scan='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aZ8AAAAASUVORK5CYII=';
   const upload=await call('/api/work-orders/'+os.id+'/attachments',{
     method:'POST',token,body:{
       category:'DIAGNOSTICO',mimeType:'image/png',originalName:'registro.png',
       base64:scan,requestId:'p4-attachment-001'
     }
   });
   assert.equal(upload.status,200,JSON.stringify(upload.data));
   assert.match(upload.data.relative_path,/^local:/);
   const bytes=await gateway(request('/api/attachments/'+upload.data.id+'/file',{token}));
   assert.equal(bytes.status,200);
   assert.equal(Buffer.from(await bytes.arrayBuffer()).toString('base64'),scan);
   const replay=await call('/api/work-orders/'+os.id+'/attachments',{
     method:'POST',token,body:{
       category:'DIAGNOSTICO',mimeType:'image/png',originalName:'registro.png',
       base64:scan,requestId:'p4-attachment-001'
     }
   });
   assert.equal(replay.data.id,upload.data.id);
   const state=await call('/api/work-orders/'+os.id+'/status',{method:'POST',token,
     body:{toStatus:'DIAGNOSTICO',expectedVersion:os.version}});
   assert.equal(state.status,200,JSON.stringify(state.data));
   const saved=await call('/api/work-orders/'+os.id+'/quote',{method:'PUT',token,
     body:{items:[{kind:'MAO_DE_OBRA',description:'Revisão',quantity:1,unitPriceCents:15000}]}});
   assert.equal(saved.status,200,JSON.stringify(saved.data));
   const submitted=await call('/api/work-orders/'+os.id+'/quote/submit',{method:'POST',token,body:{}});
   assert.equal(submitted.status,200,JSON.stringify(submitted.data));
   const link=await call('/api/work-orders/'+os.id+'/quote/approval-link',{method:'POST',token,
     body:{expiresInHours:48,clientToken:'a'.repeat(64)}});
   assert.equal(link.status,200,JSON.stringify(link.data));
   assert.match(link.data.path,/^\/approval\.html\?token=[a-f0-9]{64}&unit=1$/);
   const repeatLink=await call('/api/work-orders/'+os.id+'/quote/approval-link',{method:'POST',token,
     body:{expiresInHours:48,clientToken:'a'.repeat(64)}});
   assert.equal(repeatLink.status,200,JSON.stringify(repeatLink.data));
   assert.equal(repeatLink.data.token,link.data.token);
   assert.equal(repeatLink.data.expiresAt,link.data.expiresAt,'retry does not extend validity');
   assert.equal(link.data.externalAccess,false);
   const nativeTenant=await factory.handlerForUnit({id:1,companyId:1});
   const hashes=await nativeTenant.port.all('SELECT token_hash FROM quote_approval_links WHERE work_order_id=?',[os.id]);
   assert.equal(hashes.length,1);
   assert.notEqual(hashes[0].token_hash,link.data.token,'only token digest is persisted');
   const publicPath='/api/public/approval/'+link.data.token+'?unit=1';
   const proposed=await call(publicPath);
   assert.equal(proposed.status,200,JSON.stringify(proposed.data));
   assert.equal(proposed.data.status,'ATIVO');
   assert.equal(proposed.data.totalCents,15000);
   const decision=await call(publicPath,{method:'POST',body:{decision:'APROVAR'}});
   assert.equal(decision.status,200,JSON.stringify(decision.data));
   assert.equal(decision.data.status,'APROVADO');
   const replayDecision=await call(publicPath,{method:'POST',body:{decision:'APROVAR'}});
   assert.equal(replayDecision.status,200);
   const invalidCompany=await call('/api/public/approval/'+link.data.token+'?unit=999');
   assert.equal(invalidCompany.status,404);
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

   const summary=await call('/api/tenancy/company-summary?companyId=1',{token});
   assert.equal(summary.status,200,JSON.stringify(summary.data));
   assert.equal(summary.data.totals.workOrders,1);
   assert.equal(summary.data.totals.customers,1);
   const companySummary=await call('/api/tenancy/company-summary?companyId='+company.id,{token});
   assert.equal(companySummary.status,200,JSON.stringify(companySummary.data));
   assert.equal(companySummary.data.totals.customers,0);
   const list=await call('/api/tenancy/shareable-customers?unitId=1',{token});
   assert.equal(list.status,200,JSON.stringify(list.data));
   assert.equal(list.data.customers.length,1);
   const tech=await registry.grantMembership(adminId,{
     unitId:newUnitId,username:'tech-p4',name:'Tecnico P4',
     password:'TestPass2026!',role:'TECNICO'
   });
   const techSession=await registry.login({username:'tech-p4',password:'TestPass2026!'});
   assert.equal(techSession.user.id,tech.id);
   const denied=await call('/api/tenancy/company-summary?companyId='+company.id,{
     token:techSession.token
   });
   assert.equal(denied.status,403,'technician cannot see cross-company finances');
   assert.equal((await call('/api/tenancy/shareable-customers?unitId='+newUnitId,{
     token:techSession.token
   })).status,403);
   const bindingA=await registry.getTenantStorageBinding(1,1);
   const bindingB=await registry.getTenantStorageBinding(company.id,newUnitId);
   assert.notEqual(bindingA.schemaName,bindingB.schemaName);
   assert.equal(bindingA.schemaName,tenantSchemaName({id:1,companyId:1},{prefix}));
   assert.equal(bindingB.schemaName,tenantSchemaName({id:newUnitId,companyId:company.id},{prefix}));
 });
 await test('PostgreSQL journey search, canonical stages and stale sale previews use real persisted state',async()=>{
   const login=await registry.login({username:'admin-p4',password:'TestPass2026!'}),token=login.token;
   const runtime=await factory.handlerForUnit({id:1,companyId:1}),s=runtime.services;
   const c=await s.createCustomer({name:'Zelia jornada antiga'});
   for(let n=0;n<205;n++)await s.createCustomer({name:'A QA '+String(n).padStart(3,'0')});
   const vehicle=await s.createMachine({customerId:c.id,type:'Carro',model:'Uno',plate:'ABC1D23',vin:'9BWZZZ377VT004251'});
   let os=await s.createWorkOrder({customerId:c.id,machineId:vehicle.id,problemReported:'Revisão'});
   const found=await call('/api/customers/page?search=zelia',{token,unit:1});
   assert.equal(found.status,200);assert.equal(found.data.items[0].id,c.id);
   const byPlate=await call('/api/work-orders/page?search=abc-1d23',{token,unit:1});
   assert.equal(byPlate.status,200);assert.equal(byPlate.data.items[0].id,os.id);
   os=await s.updateWorkOrder(os.id,{diagnosis:'Primeiro',expectedVersion:os.version});
   os=await s.updateWorkOrder(os.id,{diagnosis:'Revisado',expectedVersion:os.version});
   assert.equal(os.diagnosis,'Revisado');
   const panel=await s.getDashboard();
   assert.equal(panel.flow.length,7);assert.equal(panel.board.aprovacao.count,0);
   const part=await s.createPart({sku:'QA-PREVIEW',description:'Filtro',salePriceCents:2500});
   await s.postStockMovement({partId:part.id,type:'ENTRADA',quantity:5});
   await s.openCashSession({requestId:'qa-preview-cash'});
   const body={requestId:'qa-price-preview',paymentMethod:'PIX',expectedTotalCents:4000,items:[{partId:part.id,quantity:2,expectedUnitPriceCents:2000}]};
   const rejected=await call('/api/sales',{method:'POST',token,unit:1,body});
   assert.equal(rejected.status,409);assert.equal((await s.getPart(part.id)).quantity,5);
   body.expectedTotalCents=5000;body.items[0].expectedUnitPriceCents=2500;
   const sale=await call('/api/sales',{method:'POST',token,unit:1,body});
   const retry=await call('/api/sales',{method:'POST',token,unit:1,body});
   assert.equal(sale.status,200,JSON.stringify(sale.data));assert.equal(retry.data.id,sale.data.id);
   assert.equal((await s.getPart(part.id)).quantity,3);
 });
  await test('PostgreSQL real: auditoria e recebimento parcial de compras',async()=>{
   const signed=await registry.login({username:'admin-p4',password:'TestPass2026!'});
   const token=signed.token,unit=1;
   const part=await call('/api/parts',{method:'POST',token,unit,
     body:{sku:'QA-PROC-PG',description:'Filtro compras PG',requestId:'qa-proc-part-1'}});
   assert.equal(part.status,200,JSON.stringify(part.data));
   const entry=await call('/api/inventory/movements',{method:'POST',token,unit,
     body:{requestId:'qa-proc-in-1',partId:part.data.id,type:'ENTRADA',quantity:5}});
   assert.equal(entry.status,200,JSON.stringify(entry.data));
   const adjust=await call('/api/inventory/movements',{method:'POST',token,unit,
     body:{requestId:'qa-proc-aj-1',partId:part.data.id,type:'AJUSTE',quantity:-2,
       note:'Conferência física',actorId:999,actorRole:'ATENDIMENTO'}});
   assert.equal(adjust.status,200,JSON.stringify(adjust.data));
   const sup=await call('/api/suppliers',{method:'POST',token,unit,
     body:{requestId:'qa-proc-sup-1',name:'Fornecedor QA PG'}});
   assert.equal(sup.status,200,JSON.stringify(sup.data));
   const po=await call('/api/purchases/orders',{method:'POST',token,unit,
     body:{requestId:'qa-proc-order-1',supplierId:sup.data.id,
       items:[{partId:part.data.id,quantity:10,costCents:1500}]}});
   assert.equal(po.status,200,JSON.stringify(po.data));
   const orderId=po.data.id,itemId=po.data.items[0].id;
   const body={requestId:'qa-proc-rec-1',note:'Entrega parcial',items:[{itemId,quantity:4}]};
   const recv=await call('/api/purchases/orders/'+orderId+'/receipts',{method:'POST',token,unit,body});
   assert.equal(recv.status,200,JSON.stringify(recv.data));
   const replay=await call('/api/purchases/orders/'+orderId+'/receipts',{method:'POST',token,unit,body});
   assert.equal(replay.status,200,JSON.stringify(replay.data));
   assert.equal(replay.data.id,recv.data.id);
   const order=await call('/api/purchases/orders/'+orderId,{token,unit});
   assert.equal(order.data.status,'PARCIAL');
   assert.equal(Number((await call('/api/parts/'+part.data.id,{token,unit})).data.quantity),7);
   const hist=await call('/api/inventory/history?type=AJUSTE&search=QA-PROC-PG',{token,unit});
   assert.equal(hist.status,200,JSON.stringify(hist.data));
   assert.equal(hist.data.items.length,1);
   assert.notEqual(Number(hist.data.items[0].created_by),999);
   const fail=await call('/api/purchases/orders/'+orderId+'/receipts',{method:'POST',token,unit,
     body:{requestId:'qa-proc-over-1',items:[{itemId,quantity:7}]}});
   assert.equal(fail.status,409,JSON.stringify(fail.data));
   assert.equal(Number((await call('/api/parts/'+part.data.id,{token,unit})).data.quantity),7);
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
 await rm(attachmentRoot,{recursive:true,force:true});
}
