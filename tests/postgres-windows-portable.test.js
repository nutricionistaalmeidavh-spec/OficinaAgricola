import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,mkdirSync,rmSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {verifyPostgresWindowsBundle} from '../src/platform/postgres-windows-bundle.js';
import {createPortablePostgresController} from '../src/platform/postgres-local-instance.js';

function fixture(){
 const root=mkdtempSync(join(tmpdir(),'oficina-pg-bundle-'));
 const resources=join(root,'resources'),bundle=join(resources,'postgresql');
 mkdirSync(join(bundle,'bin'),{recursive:true});
 mkdirSync(join(bundle,'share'),{recursive:true});
 const files=['bin/initdb.exe','bin/pg_ctl.exe','bin/postgres.exe','bin/psql.exe','share/postgres.bki'];
 const hashes={};
 for(const file of files){
   const content=Buffer.from('test portable binary '+file);
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
