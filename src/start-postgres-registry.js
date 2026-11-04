// Opt-in PostgreSQL global registry control plane (P2).
// PostgreSQL is self-hostable and does not require any paid service.
// This process deliberately does NOT serve operational SQLite routes.
import {createServer} from 'node:http';
import {createCommonDataAdapter} from './platform/common-data-adapter.js';
import {createPostgresTenantRegistry} from './platform/async-postgres-registry.js';
import {createPostgresRegistryControlHandler} from './platform/postgres-registry-control.js';

const connectionString=process.env.OFICINA_POSTGRES_REGISTRY_URL;
if(typeof connectionString!=='string'||!connectionString.trim())
 throw Error('OFICINA_POSTGRES_REGISTRY_URL é obrigatório; nenhum fallback SQLite');
const bootstrap=process.env.OFICINA_REGISTRY_NEW_INSTALL==='true';
const {Pool}=await import('pg').catch(()=>{
 throw Error('Driver open source pg ausente. Instale explicitamente pg@8 antes de ativar PostgreSQL');
});
const pool=new Pool({
 connectionString,max:5,connectionTimeoutMillis:5000,
 idleTimeoutMillis:20000,statement_timeout:10000
});
try{
 await pool.query('SELECT 1');
 const registry=createPostgresTenantRegistry(createCommonDataAdapter({engine:'postgres',pool}));
 await registry.initialize({allowBootstrap:bootstrap});
 const handle=createPostgresRegistryControlHandler({registry,allowAdminBootstrap:bootstrap});
 const server=createServer(async(req,res)=>{
   const url=new URL(req.url||'/', 'http://127.0.0.1');
   try{
     let size=0;
     const parts=[];
     for await(const part of req){
       size+=part.length;
       if(size>16384){
         res.writeHead(413,{'cache-control':'no-store'});
         res.end();
         return;
       }
       parts.push(part);
     }
     const request=new Request(url,{method:req.method,headers:req.headers,
       ...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(parts)})});
     const answer=await handle(request,{remoteAddress:req.socket.remoteAddress||'unknown'});
     res.writeHead(answer.status,Object.fromEntries(answer.headers.entries()));
     res.end(Buffer.from(await answer.arrayBuffer()));
   }catch(error){
     console.error('[registry-control]',error.message);
     if(!res.headersSent)res.writeHead(500,{'content-type':'application/json','cache-control':'no-store'});
     res.end(JSON.stringify({error:'Falha no controle de acesso PostgreSQL'}));
   }
 });
 const host='127.0.0.1',port=Number(process.env.OFICINA_POSTGRES_REGISTRY_PORT||3457);
 if(!Number.isInteger(port)||port<1024||port>65535)
   throw Error('Porta PostgreSQL registry inválida');
 server.listen(port,host,()=>console.info('[postgres-registry] controle em loopback '+host+':'+port));
 let stopping=false;
 const stop=()=>{
   if(stopping)return;stopping=true;
   server.close(()=>{void pool.end();});
 };
 process.once('SIGINT',stop);
 process.once('SIGTERM',stop);
}catch(error){
 await pool.end();
 throw error;
}
