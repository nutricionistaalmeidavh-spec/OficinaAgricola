import {createPostgresCommandJournal} from './postgres-command-journal.js';
import {createLocalTenantObjectStore} from './local-tenant-object-store.js';
import {createCommonDataAdapter} from './common-data-adapter.js';
import {createAsyncWorkshopServices} from './async-workshop-services.js';
import {createAsyncWorkshopHandler} from './async-workshop-handler.js';
import {migrateAsyncTenantStore,claimAsyncTenantIdentity,assertAsyncTenantIdentity} from './async-tenant-migrations.js';

// A PostgreSQL schema is an isolated logical namespace, not a separate database
// or an OS-level security boundary. Registry memberships are always verified
// on each HTTP request, and tenant connection search_path is schema-only.
const fail=(message,status=503)=>{throw Object.assign(new Error(message),{status});};
const safeId=value=>Number.isSafeInteger(Number(value))&&Number(value)>0;
export function tenantSchemaName(unit,{prefix='oficina'}={}){
 if(!/^[a-z][a-z0-9_]{0,15}$/.test(prefix)||
    !safeId(unit?.id)||!safeId(unit?.companyId))
   fail('Identidade de schema PostgreSQL inválida');
 const schema='of_'+prefix+'_c'+unit.companyId+'_u'+unit.id;
 if(schema.length>63)fail('Nome de schema PostgreSQL excede limite');
 return schema;
}
export function createPostgresTenantRuntimeFactory({
 Pool,connectionString,registry,serviceToken,allowProvision=false,
 schemaPrefix='oficina',objectStoreForUnit=null,localStorageRoot=null,paymentOptionsForUnit=null
}={}){
 if(typeof Pool!=='function'||typeof connectionString!=='string'||!connectionString.trim())
   throw Error('PostgreSQL exige pool e URL operacional explícitos');
 if(!registry||typeof registry.getTenantStorageBinding!=='function'||
    typeof registry.claimTenantStorageBinding!=='function')
   throw Error('Provisionamento SQL exige registry PostgreSQL canônico');
 if(typeof serviceToken!=='string'||serviceToken.length<32)
   throw Error('Token privado do backend inválido');
 if(typeof allowProvision!=='boolean')
   throw Error('Provisionamento deve ser uma escolha explícita');
 const cache=new Map();
 const admin=new Pool({connectionString,max:2,connectionTimeoutMillis:5000,
   idleTimeoutMillis:15000,statement_timeout:10000});
 let closed=false;
 async function connectUnit(unit){
   if(closed)fail('Gateway encerrado');
   const schema=tenantSchemaName(unit,{prefix:schemaPrefix});
   let binding=await registry.getTenantStorageBinding(unit.companyId,unit.id);
   let created=false;
   if(!binding){
     if(!allowProvision)
       fail('Unidade sem schema PostgreSQL: provisionamento explícito necessário');
     const claim=await registry.claimTenantStorageBinding(unit.companyId,unit.id,schema);
     created=claim.created;
     binding={schemaName:claim.schemaName};
   }
   if(binding.schemaName!==schema)
     fail('Schema PostgreSQL diferente do vínculo imutável; cutover bloqueado',409);
   // Binding persists before physical schema provisioning. After a crash,
   // the absence of the bound schema is a recovery incident, never a signal
   // to silently recreate missing tenant data.
   const existing=await admin.query('SELECT 1 FROM pg_namespace WHERE nspname=$1',[schema]);
   if(!existing.rows.length){
     if(!created)fail('Schema de unidade associado ao registry não existe: restauração obrigatória',409);
     await admin.query('CREATE SCHEMA "'+schema+'"');
   }
   const pool=new Pool({connectionString,max:5,connectionTimeoutMillis:5000,
     idleTimeoutMillis:20000,statement_timeout:10000,
     options:'-c search_path='+schema});
   try{
     const basePort=createCommonDataAdapter({engine:'postgres',pool});
     const journal=createPostgresCommandJournal(basePort);
     const port=journal.port;
     if(created){
       await migrateAsyncTenantStore(port);
       await claimAsyncTenantIdentity(port,{companyId:unit.companyId,unitId:unit.id});
     }
     await assertAsyncTenantIdentity(port,{companyId:unit.companyId,unitId:unit.id});
     const objectStore=typeof objectStoreForUnit==='function'
       ?await objectStoreForUnit(unit)
       :localStorageRoot?createLocalTenantObjectStore({
          root:localStorageRoot,companyId:unit.companyId,unitId:unit.id
        }):null;
     const paymentOptions=typeof paymentOptionsForUnit==='function'
       ?paymentOptionsForUnit(unit):{};
     const services=createAsyncWorkshopServices(port,{objectStore,paymentOptions});
     const nativeHandler=createAsyncWorkshopHandler({
       services,
       serviceToken,
       preflight:()=>assertAsyncTenantIdentity(port,{
         companyId:unit.companyId,unitId:unit.id
       })
     });
     const handler=async request=>{
       const key=request.headers.get('x-oficina-command-id');
       const scope=request.headers.get('x-oficina-command-scope');
       if(!key||!scope)return nativeHandler(request);
       if(request.method==='GET'||request.method==='HEAD')
         fail('Journal não aceita GET',400);
       let body;
       try{body=await request.clone().json();}
       catch{fail('Payload de journal inválido',400);}
       try{
         const result=await journal.execute({
           scope,requestId:key,body,action:()=>nativeHandler(request)
         });
         return Response.json(result.body,{status:result.cached?200:result.status});
       }catch(error){
         if(error.safeResponse)
           return new Response(error.safeResponse.body,{
             status:error.safeResponse.status,
             headers:{'content-type':error.safeResponse.contentType}
           });
         throw error;
       }
     };
     return Object.freeze({handler,services,port,commandStatus:journal.commandStatus,
       companyId:unit.companyId,unitId:unit.id,
       schemaName:schema,pool});
   }catch(error){
     await pool.end();
     throw error;
   }
 }
 async function handlerForUnit(unit){
   if(closed)fail('Gateway encerrado');
   const key=String(unit?.companyId)+'/'+String(unit?.id);
   let task=cache.get(key);
   if(!task){
     task=connectUnit(unit);
     cache.set(key,task);
     task.catch(()=>{if(cache.get(key)===task)cache.delete(key);});
   }
   return task;
 }
 async function close(){
   closed=true;
   const tasks=[...cache.values()];
   const settled=await Promise.allSettled(tasks);
   await Promise.all(settled.filter(x=>x.status==='fulfilled')
     .map(x=>x.value.pool.end()));
   await admin.end();
 }
 return Object.freeze({handlerForUnit,close});
}
