// CI/developer builder only. Never runs on a customer's computer.
// Stages an already installed licensed PostgreSQL 16 distribution as an
// offline Electron resource bundle with explicit SHA-256 manifest.
import {createHash} from 'node:crypto';
import {
 cpSync,existsSync,readFileSync,readdirSync,rmSync,mkdirSync,
 writeFileSync,lstatSync,statSync,copyFileSync
} from 'node:fs';
import {resolve,join,relative,sep} from 'node:path';
import {verifyPostgresWindowsBundle} from '../src/platform/postgres-windows-bundle.js';

if(process.platform!=='win32'||process.arch!=='x64')
 throw Error('Staging PostgreSQL exige builder Windows x64');
const source=resolve(process.env.OFICINA_POSTGRES_SOURCE_DIR||
 'C:\\Program Files\\PostgreSQL\\16');
const target=resolve('build/postgresql');
if(source===target||target.startsWith(source+sep))
 throw Error('Origem e destino PostgreSQL não podem se sobrepor');
for(const name of ['bin/initdb.exe','bin/pg_ctl.exe','bin/postgres.exe',
 'bin/psql.exe','share/postgres.bki']){
 const file=resolve(source,...name.split('/'));
 if(!existsSync(file)||!statSync(file).isFile())
   throw Error('Distribuição PostgreSQL 16 incompleta: '+name+' em '+source);
}
rmSync(target,{recursive:true,force:true});
mkdirSync(target,{recursive:true});
for(const dir of ['bin','lib','share']){
 const from=join(source,dir);
 if(!existsSync(from))throw Error('Distribuição PostgreSQL sem '+dir);
 cpSync(from,join(target,dir),{
   recursive:true,force:false,errorOnExist:true,dereference:false
 });
}
// PostgreSQL 16 binaries from EDB are built against the MSVC runtime.
// The CI Windows image happens to have it globally; clean customer PCs may not.
// Stage legally redistributable CRT files from Visual Studio's REDIST tree,
// never from the runner's System32 folder.
const CRT_DLLS=['vcruntime140.dll','vcruntime140_1.dll','msvcp140.dll'];
function findRedistributableCRT(){
 const custom=process.env.OFICINA_MSVC_REDIST_DIR;
 const roots=custom?[resolve(custom)]:[];
 const pf=process.env.ProgramFiles||'C:\\Program Files';
 for(const edition of ['Enterprise','Professional','Community','BuildTools']){
   const versions=join(pf,'Microsoft Visual Studio','2022',edition,'VC','Redist','MSVC');
   if(!existsSync(versions))continue;
   for(const candidate of readdirSync(versions,{withFileTypes:true})
     .filter(e=>e.isDirectory()).map(e=>e.name).sort().reverse()){
     for(const family of ['Microsoft.VC143.CRT','Microsoft.VC142.CRT'])
       roots.push(join(versions,candidate,'x64',family));
   }
 }
 for(const dir of roots){
   if(CRT_DLLS.every(name=>existsSync(join(dir,name))&&statSync(join(dir,name)).isFile()))
     return dir;
 }
 throw Error('Redistribuíveis Microsoft VC++ x64 ausentes do builder. '+
   'Instale Visual Studio Build Tools com pacote CRT de redistribuição ou configure OFICINA_MSVC_REDIST_DIR. '+
   'Não usar System32 como origem; cliente não deve instalar dependências manualmente.');
}
const crtSource=findRedistributableCRT();
for(const dll of CRT_DLLS){
 const targetDll=join(target,'bin',dll);
 // Fail closed on unexpected duplicates: do not override PostgreSQL-owned DLLs.
 if(existsSync(targetDll))throw Error('CRT já existe no bundle: '+dll);
 copyFileSync(join(crtSource,dll),targetDll);
}
console.log('MSVC CRT x64 redistribuível embarcado:',CRT_DLLS.join(', '));

const files={};
function walk(dir){
 for(const ent of readdirSync(dir,{withFileTypes:true})){
   const path=join(dir,ent.name);
   if(lstatSync(path).isSymbolicLink())
     throw Error('Link simbólico não permitido no PostgreSQL embarcado');
   if(ent.isDirectory())walk(path);
   else if(ent.isFile()){
     const relativeName=relative(target,path).split(sep).join('/');
     if(!/^(?:bin|lib|share)\/[A-Za-z0-9._@+/-]+$/.test(relativeName)||
        relativeName.includes('//')||relativeName.split('/').includes('..'))
       throw Error('Arquivo PostgreSQL com caminho não permitido: '+relativeName);
     files[relativeName]=createHash('sha256').update(readFileSync(path)).digest('hex');
   }
 }
}
walk(target);
const LICENSE=[
 'PostgreSQL, copyright the PostgreSQL Global Development Group.',
 'PostgreSQL License: https://www.postgresql.org/about/licence/',
 'Binary source: '+source,
 'Version: 16; Windows x64; no paid service or remote installer required.',
 'Visual C++ runtime DLLs: Microsoft redistributable CRT from Visual Studio REDIST tree.',
 'Microsoft Visual C++ runtime is free of charge but proprietary; no paid service.',
 'Packaged dependencies retain their original licenses. Review vendor notices'
].join('\n')+'\n';
writeFileSync(join(target,'THIRD_PARTY_LICENSES.txt'),LICENSE);
writeFileSync(join(target,'postgresql-bundle.json'),JSON.stringify({
 schemaVersion:1,architecture:'x64',major:16,
 source:'PostgreSQL 16 Windows binaries (builder-local)',
 files
},null,2)+'\n');
const check=verifyPostgresWindowsBundle({
 resourcesPath:resolve('build'),platform:'win32',arch:'x64'
});
if(!check.valid)
 throw Error('Bundle PostgreSQL rejeitado: '+check.reason);
console.log('PostgreSQL 16 offline validado:',check.files,
 'arquivos, nenhuma dependência de internet na instalação.');
