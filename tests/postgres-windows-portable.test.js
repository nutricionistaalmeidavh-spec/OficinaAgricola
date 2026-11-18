import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,mkdirSync,rmSync,readFileSync,existsSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {verifyPostgresWindowsBundle} from '../src/platform/postgres-windows-bundle.js';
import {createPortablePostgresController,postgresExecutableTimeout} from '../src/platform/postgres-local-instance.js';

function fixture(){
 const root=mkdtempSync(join(tmpdir(),'oficina-pg-bundle-'));
 const resources=join(root,'resources'),bundle=join(resources,'postgresql');
 mkdirSync(join(bundle,'bin'),{recursive:true});
 mkdirSync(join(bundle,'share'),{recursive:true});
 const files=['bin/initdb.exe','bin/pg_ctl.exe','bin/postgres.exe','bin/psql.exe',
  'share/postgres.bki','share/locale/en@boldquot/LC_MESSAGES/gettext-runtime.mo',
  'share/timezone/Etc/GMT+0','bin/vcruntime140.dll',
  'bin/vcruntime140_1.dll','bin/msvcp140.dll'];
 const hashes={};
 for(const file of files){
   const content=Buffer.from('test portable binary '+file);
   mkdirSync(join(bundle,...file.split('/').slice(0,-1)),{recursive:true});
   writeFileSync(join(bundle,...file.split('/')),content);
   hashes[file]=createHash('sha256').update(content).digest('hex');
 }
 writeFileSync(join(bundle,'postgresql-bundle.json'),JSON.stringify({
   schemaVersion:1,architecture:'x64',major:16,files:hashes,source:'official PostgreSQL binary bundle'
 }));
 return {root,resources,bundle,files};
}
test('portable PostgreSQL refuses missing/modified or spoofed bundles',()=>{
 const f=fixture();
 try{
   assert.equal(verifyPostgresWindowsBundle({resourcesPath:f.resources,platform:'win32',arch:'x64'}).valid,true);
   writeFileSync(join(f.bundle,'bin','postgres.exe'),'malicious');
   assert.equal(verifyPostgresWindowsBundle({resourcesPath:f.resources,platform:'win32',arch:'x64'}).valid,false);
   assert.equal(verifyPostgresWindowsBundle({resourcesPath:f.resources,platform:'linux',arch:'x64'}).valid,false);
 }finally{rmSync(f.root,{recursive:true,force:true});}
});

