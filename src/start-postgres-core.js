import {createServer} from 'node:http';
import {createPostgresPort} from './platform/async-sql-ports.js';
import {createAsyncWorkshopServices} from './platform/async-workshop-services.js';
import {migrateAsyncTenantStore} from './platform/async-tenant-migrations.js';
import {createAsyncWorkshopHandler} from './platform/async-workshop-handler.js';

// Experimental, separately addressed async tenant API. The existing UI/main
// runtime still uses SQLite until its entire business workflow is ported.
const token=process.env.ASYNC_BACKEND_SERVICE_TOKEN;
const connectionString=process.env.OFICINA_POSTGRES_URL;
if(!token||token.length<32||!connectionString)
 throw Error('Backend PostgreSQL requer token privado e URL explícita');
let Pool;
try{({Pool}=await import('pg'));}
catch{throw Error('Instale o driver open source pg explicitamente para este modo opcional');}
const pool=new Pool({connectionString,max:5,connectionTimeoutMillis:5000,
  idleTimeoutMillis:20000,statement_timeout:10000});
await pool.query('SELECT 1');
const port=createPostgresPort({pool});
const handler=createAsyncWorkshopHandler({
 services:createAsyncWorkshopServices(port),serviceToken:token,
 migrate:()=>migrateAsyncTenantStore(port)
});
const nodeServer=createServer(async(req,res)=>{
 const host='http://127.0.0.1';
 const url=new URL(req.url||'/',host);
 const chunks=[];let length=0;
 for await(const chunk of req){length+=chunk.length;if(length>1048576){res.writeHead(413);res.end();return;}chunks.push(chunk);}
 const body=Buffer.concat(chunks);
 const request=new Request(url,{method:req.method,headers:req.headers,
  ...(['GET','HEAD'].includes(req.method)?{}:{body})});
 const response=await handler(request);
 res.writeHead(response.status,Object.fromEntries(response.headers.entries()));
 res.end(Buffer.from(await response.arrayBuffer()));
});
const host='127.0.0.1',portNumber=Number(process.env.OFICINA_POSTGRES_PORT||3456);
nodeServer.listen(portNumber,host,()=>console.info('[postgres-core] localhost:'+portNumber));
const stop=()=>nodeServer.close(async()=>await pool.end());
process.once('SIGINT',stop);process.once('SIGTERM',stop);
