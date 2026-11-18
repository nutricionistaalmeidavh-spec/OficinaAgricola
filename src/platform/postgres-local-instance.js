import {randomBytes,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,rename,unlink,stat,open,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createServer} from 'node:net';
import {verifyPostgresWindowsBundle} from './postgres-windows-bundle.js';

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
// initdb can exceed one minute on slower disks or when Windows Defender
// inspects the embedded PostgreSQL binaries during the first installation.
export function postgresExecutableTimeout(file){
 return /(?:^|[\\/])initdb\.exe$/i.test(file)?300_000:60_000;
}
function processFailureDiagnostic(error){
 const numeric=typeof error?.code==='number'?error.code:null;
 const code=numeric===null?String(error?.code??'unknown'):
   '0x'+(numeric>>>0).toString(16).padStart(8,'0').toUpperCase();
 const label=code==='0xC0000135'?' (DLL do Visual C++ ausente no Windows)':'';
 // Include executable stderr/stdout for offline support; never include
 // command-line arguments or PostgreSQL connection credentials.
 const safe=value=>String(value??'').slice(-6000)
   .replace(/postgresql:\/\/[^\s"'<>]+/gi,'[CONNECTION_REDACTED]')
   .replace(/--pwfile=[^\s"'<>]+/gi,'--pwfile=[REDACTED]');
 return {code,signal:String(error?.signal??''),killed:Boolean(error?.killed),
   stdout:safe(error?.stdout),stderr:safe(error?.stderr),
   detail:'Código '+code+label};
}

// PostgreSQL initdb and pg_ctl spawn subprocesses. On Windows their children
// can inherit stdout/stderr pipe handles, so execFile() waits for pipe EOF
// even if the command itself has exited. This caused false startup timeouts.
// Direct stdout/stderr into a private FILE instead of pipes and wait only for
// the invoked executable's exit; no terminal or paid runtime is required.
export async function runPortablePostgresProcess(file,args,{
 logFile,timeoutMs=postgresExecutableTimeout(file)
}={}){
 if(typeof logFile!=='string'||!logFile.trim())throw Error('Arquivo de diagnóstico PostgreSQL obrigatório');
 const output=await open(logFile,'a',0o600);
 try{
   return await new Promise((resolve,reject)=>{
     const child=spawn(file,args,{
       windowsHide:true,stdio:['ignore',output.fd,output.fd]
     });
     let timedOut=false;
     const timer=setTimeout(()=>{
       timedOut=true;
       child.kill();
     },timeoutMs);
     child.once('error',error=>{
       clearTimeout(timer);
       reject(error);
     });
     child.once('close',(code,signal)=>{
       clearTimeout(timer);
       if(timedOut){
         reject(Object.assign(new Error('PostgreSQL subprocess timed out'),{
           code:'ETIMEDOUT',killed:true,signal
         }));
       }else if(code!==0){
         reject(Object.assign(new Error('PostgreSQL process failed with exit code '+code),{
           code,signal
         }));
       }else resolve({stdout:'',stderr:''});
     });
   });
 }finally{await output.close();}
}
async function defaultExecute(file,args,options={}){
 return runPortablePostgresProcess(file,args,{
   logFile:options.logFile,timeoutMs:postgresExecutableTimeout(file)
 });
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
   connectionFile=join(root,'connection.json'),logFile=join(root,'postgres.log'),
   pendingFile=join(root,'bootstrap.pending.json');
 let owned=false,activeConfig=null,binaries=null;
 const executeLogged=(file,args)=>execute(file,args,{logFile:join(root,'postgres-process.log')});
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
 async function provisionDatabases(config,{fresh=false}={}){
   await dbQuery(connectionUrl(config.port,config.password,'postgres'),async pool=>{
     for(const db of [REGISTRY,OPERATIONS]){
       const found=await pool.query('SELECT 1 FROM pg_database WHERE datname=$1',[db]);
       if(found.rows.length===0){
         if(!fresh)fail('Banco PostgreSQL desapareceu: restauração obrigatória, sem recriação silenciosa');
         await pool.query('CREATE DATABASE "'+db+'"');
       }
     }
   });
 }
 function bootstrapMarker(config){
   // Fingerprint ties a bootstrap attempt to exactly the original credentials.
   // The marker contains no secret and is removed only after both databases exist.
   return {schemaVersion:1,configDigest:createHash('sha256')
     .update(JSON.stringify([config.user,config.port,config.password]))
     .digest('hex')};
 }
 async function isBootstrapPending(config){
   if(!(await exists(pendingFile)))return false;
   let marker;
   try{marker=JSON.parse(await readFile(pendingFile,'utf8'));}
   catch{fail('Marcador PostgreSQL de instalação inicial inválido; recuperação auditada necessária');}
   const expected=bootstrapMarker(config);
   if(marker.schemaVersion!==1||marker.configDigest!==expected.configDigest)
     fail('Marcador PostgreSQL não corresponde às credenciais; recuperação auditada necessária');
   return true;
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
     // A cluster without its credentials may contain real customer data.
     if(hasVersion&&!hasConfig)
       fail('Cluster PostgreSQL sem credenciais; recuperação auditada necessária, nunca reinicializar dados');
     let config;
     if(hasConfig){
       try{config=JSON.parse(await readFile(connectionFile,'utf8'));}
       catch{fail('Credenciais PostgreSQL corrompidas; recuperação manual obrigatória');}
       if(config.schemaVersion!==1||config.user!==USER||
          !validPort(config.port)||!validSecret(config.password))
         fail('Credenciais PostgreSQL inválidas; recuperação manual obrigatória');
       if(hasVersion&&(await readFile(pgVersion,'utf8')).trim()!=='16')
         fail('Cluster PostgreSQL tem versão incompatível; migração de versão obrigatória');
     }else{
       // A crashed installation can leave a pending marker before credentials
       // are written. Never reuse a non-empty orphan cluster in this case.
       if((await exists(cluster))&&(await readdir(cluster)).length)
         fail('Diretório PostgreSQL já existe sem credenciais: recuperação manual obrigatória');
       const port=await choosePort();
       if(!validPort(port))fail('Porta local PostgreSQL inválida');
       config={schemaVersion:1,user:USER,port,
         password:randomBytes(48).toString('base64url')};
       if(await exists(pendingFile))await unlink(pendingFile);
       // Record intent before credentials so interrupted first installs can resume.
       await atomicPrivateJson(pendingFile,bootstrapMarker(config));
       await atomicPrivateJson(connectionFile,config);
     }
     let pending=await isBootstrapPending(config);
     if(!hasVersion){
       // v1.0.4 wrote connection.json BEFORE initdb. If initdb failed and
       // cleaned its cluster, resume safely with the SAME credentials.
       if(await exists(cluster)){
         const contents=await readdir(cluster);
         if(contents.length){
           // v1.0.4 had no pending marker. A failed initdb can leave a
           // partially populated directory with connection.json already
           // committed. PG_VERSION absent alone is NOT evidence that a
           // pre-existing cluster is disposable: pg_control protects it.
           const controlFile=join(cluster,'global','pg_control');
           if(await exists(controlFile))
             fail('Cluster PostgreSQL contém pg_control sem versão: recuperação auditada obrigatória; nunca reinicializar dados');
           // Newer attempts are linked to the original credentials through
           // bootstrap.pending.json. Legacy attempts have no such marker,
           // but no PG_VERSION or pg_control means they cannot be a complete
           // PostgreSQL installation. Preserve the directory for inspection.
           await rename(cluster,join(root,'cluster-interrupted-'+randomBytes(8).toString('hex')));
         }
       }
       if(!pending){
         await atomicPrivateJson(pendingFile,bootstrapMarker(config));
         pending=true;
       }
       const secretFile=join(root,'bootstrap.pw');
       // A hard crash can leave this ephemeral file behind. It belongs only
       // to the pending bootstrap and must not prevent a subsequent retry.
       await unlink(secretFile).catch(error=>{
         if(error.code!=='ENOENT')throw error;
       });
       try{
         await writeFile(secretFile,config.password+'\n',{flag:'wx',mode:0o600});
         try{
           await executeLogged(join(bundle.bin,'initdb.exe'),[
             '-D',cluster,'-U',USER,'--encoding=UTF8',
             '--auth-host=scram-sha-256','--auth-local=scram-sha-256',
             '--pwfile='+secretFile,'--no-instructions'
           ]);
         }catch(error){
           const diagnostic=processFailureDiagnostic(error);
           await atomicPrivateJson(join(root,'bootstrap-diagnostic.json'),{
             schemaVersion:1,stage:'initdb',...diagnostic
           }).catch(()=>{});
           fail('Falha ao preparar PostgreSQL 16: '+diagnostic.detail+
             '. Diagnóstico privado: postgres/bootstrap-diagnostic.json. '+
             'Não exclua a pasta do banco nem as credenciais.');
         }
       }finally{await unlink(secretFile).catch(()=>{});}
       if(!(await exists(pgVersion)))
         fail('initdb não criou um cluster PostgreSQL verificável; inicialização pendente para recuperação');
     }
     const pgCtl=join(bundle.bin,'pg_ctl.exe');
     let running=false;
     if(hasVersion){
       try{
         await executeLogged(pgCtl,['status','-D',cluster]);
         running=true;
       }catch{running=false;}
     }
     if(!running){
       const opts='-h 127.0.0.1 -p '+config.port+
         ' -c listen_addresses=127.0.0.1 -c password_encryption=scram-sha-256';
       owned=true;
       try{
         await executeLogged(pgCtl,[
           '-D',cluster,'-l',logFile,'-o',opts,'-w','-t','45','start'
         ]);
       }catch(error){
         // pg_ctl on Windows can time out reading startup state from a
         // Unicode profile even after postgres.exe is already listening.
         // Never assume success: authenticate and verify the exact data
         // directory, database superuser and port before proceeding.
         try{await verifyRunning(config);}
         catch{
           const diagnostic=processFailureDiagnostic(error);
           await atomicPrivateJson(join(root,'bootstrap-diagnostic.json'),{
             schemaVersion:1,stage:'pg_ctl start',...diagnostic
           }).catch(()=>{});
           fail('Falha ao iniciar PostgreSQL: '+diagnostic.detail+
             '. Consulte postgres/postgres.log e postgres/bootstrap-diagnostic.json.');
         }
       }
     }
     await verifyRunning(config);
     await provisionDatabases(config,{fresh:pending});
     // Do not treat an interrupted fresh installation as an existing,
     // provisioned customer database until both DBs have been verified.
     if(pending)await unlink(pendingFile);
     activeConfig=Object.freeze({
       newInstall:pending,
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
     await executeLogged(join(binaries.bin,'pg_ctl.exe'),[
       '-D',cluster,'-m','fast','-w','-t','30','stop'
     ]);
   }finally{activeConfig=null;}
 }
 return Object.freeze({ensureReady,stop});
}