test('PostgreSQL Windows bundle accepts official gettext locale variants but rejects traversal',()=>{
 const f=fixture();
 try{
   const original=JSON.parse(readFileSync(join(f.bundle,'postgresql-bundle.json'),'utf8'));
   const valid=verifyPostgresWindowsBundle({
     resourcesPath:f.resources,platform:'win32',arch:'x64'
   });
   assert.equal(valid.valid,true,valid.reason);
   assert.equal(valid.files,f.files.length);
   original.files['share/locale/../../escape.mo']='0'.repeat(64);
   writeFileSync(join(f.bundle,'postgresql-bundle.json'),JSON.stringify(original));
   const rejected=verifyPostgresWindowsBundle({
     resourcesPath:f.resources,platform:'win32',arch:'x64'
   });
   assert.equal(rejected.valid,false,'relative traversal remains prohibited');
 }finally{rmSync(f.root,{recursive:true,force:true});}
});
test('first launch provisions private PostgreSQL 16 cluster without npm or network and never rotates owner password',async()=>{
 const f=fixture();
 const dataDir=join(f.root,'private');
 const commands=[],connections=[];
 const fakeRun=async(executable,args,options={})=>{
   commands.push({program:executable.split(/[\\\\/]/).at(-1),args});
   if(executable.endsWith('initdb.exe')){
     mkdirSync(join(dataDir,'postgres','cluster'),{recursive:true});
     writeFileSync(join(dataDir,'postgres','cluster','PG_VERSION'),'16\n');
   }
 };
 const fakePool=class{
   constructor(opts){connections.push(opts); }
   async query(sql){
     if(sql.includes("current_setting('data_directory')"))return {rows:[{
       data_dir:join(dataDir,'postgres','cluster'),server_port:'55627',username:'oficina_local_owner'
     }]};
     if(sql.includes('pg_database'))return {rows:[]};
     return {rows:[]};
   }
   async end(){}
 };
 const manager=createPortablePostgresController({
   resourcesPath:f.resources,dataRoot:dataDir,platform:'win32',arch:'x64',
   execute:fakeRun,Pool:fakePool,choosePort:async()=>55627
 });
 try{
   const config=await manager.ensureReady();
   assert.match(config.registryUrl,/^postgresql:/);
   assert.match(config.operationsUrl,/^postgresql:/);
   assert.equal(config.port,55627);
   assert.ok(commands.some(x=>x.program==='initdb.exe'));
   assert.ok(commands.some(x=>x.program==='pg_ctl.exe'&&x.args.includes('start')));
   assert.ok(commands.every(x=>!x.args.some(arg=>arg.startsWith('--password='))));
   const secretFile=join(dataDir,'postgres','connection.json');
   const original=readFileSync(secretFile,'utf8');
   assert.ok(existsSync(secretFile));
   await manager.stop();
   assert.equal(readFileSync(secretFile,'utf8'),original);
 }finally{rmSync(f.root,{recursive:true,force:true});}
});
test('existing cluster missing credentials fails closed rather than resetting data or password',async()=>{
 const f=fixture();
 const dataRoot=join(f.root,'profile');
 const cluster=join(dataRoot,'postgres','cluster');
 mkdirSync(cluster,{recursive:true});
 writeFileSync(join(cluster,'PG_VERSION'),'16\n');
 const manager=createPortablePostgresController({
   resourcesPath:f.resources,dataRoot,platform:'win32',arch:'x64',
   execute:async()=>{throw Error('Must not reinitialise');},
   Pool:class{},choosePort:async()=>55628
 });
 try{
   await assert.rejects(manager.ensureReady(),/credenciais|recuperação/i);
   assert.equal(readFileSync(join(cluster,'PG_VERSION'),'utf8').trim(),'16');
 }finally{rmSync(f.root,{recursive:true,force:true});}
});


test('regressão: primeira instalação interrompida antes do PG_VERSION retoma sem trocar credenciais',async()=>{
 const f=fixture();
 const dataRoot=join(f.root,'perfil');
 const postgresRoot=join(dataRoot,'postgres');
 let initdbAttempts=0;
 const created=new Set();
 const execute=async (program,args)=>{
   if(program.endsWith('initdb.exe')){
     initdbAttempts++;
     if(initdbAttempts===1)throw Error('simulated initdb interruption');
     mkdirSync(join(postgresRoot,'cluster'),{recursive:true});
     writeFileSync(join(postgresRoot,'cluster','PG_VERSION'),'16\n');
   }
 };
 const Pool=class{
   async query(sql,params){
     if(sql.includes("current_setting('data_directory')"))return {rows:[{
       data_dir:join(postgresRoot,'cluster'),server_port:'55631',username:'oficina_local_owner'
     }]};
     if(sql.includes('pg_database'))return {rows:created.has(params[0])?[{present:1}]:[]};
     if(sql.startsWith('CREATE DATABASE')){
       created.add(sql.match(/"([^"]+)"/)[1]);return {rows:[]};
     }
     throw Error('Unexpected SQL '+sql);
   }
   async end(){}
 };
 const manager=createPortablePostgresController({
   resourcesPath:f.resources,dataRoot,platform:'win32',arch:'x64',
   execute,Pool,choosePort:async()=>55631
 });
 try{
   await assert.rejects(manager.ensureReady(),/Falha ao preparar PostgreSQL 16/);
   const credentialPath=join(postgresRoot,'connection.json');
   const before=readFileSync(credentialPath,'utf8');
   const result=await manager.ensureReady();
   assert.equal(result.newInstall,true);
   assert.equal(readFileSync(credentialPath,'utf8'),before);
   assert.equal(initdbAttempts,2);
   assert.deepEqual([...created].sort(),['oficina_operations','oficina_registry']);
   assert.equal(existsSync(join(postgresRoot,'bootstrap.pending.json')),false);
 }finally{await manager.stop().catch(()=>{});rmSync(f.root,{recursive:true,force:true});}
});

