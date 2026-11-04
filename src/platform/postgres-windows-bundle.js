import {createHash} from 'node:crypto';
import {existsSync,readFileSync,statSync,realpathSync,lstatSync} from 'node:fs';
import {join,resolve,sep} from 'node:path';

// PostgreSQL binaries are embedded offline into Electron extraResources, just
// like ACBr DLLs. No client-side npm, internet or global database installer.
const REQUIRED=Object.freeze([
 'bin/initdb.exe','bin/pg_ctl.exe','bin/postgres.exe','bin/psql.exe',
 'share/postgres.bki'
]);
export function verifyPostgresWindowsBundle({
 resourcesPath,platform=process.platform,arch=process.arch
}={}){
 if(platform!=='win32'||arch!=='x64')
   return {valid:false,reason:'Bundle portátil requer Windows x64'};
 if(typeof resourcesPath!=='string'||!resourcesPath.trim())
   return {valid:false,reason:'Pasta de recursos ausente'};
 try{
   const base=realpathSync(resolve(resourcesPath,'postgresql'));
   const manifestPath=join(base,'postgresql-bundle.json');
   const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
   if(manifest.schemaVersion!==1||manifest.architecture!=='x64'||
       manifest.major!==16||!manifest.files||
       typeof manifest.files!=='object'||Array.isArray(manifest.files))
     throw Error('Manifesto PostgreSQL inválido');
   for(const name of REQUIRED){
     if(!Object.hasOwn(manifest.files,name))
       throw Error('Binário PostgreSQL obrigatório ausente: '+name);
   }
   const names=Object.keys(manifest.files);
   if(names.length<REQUIRED.length)
     throw Error('Manifesto PostgreSQL incompleto');
   for(const name of names){
     if(typeof name!=='string'||
        !/^(?:bin|share|lib)\/[A-Za-z0-9._/-]+$/.test(name)||
        name.includes('//')||name.split('/').includes('..'))
       throw Error('Caminho suspeito no bundle PostgreSQL');
     const file=resolve(base,...name.split('/'));
     if(!file.startsWith(base+sep)||!existsSync(file)||
        lstatSync(file).isSymbolicLink()||!statSync(file).isFile())
       throw Error('Arquivo PostgreSQL não encontrado ou inseguro: '+name);
     const real=realpathSync(file);
     if(!real.startsWith(base+sep))throw Error('Arquivo PostgreSQL fora do bundle');
     const digest=manifest.files[name];
     if(typeof digest!=='string'||!/^[a-f0-9]{64}$/.test(digest))
       throw Error('Checksum inválido: '+name);
     if(createHash('sha256').update(readFileSync(file)).digest('hex')!==digest)
       throw Error('Checksum PostgreSQL divergente: '+name);
   }
   return {valid:true,version:manifest.version,major:16,base,
     bin:join(base,'bin'),share:join(base,'share'),files:names.length};
 }catch(error){
   return {valid:false,reason:String(error.message||error).slice(0,200)};
 }
}
