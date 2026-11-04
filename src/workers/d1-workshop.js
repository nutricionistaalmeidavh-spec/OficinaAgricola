import {createD1Port} from '../platform/async-sql-ports.js';
import {createAsyncWorkshopServices} from '../platform/async-workshop-services.js';
import {migrateAsyncTenantStore,claimAsyncTenantIdentity,assertAsyncTenantIdentity} from '../platform/async-tenant-migrations.js';
import {createAsyncWorkshopHandler} from '../platform/async-workshop-handler.js';
import {createR2ObjectStoreAdapter} from '../platform/r2-object-store.js';

// Bind DB in Wrangler for each isolated tenant database, with nodejs_compat.
// All routes require the private service token; this Worker is NOT public API.
export default {
 async fetch(request,env){
  const companyId=Number(env.ASYNC_TENANT_COMPANY_ID);
  const unitId=Number(env.ASYNC_TENANT_UNIT_ID);
  if(!env.DB||!env.ASYNC_BACKEND_SERVICE_TOKEN||
     !Number.isSafeInteger(companyId)||companyId<1||
     !Number.isSafeInteger(unitId)||unitId<1)
   return Response.json({error:'D1 privado sem identificação de empresa/unidade'}, {status:503});
  const port=createD1Port({binding:env.DB});
  const objectStore=env.OBJECTS
   ?createR2ObjectStoreAdapter({bucket:env.OBJECTS,companyId,unitId})
   :null;
  const services=createAsyncWorkshopServices(port,{objectStore});
  return createAsyncWorkshopHandler({
   services,serviceToken:env.ASYNC_BACKEND_SERVICE_TOKEN,
   migrate:async()=>{
     const result=await migrateAsyncTenantStore(port);
     await claimAsyncTenantIdentity(port,{companyId,unitId});
     return result;
   },
   preflight:()=>assertAsyncTenantIdentity(port,{companyId,unitId})
  })(request);
 }
};
