import {createD1Port} from '../platform/async-sql-ports.js';
import {createAsyncWorkshopServices} from '../platform/async-workshop-services.js';
import {migrateAsyncTenantStore} from '../platform/async-tenant-migrations.js';
import {createAsyncWorkshopHandler} from '../platform/async-workshop-handler.js';

// Bind DB in Wrangler for each isolated tenant database, with nodejs_compat.
// All routes require the private service token; this Worker is NOT public API.
export default {
 async fetch(request,env){
  if(!env.DB||!env.ASYNC_BACKEND_SERVICE_TOKEN)
   return Response.json({error:'Backend D1 não configurado'}, {status:503});
  const port=createD1Port({binding:env.DB});
  const services=createAsyncWorkshopServices(port);
  return createAsyncWorkshopHandler({
   services,serviceToken:env.ASYNC_BACKEND_SERVICE_TOKEN,
   migrate:()=>migrateAsyncTenantStore(port)
  })(request);
 }
};
