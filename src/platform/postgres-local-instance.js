import {randomBytes} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,readFile,writeFile,rename,unlink,stat,open} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createServer} from 'node:net';
import {verifyPostgresWindowsBundle} from './postgres-windows-bundle.js';

const exec=promisify(execFile);
const fail=message=>{throw Error(message);};
const USER='oficina_local_owner';
const REGISTRY='oficina_registry';
const OPERATIONS='oficina_operations';
const validPort=n=>Number.isInteger(n)&&n>=1024&&n<=65535;
const validSecret=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{40,128}$/.test(s);
const exists=async file=>stat(file).then(()=>true,error=>{
 if(error?.code==='ENOENT')return false;
 throw error;
});
async function ephemeralPort(){
 const server=createServer();
 return new Promise((resolve,reject)=>{
   server.once('error',reject);
   server.listen(0,'127.0.0.1',()=>{
     const port=server.address().port;
     server.close(error=>error?reject(error):resolve(port));
   });
 });
}
async function defaultExecute(file,args){
 return exec(file,args,{windowsHide:true,timeout:60_000,maxBuffer:1024*1024});
}
function connectionUrl(port,password,db){
 return 'postgresql://'+USER+':'+encodeURIComponent(password)+
  '@127.0.0.1:'+port+'/'+db;
}
async function atomicPrivateJson(file,value){
 const temp=file+'.'+randomBytes(6).toString('hex')+'.tmp';
 try{
   await writeFile(temp,JSON.stringify(value),{flag:'wx',mode:0o600});
   await rename(temp,file);
 }finally{await unlink(temp).catch(()=>{});}
}
// Portable PostgreSQL is an app-owned instance, not a system-wide PostgreSQL
// service. This avoids modifying an existing PG installation and supports
// offline, per-user installation without elevated privileges.
export function createPortablePostgresController({
 resourcesPath,dataRoot,platform=process.platform,arch=process.arch,
 execute=defaultExecute,Pool,choosePort=ephemeralPort
}={}){
 if(typeof dataRoot!=='string'||!dataRoot.trim()||
    typeof execute!=='function'||typeof Pool!=='function'||
    typeof choosePort!=='function')
   throw Error('Provisionador PostgreSQL local exige recursos, diretório e driver');
 const root=resolve(dataRoot,'postgres'),cluster=join(root,'cluster'),
   connectionFile=join(root,'connection.json'),logFile=join(root,'postgres.log');
 let owned=false,activeConfig=null,binaries=null;
 async function lock(action){
   await mkdir(root,{recursive:true,mode:0o700});
   const lockFile=join(root,'bootstrap.lock');
   let handle;
   try{handle=await open(lockFile,'wx',0o600);}
   catch(error){
     if(error.code==='EEXIST')
       fail('Provisionamento PostgreSQL já em andamento; não sobrescrever dados');
     throw error;
   }
   try{return await action();}
   finally{
     await handle.close();
     await unlink(lockFile).catch(()=>{});
   }
 }
 async function dbQuery(url,action){
   const pool=new Pool({connectionString:url,max:1,
     connectionTimeoutMillis:5000,idleTimeoutMillis:2000,
     statement_timeout:10000});
   try{return await action(pool);}
   finally{await pool.end();}
 }
 async function verifyRunning(config){
   await dbQuery(connectionUrl(config.port,config.password,'postgres'),async pool=>{
     const result=await pool.query(
       "SELECT current_setting('data_directory') AS data_dir, "+
       "current_setting('port') AS server_port,current_user AS username");
     const row=result.rows?.[0];
     if(!row||String(row.username)!==USER||
        Number(row.server_port)!==config.port||
        resolve(String(row.data_dir)).toLowerCase()!==resolve(cluster).toLowerCase())
       fail('Porta PostgreSQL ocupada por outro servidor; inicialização bloqueada');
   });
 }
 async function provisionDatabases(config){
   await dbQuery(connectionUrl(config.port,config.password,'postgres'),async pool=>{
     for(const db of [REGISTRY,OPERATIONS]){
       const found=await pool.query('SELECT 1 FROM pg_database WHERE datname=$1',[db]);
       if(found.rows.length===0)await pool.query('CREATE DATABASE "'+db+'"');
     }
   });
 }
 async function ensureReady(){
   if(activeConfig)return activeConfig;
   return lock(async()=>{
     const bundle=verifyPostgresWindowsBundle({resourcesPath,platform,arch});
     if(!bundle.valid)fail('PostgreSQL embarcado ausente/inválido: '+bundle.reason);
     binaries=bundle;
     const pgVersion=join(cluster,'PG_VERSION');
     const hasVersion=await exists(pgVersion);
     const hasConfig=await exists(connectionFile);
     if(hasVersion!==hasConfig)
       fail('Instalação PostgreSQL incompleta; recuperação auditada necessária, nunca reinicializar dados');
     let config;
     if(hasConfig){
       try{config=JSON.parse(await readFile(connectionFile,'utf8'));}
       catch{fail('Credenciais PostgreSQL corrompidas; recuperação manual obrigatória');}
       if(config.schemaVersion!==1||config.user!==USER||
          !validPort(config.port)||!validSecret(config.password))
         fail('Credenciais PostgreSQL inválidas; recuperação manual obrigatória');
       if((await readFile(pgVersion,'utf8')).trim()!=='16')
         fail('Cluster PostgreSQL tem versão incompatível; migração de versão obrigatória');
     }else{
       if(await exists(cluster))
         fail('Diretório PostgreSQL já existe sem marcador: recuperação manual obrigatória');
       const port=await choosePort();
       if(!validPort(port))fail('Porta local PostgreSQL inválida');
       config={schemaVersion:1,user:USER,port,
         password:randomBytes(48).toString('base64url')};
       // The secret is persisted BEFORE initdb; a crash must not silently
       // rotate the password of an already initialized cluster.
       await atomicPrivateJson(connectionFile,config);
       const secretFile=join(root,'bootstrap.pw');
       try{
         await writeFile(secretFile,config.password+'\n',{flag:'wx',mode:0o600});
         await execute(join(bundle.bin,'initdb.exe'),[
           '-D',cluster,'-U',USER,'--encoding=UTF8',
           '--auth-host=scram-sha-256','--auth-local=scram-sha-256',
           '--pwfile='+secretFile,'--no-instructions'
         ]);
       }finally{await unlink(secretFile).catch(()=>{});}
       if(!(await exists(pgVersion)))
         fail('initdb não criou um cluster PostgreSQL verificável');
     }
     const pgCtl=join(bundle.bin,'pg_ctl.exe');
     let running=false;
     if(hasVersion){
       try{
         await execute(pgCtl,['status','-D',cluster]);
         running=true;
       }catch{running=false;}
     }
     if(!running){
       const opts='-h 127.0.0.1 -p '+config.port+
         ' -c listen_addresses=127.0.0.1 -c password_encryption=scram-sha-256';
       await execute(pgCtl,[
         '-D',cluster,'-l',logFile,'-o',opts,'-w','-t','45','start'
       ]);
       owned=true;
     }
     await verifyRunning(config);
     await provisionDatabases(config);
     activeConfig=Object.freeze({
       port:config.port,
       registryUrl:connectionUrl(config.port,config.password,REGISTRY),
       operationsUrl:connectionUrl(config.port,config.password,OPERATIONS)
     });
     return activeConfig;
   });
 }
 async function stop(){
   if(!owned||!binaries)return;
   owned=false;
   try{
     await execute(join(binaries.bin,'pg_ctl.exe'),[
       '-D',cluster,'-m','fast','-w','-t','30','stop'
     ]);
   }finally{activeConfig=null;}
 }
 return Object.freeze({ensureReady,stop});
}
