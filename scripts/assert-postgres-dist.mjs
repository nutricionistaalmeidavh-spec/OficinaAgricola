import {existsSync,readFileSync,readdirSync,statSync} from 'node:fs';
import {resolve,dirname,join,sep} from 'node:path';

const root=resolve('dist/src'),excluded=[
 'db.js','server.js','server-assistencia.js','start.js',
 'start-multitenant.js','assistencia-schema.js','migrate-assistencia.js',
 'seed.js','seed-assistencia.js'
];
if(!existsSync(join(root,'start-postgres-unified.js')))
 throw Error('Build sem o gateway PostgreSQL canônico');
for(const path of excluded)
 if(existsSync(join(root,path)))
  throw Error('Build mantém runtime SQLite legado: '+path);
const deps=/\b(?:from\s*|import\s*\(\s*|import\s*)(['"])(\.{1,2}\/[^'"]+)\1/g;
let modules=0;
function walk(dir){
 for(const entry of readdirSync(dir,{withFileTypes:true})){
   const file=join(dir,entry.name);
   if(entry.isDirectory())walk(file);
   else if(/\.(?:m?js)$/.test(file)){
     modules++;
     for(const m of readFileSync(file,'utf8').matchAll(deps)){
       const resolved=resolve(dirname(file),m[2]);
       if(!resolved.startsWith(root+sep)||!existsSync(resolved)||
          !statSync(resolved).isFile())
         throw Error('Módulo PostgreSQL publicado com import ausente: '+file+' -> '+m[2]);
     }
   }
 }
}
walk(root);
const entry=readFileSync(resolve('electron/main.js'),'utf8');
if(/startLocalServer|artisys-oficina\.sqlite|OFICINA_POSTGRES_DESKTOP_MODE/.test(entry))
 throw Error('Electron contém entrada SQLite ou ativador manual legado');
if(!entry.includes('const url = await startPostgresDesktop();'))
 throw Error('PostgreSQL não é o único backend desktop');
console.log('PASS: dist PostgreSQL-only; '+modules+' módulos JS e sem SQLite legado no instalador.');