test('regressão: primeira instalação interrompida depois do initdb retoma criação dos bancos',async()=>{
 const f=fixture();
 const dataRoot=join(f.root,'perfil');
 const postgresRoot=join(dataRoot,'postgres');
 let failProvision=true,initdbAttempts=0;
 const created=new Set();
 const execute=async program=>{
   if(program.endsWith('initdb.exe')){
     initdbAttempts++;
     mkdirSync(join(postgresRoot,'cluster'),{recursive:true});
     writeFileSync(join(postgresRoot,'cluster','PG_VERSION'),'16\n');
   }
 };
 const Pool=class{
   async query(sql,params){
     if(sql.includes("current_setting('data_directory')"))return {rows:[{
       data_dir:join(postgresRoot,'cluster'),server_port:'55632',username:'oficina_local_owner'
     }]};
     if(sql.includes('pg_database')){
       if(failProvision)throw Error('simulated provisioning interruption');
       return {rows:created.has(params[0])?[{present:1}]:[]};
     }
     if(sql.startsWith('CREATE DATABASE')){
       created.add(sql.match(/"([^"]+)"/)[1]);return {rows:[]};
     }
     throw Error('Unexpected SQL '+sql);
   }
   async end(){}
 };
 const options={
   resourcesPath:f.resources,dataRoot,platform:'win32',arch:'x64',
   execute,Pool,choosePort:async()=>55632
 };
 const first=createPortablePostgresController(options);
 try{
   await assert.rejects(first.ensureReady(),/simulated provisioning interruption/);
   assert.ok(existsSync(join(postgresRoot,'cluster','PG_VERSION')));
   failProvision=false;
   const restarted=createPortablePostgresController(options);
   const result=await restarted.ensureReady();
   assert.equal(result.newInstall,true);
   assert.equal(initdbAttempts,1,'não reinicializar cluster já criado');
   assert.deepEqual([...created].sort(),['oficina_operations','oficina_registry']);
   assert.equal(existsSync(join(postgresRoot,'bootstrap.pending.json')),false);
   await restarted.stop();
 }finally{await first.stop().catch(()=>{});rmSync(f.root,{recursive:true,force:true});}
});

