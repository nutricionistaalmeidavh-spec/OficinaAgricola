import {createServer} from 'node:http';
import {createPostgresPort} from './platform/async-sql-ports.js';
import {createAsyncWorkshopServices} from './platform/async-workshop-services.js';
import {migrateAsyncTenantStore,claimAsyncTenantIdentity,assertAsyncTenantIdentity} from './platform/async-tenant-migrations.js';
import {createAsyncWorkshopHandler} from './platform/async-workshop-handler.js';
import {createS3BackupClient} from './platform/s3-backup.js';

// Experimental, separately addressed async tenant API. The existing UI/main
// runtime still uses SQLite until its entire business workflow is ported.
const token=process.env.ASYNC_BACKEND_SERVICE_TOKEN;
const connectionString=process.env.OFICINA_POSTGRES_URL;
const companyId=Number(process.env.ASYNC_TENANT_COMPANY_ID);
const unitId=Number(process.env.ASYNC_TENANT_UNIT_ID);
if(!token||token.length<32||!connectionString||
   !Number.isSafeInteger(companyId)||companyId<1||
   !Number.isSafeInteger(unitId)||unitId<1)
 throw Error('Backend PostgreSQL exige token, URL e identidade explícita de empresa/unidade');
let Pool;
try{({Pool}=await import('pg'));}
catch{throw Error('Instale o driver open source pg explicitamente para este modo opcional');}
const pool=new Pool({connectionString,max:5,connectionTimeoutMillis:5000,
  idleTimeoutMillis:20000,statement_timeout:10000});
await pool.query('SELECT 1');
const port=createPostgresPort({pool});
const storageMode=String(process.env.OFICINA_OBJECT_STORAGE||'none').toLowerCase();
if(!['none','s3'].includes(storageMode))
 throw Error('PostgreSQL nativo permite object storage none ou s3 explícito');
const objectStore=storageMode==='s3'?createS3BackupClient({
 endpoint:process.env.OFICINA_ATTACHMENT_S3_ENDPOINT,
 bucket:process.env.OFICINA_ATTACHMENT_S3_BUCKET,
 region:process.env.OFICINA_ATTACHMENT_S3_REGION||'us-east-1',
 accessKeyId:process.env.OFICINA_ATTACHMENT_S3_ACCESS_KEY_ID,
 secretAccessKey:process.env.OFICINA_ATTACHMENT_S3_SECRET_ACCESS_KEY,
 prefix:(process.env.OFICINA_ATTACHMENT_S3_PREFIX||'oficina-attachments')+
   '/company-'+companyId+'/unit-'+unitId
}):null;
const handler=createAsyncWorkshopHandler({
 services:createAsyncWorkshopServices(port,{objectStore}),serviceToken:token,
 migrate:async()=>{
   const result=await migrateAsyncTenantStore(port);
   await claimAsyncTenantIdentity(port,{companyId,unitId});
   return result;
 },
 preflight:()=>assertAsyncTenantIdentity(port,{companyId,unitId})
});
const nodeServer=createServer(async(req,res)=>{
 const host='http://127.0.0.1';
 const url=new URL(req.url||'/',host);
 // Base64-encoded 5 MiB attachments require roughly 6.7 MiB of JSON.
 // All other routes stay at the strict 1 MiB request limit.
 const maxBody=req.method==='POST'&&/^\/v1\/orders\/\d+\/attachments$/.test(url.pathname)
   ?7*1024*1024:1048576;
 const chunks=[];let length=0;
 for await(const chunk of req){length+=chunk.length;if(length>maxBody){res.writeHead(413);res.end();return;}chunks.push(chunk);}
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