test('regressão: bootstrap parcial com marcador preserva arquivos interrompidos e retoma',async()=>{
 const f=fixture();
 const dataRoot=join(f.root,'perfil');
 const postgresRoot=join(dataRoot,'postgres');
 let tries=0;
 const databases=new Set();
 const execute=async program=>{
   if(program.endsWith('initdb.exe')){
     tries++;
     const path=join(postgresRoot,'cluster');
     mkdirSync(path,{recursive:true});
     if(tries===1){
       writeFileSync(join(path,'arquivo-parcial'),'preservar');
       throw Error('simulated partial cluster');
     }
     writeFileSync(join(path,'PG_VERSION'),'16\n');
   }
 };
 const Pool=class{
   async query(sql,params){
     if(sql.includes("current_setting('data_directory')"))return {rows:[{
       data_dir:join(postgresRoot,'cluster'),server_port:'55633',username:'oficina_local_owner'
     }]};
     if(sql.includes('pg_database'))return {rows:databases.has(params[0])?[{present:1}]:[]};
     if(sql.startsWith('CREATE DATABASE')){databases.add(sql.match(/"([^"]+)"/)[1]);return {rows:[]};}
     throw Error('Unexpected SQL '+sql);
   }
   async end(){}
 };
 const manager=createPortablePostgresController({
   resourcesPath:f.resources,dataRoot,platform:'win32',arch:'x64',
   execute,Pool,choosePort:async()=>55633
 });
 try{
   await assert.rejects(manager.ensureReady(),/Falha ao preparar PostgreSQL 16/);
   await manager.ensureReady();
   const folders=readdirSync(postgresRoot).filter(x=>x.startsWith('cluster-interrupted-'));
   assert.equal(folders.length,1);
   assert.equal(readFileSync(join(postgresRoot,folders[0],'arquivo-parcial'),'utf8'),'preservar');
 }finally{await manager.stop().catch(()=>{});rmSync(f.root,{recursive:true,force:true});}
});

test('initdb possui prazo maior que os comandos curtos, inclusive em caminho Windows',()=>{
 assert.equal(postgresExecutableTimeout('C:\\Program Files\\PostgreSQL\\bin\\initdb.exe'),300_000);
 assert.equal(postgresExecutableTimeout('/opt/postgresql/bin/initdb.exe'),300_000);
 assert.equal(postgresExecutableTimeout('C:\\Postgres\\bin\\pg_ctl.exe'),60_000);
});


test('v1.0.4: cluster parcial sem PG_VERSION nem marcador recupera sem apagar arquivos originais',async()=>{
 const f=fixture();
 const dataRoot=join(f.root,'legacy');
 const root=join(dataRoot,'postgres');
 const cluster=join(root,'cluster');
 mkdirSync(cluster,{recursive:true});
 writeFileSync(join(cluster,'arquivo-parcial'),'bytes-originais-intactos');
 const password='a'.repeat(48);
 const original=JSON.stringify({schemaVersion:1,user:'oficina_local_owner',port:55635,password});
 writeFileSync(join(root,'connection.json'),original);
 let initialized=0;
 const databases=new Set();
 const exec=async file=>{
   if(file.endsWith('initdb.exe')){
     initialized++;
     mkdirSync(cluster,{recursive:true});
     writeFileSync(join(cluster,'PG_VERSION'),'16\n');
   }
 };
 const Pool=class{
   async query(sql,params){
     if(sql.includes("current_setting('data_directory')"))return {rows:[{
       data_dir:cluster,server_port:'55635',username:'oficina_local_owner'
     }]};
     if(sql.includes('pg_database'))return {rows:databases.has(params[0])?[{ok:1}]:[]};
     if(sql.startsWith('CREATE DATABASE')){databases.add(sql.match(/"([^"]+)"/)[1]);return {rows:[]};}
     throw Error('Unexpected SQL '+sql);
   }
   async end(){}
 };
 const manager=createPortablePostgresController({
   resourcesPath:f.resources,dataRoot,platform:'win32',arch:'x64',
   execute:exec,Pool,choosePort:async()=>{throw Error('must keep existing port');}
 });
 try{
   const config=await manager.ensureReady();
   assert.equal(config.newInstall,true);
   assert.equal(initialized,1);
   assert.deepEqual([...databases].sort(),['oficina_operations','oficina_registry']);
   const saved=readdirSync(root).filter(x=>x.startsWith('cluster-interrupted-'));
   assert.equal(saved.length,1);
   assert.equal(readFileSync(join(root,saved[0],'arquivo-parcial'),'utf8'),'bytes-originais-intactos');
   assert.equal(readFileSync(join(root,'connection.json'),'utf8'),original);
 }finally{await manager.stop().catch(()=>{});rmSync(f.root,{recursive:true,force:true});}
});

test('versão PG_VERSION ausente em cluster existente com pg_control nunca é reinicializada',async()=>{
 const f=fixture();
 const dataRoot=join(f.root,'profile');
 const root=join(dataRoot,'postgres');
 const cluster=join(root,'cluster');
 mkdirSync(join(cluster,'global'),{recursive:true});
 writeFileSync(join(cluster,'global','pg_control'),'original-protected');
 writeFileSync(join(root,'connection.json'),JSON.stringify({
   schemaVersion:1,user:'oficina_local_owner',port:55636,password:'b'.repeat(48)
 }));
 let executed=0;
 const manager=createPortablePostgresController({
   resourcesPath:f.resources,dataRoot,platform:'win32',arch:'x64',
   execute:async()=>{executed++;throw Error('must not run initdb');},
   Pool:class{},choosePort:async()=>55636
 });
 try{
   await assert.rejects(manager.ensureReady(),/recuperação|marcador/i);
   assert.equal(executed,0);
   assert.equal(readFileSync(join(cluster,'global','pg_control'),'utf8'),'original-protected');
 }finally{rmSync(f.root,{recursive:true,force:true});}
});

test('bundle Windows deve ser autossuficiente: DLLs VC++ presentes e verificadas por SHA256',()=>{
 const f=fixture();
 try{
   const verify=()=>verifyPostgresWindowsBundle({
     resourcesPath:f.resources,platform:'win32',arch:'x64'
   });
   assert.equal(verify().valid,true,'bundle completo precisa funcionar');
   for(const dll of ['vcruntime140.dll','vcruntime140_1.dll','msvcp140.dll']){
     const p=join(f.bundle,'bin',dll);
     const original=readFileSync(p);
     rmSync(p);
     assert.equal(verify().valid,false,dll+' missing must be blocked');
     writeFileSync(p,original);
     assert.equal(verify().valid,true,dll+' restored');
   const manifestFile=join(f.bundle,'postgresql-bundle.json');
   const manifest=JSON.parse(readFileSync(manifestFile,'utf8'));
   delete manifest.files['bin/'+dll];
   writeFileSync(manifestFile,JSON.stringify(manifest));
   rmSync(p);
   assert.equal(verify().valid,false,dll+' removed from manifest must still fail');
   writeFileSync(p,original);
   manifest.files['bin/'+dll]=createHash('sha256').update(original).digest('hex');
   writeFileSync(manifestFile,JSON.stringify(manifest));
   assert.equal(verify().valid,true,dll+' restore manifest');
   }
 }finally{rmSync(f.root,{recursive:true,force:true});}
});

test('regressão Windows: pg_ctl timeout não pode abortar um PostgreSQL já iniciado e validado',async()=>{
 const f=fixture(),dataRoot=join(f.root,'perfil Deus e fiél');
 const cluster=join(dataRoot,'postgres','cluster');
 let timedOut=0,queries=0;
 const execute=async(file,args)=>{
   if(file.endsWith('initdb.exe')){
     mkdirSync(cluster,{recursive:true});writeFileSync(join(cluster,'PG_VERSION'),'16\n');
   }
   if(file.endsWith('pg_ctl.exe') && args.includes('start')){
     timedOut++;throw Object.assign(new Error('pg_ctl startup timeout'),{code:'ETIMEDOUT'});
   }
 };
 const Pool=class{
   async query(sql,params){
     queries++;
     if(sql.includes("current_setting('data_directory')"))return {rows:[{
       data_dir:cluster,server_port:'55642',username:'oficina_local_owner'
     }]};
     if(sql.includes('pg_database'))return {rows:[]};
     if(sql.startsWith('CREATE DATABASE'))return {rows:[]};
     throw Error('Unexpected SQL '+sql);
   }
   async end(){}
 };
 const manager=createPortablePostgresController({
   resourcesPath:f.resources,dataRoot,platform:'win32',arch:'x64',execute,Pool,
   choosePort:async()=>55642
 });
 try{
   const ready=await manager.ensureReady();
   assert.equal(ready.port,55642);
   assert.equal(timedOut,1);
   assert.ok(queries>0,'server is validated with real credentials, port, and data_dir');
 }finally{await manager.stop().catch(()=>{});rmSync(f.root,{recursive:true,force:true});}
});
